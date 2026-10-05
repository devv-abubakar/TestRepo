/**
 * Application state and the batch runner.
 *
 * Progress here is always derived from real queue state — a handout only
 * counts as completed once its output has been validated and persisted. The
 * runner keeps a small number of handouts in flight, isolates every failure
 * to its own job, and checkpoints to IndexedDB after each one so an
 * interrupted batch can pick up exactly where it stopped.
 */
import { create } from 'zustand';
import type {
  ApiKeyEntry,
  Course,
  CoverageMode,
  Handout,
  HandoutStatus,
  KeyStats,
  LogEntry,
  LogLevel,
  ProcessingProgress,
  Settings,
} from '../types';
import { APP_NAME } from '../constants';
import {
  KeyPool,
  poolLimits,
  providerMeta,
  singleKeyPool,
  testConnection,
  validateConfig,
  type ConnectionResult,
} from '../services/ai';
import { disposeOcr } from '../services/ocr';
import {
  directoryHandleOf,
  outputNameFor,
  pickDirectory,
  restoreDirectory,
  sourceFromFileList,
  type HandoutSource,
  type ScannedHandout,
} from '../services/filesystem';
import {
  clearSession,
  getOutput,
  loadKeyUsage,
  loadRootHandle,
  loadSettings,
  loadSnapshot,
  putOutput,
  saveKeyUsage,
  saveRootHandle,
  saveSettings,
  saveSnapshot,
} from '../services/persist';
import { processHandout, type ProgressPatch } from '../services/pdf/process';
import { buildZip, downloadBlob, downloadBytes } from '../services/zip';
import {
  COVERAGE_PRESETS,
  DEFAULT_SETTINGS,
  mergeSettings,
  newKeyEntry,
  PASSES_PER_CHUNK,
} from './defaults';

const MAX_LOGS = 800;
/** Upper bound on documents in flight; more risks browser memory. */
export const MAX_CONCURRENCY = 6;

/** Readers hold closures, so they live outside the reactive store. */
const readers = new Map<string, ScannedHandout>();

export interface ResumeOffer {
  rootName: string;
  completed: number;
  failed: number;
  remaining: number;
}

export interface ConfirmSummary {
  courses: number;
  handouts: number;
  existingOutputs: number;
  toProcess: number;
  coverage: CoverageMode;
  /** AI requests this mode spends per ~12,000 characters of text. */
  passesPerChunk: number;
  /** Requests the key pool can still serve today, or null when unlimited. */
  poolCapacityToday: number | null;
}

export interface AppState {
  settings: Settings;
  source: HandoutSource | null;
  rootName: string;
  courses: Course[];
  handouts: Record<string, Handout>;
  order: string[];
  existingOutputs: Set<string>;

  scanning: boolean;
  running: boolean;
  stopping: boolean;
  /** Live progress for every handout currently in flight, keyed by id. */
  active: Record<string, ProcessingProgress>;
  /** Live state of each pooled API key. */
  keyStats: KeyStats[];
  logs: LogEntry[];
  totalHighlights: number;
  logsOpen: boolean;
  settingsOpen: boolean;
  selectedCourse: string | null;
  previewHandoutId: string | null;
  zipping: { done: number; total: number } | null;

  resumeOffer: ResumeOffer | null;
  confirm: ConfirmSummary | null;
  banner: { level: LogLevel; message: string } | null;
  connection: { state: 'idle' | 'testing' | 'done'; results: ConnectionResult[] };

  // actions
  init(): Promise<void>;
  patchSettings(patch: Partial<Settings>): void;
  addApiKey(): void;
  updateApiKey(id: string, patch: Partial<ApiKeyEntry>): void;
  removeApiKey(id: string): void;
  setTheme(theme: 'light' | 'dark'): void;
  selectFolder(): Promise<void>;
  selectFiles(files: FileList): Promise<void>;
  resumeSession(): Promise<void>;
  startOver(): Promise<void>;
  requestStart(): void;
  cancelConfirm(): void;
  startProcessing(): Promise<void>;
  stopProcessing(): void;
  retryFailed(): Promise<void>;
  downloadOne(handoutId: string): Promise<void>;
  downloadAll(): Promise<void>;
  previewHandout(handoutId: string | null): void;
  selectCourse(course: string | null): void;
  toggleLogs(): void;
  toggleSettings(open?: boolean): void;
  clearLogs(): void;
  dismissBanner(): void;
  runConnectionTest(): Promise<void>;
}

let logId = 0;
let abortController: AbortController | null = null;
/** The pool is shared by every handout in a batch, so limits are global. */
let activePool: KeyPool | null = null;

/**
 * Everything still waiting for a first pass. With "re-process existing
 * outputs" on, already finished handouts rejoin the queue.
 */
function pendingQueue(state: Pick<AppState, 'order' | 'handouts' | 'settings'>): string[] {
  const reprocess = state.settings.output.reprocessExisting;
  return state.order.filter((id) => {
    const status = state.handouts[id]?.status;
    if (status === 'pending') return true;
    return reprocess && (status === 'skipped' || status === 'completed');
  });
}

function freshProgress(handout: Handout): ProcessingProgress {
  return {
    handoutId: handout.id,
    courseCode: handout.courseCode,
    handoutName: handout.fileName,
    page: 0,
    pageCount: handout.pageCount,
    chunksDone: 0,
    chunksTotal: 0,
    stage: 'reading',
    detail: 'Queued',
    startedAt: Date.now(),
  };
}

export const useAppStore = create<AppState>()((set, get) => {
  /** Append a log line, trimming the oldest once the cap is hit. */
  const log = (level: LogLevel, message: string, handoutId?: string, keyLabel?: string) => {
    logId += 1;
    const entry: LogEntry = {
      id: logId,
      at: Date.now(),
      level,
      message,
      ...(handoutId === undefined ? {} : { handoutId }),
      ...(keyLabel === undefined ? {} : { keyLabel }),
    };
    set((state) => {
      const logs = [entry, ...state.logs];
      return { logs: logs.length > MAX_LOGS ? logs.slice(0, MAX_LOGS) : logs };
    });
  };

  const patchHandout = (id: string, patch: Partial<Handout>) => {
    set((state) => {
      const existing = state.handouts[id];
      if (!existing) return {};
      return { handouts: { ...state.handouts, [id]: { ...existing, ...patch } } };
    });
  };

  const checkpoint = async () => {
    const { rootName, order, handouts, courses, totalHighlights } = get();
    if (order.length === 0) return;
    await saveSnapshot({
      rootName,
      savedAt: Date.now(),
      handouts: order.map((id) => handouts[id]).filter((h): h is Handout => Boolean(h)),
      courses,
      totalHighlights,
    }).catch(() => {
      log('warn', 'Could not save the resume checkpoint — storage may be full.');
    });
  };

  /** Load a scanned source into state, re-applying any stored progress. */
  const applyScan = async (source: HandoutSource) => {
    set({ scanning: true, banner: null });
    try {
      const scan = await source.scan(get().settings.output.suffix);
      readers.clear();

      const handouts: Record<string, Handout> = {};
      const order: string[] = [];
      const courses: Course[] = [];

      for (const course of scan.courses) {
        const ids: string[] = [];
        for (const handout of course.handouts) {
          readers.set(handout.id, handout);
          handouts[handout.id] = {
            id: handout.id,
            courseCode: handout.courseCode,
            fileName: handout.fileName,
            size: handout.size,
            status: 'pending',
            highlightCount: 0,
            pageCount: 0,
            pagesWithoutHighlights: 0,
            coverageShare: 0,
            lowConfidenceSkipped: 0,
            usedOcr: false,
          };
          order.push(handout.id);
          ids.push(handout.id);
        }
        courses.push({ code: course.code, handoutIds: ids });
      }

      // Carry over anything a previous session already finished.
      const snapshot = await loadSnapshot();
      let totalHighlights = 0;
      if (snapshot && snapshot.rootName === scan.rootName) {
        for (const stored of snapshot.handouts) {
          const current = handouts[stored.id];
          if (!current || stored.status === 'pending' || stored.status === 'processing') continue;
          handouts[stored.id] = { ...current, ...stored, status: stored.status };
          if (stored.status === 'completed') totalHighlights += stored.highlightCount;
        }
      }

      set({
        source,
        rootName: scan.rootName,
        courses,
        handouts,
        order,
        existingOutputs: scan.existingOutputs,
        totalHighlights,
        resumeOffer: null,
        selectedCourse: null,
      });

      const handle = directoryHandleOf(source);
      await saveRootHandle(handle).catch(() => undefined);

      log(
        'success',
        `Found ${courses.length} course folder(s) and ${order.length} handout(s) in "${scan.rootName}".`,
      );
      if (scan.existingOutputs.size > 0) {
        log('info', `${scan.existingOutputs.size} highlighted output(s) already exist in the folders.`);
      }
      if (!source.canWrite) {
        log(
          'info',
          'This folder is read-only for the app, so outputs will be offered as downloads.',
        );
      }
      await checkpoint();
    } finally {
      set({ scanning: false });
    }
  };

  /** Update the live progress record for one in-flight handout. */
  const patchProgress = (id: string, patch: ProgressPatch) => {
    set((state) => {
      const current = state.active[id];
      if (!current) return {};
      return { active: { ...state.active, [id]: { ...current, ...patch } } };
    });
  };

  const clearProgress = (id: string) => {
    set((state) => {
      if (!(id in state.active)) return {};
      const next = { ...state.active };
      delete next[id];
      return { active: next };
    });
  };

  /** Run one handout end-to-end. Never throws; records failure instead. */
  const runOne = async (id: string, pool: KeyPool, signal: AbortSignal): Promise<void> => {
    const reader = readers.get(id);
    const state = get();
    const handout = state.handouts[id];
    if (!reader || !handout) return;

    const started = Date.now();
    const { settings, source } = state;
    const outputName = outputNameFor(reader.path, settings.output.suffix);

    if (
      !settings.output.reprocessExisting &&
      state.existingOutputs.has(`${handout.courseCode}/${outputName}`)
    ) {
      patchHandout(id, { status: 'skipped', outputName });
      log('info', `${id} — already processed, skipped.`, id);
      return;
    }

    patchHandout(id, { status: 'processing', error: undefined });
    set((current) => ({ active: { ...current.active, [id]: freshProgress(handout) } }));

    try {
      const bytes = await reader.read();
      const outcome = await processHandout({
        bytes,
        courseCode: handout.courseCode,
        handoutName: handout.fileName,
        settings,
        pool,
        signal,
        onProgress: (patch) => patchProgress(id, patch),
        onLog: (level, message, keyLabel) => log(level, `${id} — ${message}`, id, keyLabel),
      });

      // Always keep the bytes so Download and ZIP work after a reload, then
      // write back into the course folder when the browser allows it.
      let outputMode: Handout['outputMode'] = 'stored';
      try {
        await putOutput({
          handoutId: id,
          courseCode: handout.courseCode,
          fileName: outputName,
          bytes: outcome.bytes,
          createdAt: Date.now(),
        });
      } catch {
        log('warn', `${id} — could not cache the output in the browser database.`, id);
      }
      if (source?.canWrite) {
        try {
          await source.write(handout.courseCode, outputName, outcome.bytes);
          outputMode = 'written';
        } catch (error) {
          log(
            'warn',
            `${id} — saved in the browser but could not write to the folder: ` +
              `${error instanceof Error ? error.message : 'unknown error'}`,
            id,
          );
        }
      }

      patchHandout(id, {
        status: 'completed',
        highlightCount: outcome.highlightCount,
        lowConfidenceSkipped: outcome.lowConfidenceSkipped,
        pageCount: outcome.pageCount,
        pagesWithoutHighlights: outcome.coverage.pagesWithoutHighlights.length,
        coverageShare: outcome.coverage.share,
        usedOcr: outcome.usedOcr,
        outputMode,
        outputName,
        durationMs: Date.now() - started,
        error: undefined,
      });
      set((current) => ({ totalHighlights: current.totalHighlights + outcome.highlightCount }));
      const gaps = outcome.coverage.pagesWithoutHighlights.length;
      log(
        gaps > 0 ? 'warn' : 'success',
        `${id} — COMPLETE: ${outcome.highlightCount} highlight(s) across ${outcome.pageCount} page(s), ` +
          `${(outcome.coverage.share * 100).toFixed(1)}% of the text marked` +
          `${gaps > 0 ? `, ${gaps} page(s) with nothing marked` : ''} ` +
          `in ${((Date.now() - started) / 1000).toFixed(1)}s` +
          `${outputMode === 'written' ? `, saved as ${outputName}` : ''}.`,
        id,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown failure.';
      if (signal.aborted) {
        // A stopped job stays pending so a resume picks it up again.
        patchHandout(id, { status: 'pending' });
        return;
      }
      patchHandout(id, { status: 'failed', error: message });
      log('error', `${id} — FAILED: ${message}`, id);
    } finally {
      clearProgress(id);
      await checkpoint();
    }
  };

  /** Drain `queue` with a bounded number of concurrent jobs. */
  const drain = async (queue: string[], pool: KeyPool, signal: AbortSignal) => {
    const limit = Math.min(Math.max(get().settings.output.concurrency, 1), MAX_CONCURRENCY);
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        if (signal.aborted) return;
        const index = cursor;
        cursor += 1;
        const id = queue[index];
        if (id === undefined) return;
        await runOne(id, pool, signal);
      }
    };
    await Promise.all(Array.from({ length: limit }, worker));
  };

  /**
   * Build the key pool for a batch. Every handout shares it, so per-key rate
   * limits and daily budgets hold across the whole run rather than per file.
   */
  const buildPool = (): KeyPool => {
    const { ai } = get().settings;
    const limits = poolLimits(ai);
    const usage = loadKeyUsage();
    const events = {
      onStats: (stats: KeyStats[]) => set({ keyStats: stats }),
      onUsage: saveKeyUsage,
      onLog: (level: LogLevel, message: string, keyLabel: string) =>
        log(level, message, undefined, keyLabel),
    };
    if (!providerMeta(ai.provider).browserDirect) return singleKeyPool(ai, usage);
    return new KeyPool(ai.keys, limits, events, usage);
  };

  const run = async (ids: string[]) => {
    if (get().running || ids.length === 0) return;
    try {
      validateConfig(get().settings.ai);
    } catch (error) {
      set({
        banner: {
          level: 'error',
          message: error instanceof Error ? error.message : 'AI configuration is incomplete.',
        },
        settingsOpen: true,
      });
      return;
    }

    abortController = new AbortController();
    const { signal } = abortController;
    const pool = buildPool();
    activePool = pool;
    set({ running: true, stopping: false, confirm: null, banner: null, keyStats: pool.stats() });

    const { ai, output } = get().settings;
    const direct = providerMeta(ai.provider).browserDirect;
    log(
      'info',
      `Processing ${ids.length} handout(s) — ${output.concurrency} document(s) at a time` +
        (direct
          ? `, ${pool.total} API key(s) in the pool, up to ${pool.parallelism} AI request(s) in parallel.`
          : ' via the backend proxy.'),
    );

    try {
      await drain(ids, pool, signal);
    } finally {
      abortController = null;
      activePool = null;
      set({ running: false, stopping: false, active: {} });
      await disposeOcr();
      await checkpoint();

      const { handouts, order } = get();
      const counts = order.reduce(
        (acc, id) => {
          const status = handouts[id]?.status ?? 'pending';
          acc[status] += 1;
          return acc;
        },
        { pending: 0, processing: 0, completed: 0, failed: 0, skipped: 0 } as Record<
          HandoutStatus,
          number
        >,
      );
      if (signal.aborted) {
        set({
          banner: {
            level: 'warn',
            message: 'Processing stopped. Completed files are safe. You can resume later.',
          },
        });
        log('warn', 'Processing stopped by user.');
      } else {
        set({
          banner: {
            level: counts.failed > 0 ? 'warn' : 'success',
            message:
              `Processing complete — ${counts.completed} completed, ${counts.failed} failed, ` +
              `${counts.skipped} skipped.`,
          },
        });
        log('success', 'Batch finished.');
      }
    }
  };

  const stored = loadSettings();

  return {
    settings: mergeSettings(stored.settings, stored.keys),
    source: null,
    rootName: '',
    courses: [],
    handouts: {},
    order: [],
    existingOutputs: new Set<string>(),

    scanning: false,
    running: false,
    stopping: false,
    active: {},
    keyStats: [],
    logs: [],
    totalHighlights: 0,
    logsOpen: true,
    settingsOpen: false,
    selectedCourse: null,
    previewHandoutId: null,
    zipping: null,

    resumeOffer: null,
    confirm: null,
    banner: null,
    connection: { state: 'idle', results: [] },

    async init() {
      document.documentElement.dataset.theme = get().settings.theme;
      const snapshot = await loadSnapshot().catch(() => null);
      if (!snapshot || snapshot.handouts.length === 0) return;
      const completed = snapshot.handouts.filter((h) => h.status === 'completed').length;
      const failed = snapshot.handouts.filter((h) => h.status === 'failed').length;
      set({
        resumeOffer: {
          rootName: snapshot.rootName,
          completed,
          failed,
          remaining: snapshot.handouts.length - completed - failed,
        },
      });
    },

    patchSettings(patch) {
      set((state) => {
        const next: Settings = {
          ...state.settings,
          ...patch,
          ai: { ...state.settings.ai, ...(patch.ai ?? {}) },
          highlight: { ...state.settings.highlight, ...(patch.highlight ?? {}) },
          content: { ...state.settings.content, ...(patch.content ?? {}) },
          output: { ...state.settings.output, ...(patch.output ?? {}) },
        };
        // Choosing a coverage mode rewrites the knobs it governs, so the
        // advanced fields always show what is actually in force.
        const mode = patch.highlight?.coverage;
        if (mode && mode !== state.settings.highlight.coverage) {
          next.highlight = { ...next.highlight, ...COVERAGE_PRESETS[mode] };
        }
        saveSettings(next);
        if (activePool) activePool.setLimits(poolLimits(next.ai));
        return { settings: next, connection: { state: 'idle', results: [] } };
      });
    },

    addApiKey() {
      const { settings } = get();
      get().patchSettings({
        ai: { ...settings.ai, keys: [...settings.ai.keys, newKeyEntry(settings.ai.keys.length)] },
      });
    },

    updateApiKey(id, patch) {
      const { settings } = get();
      get().patchSettings({
        ai: {
          ...settings.ai,
          keys: settings.ai.keys.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
        },
      });
    },

    removeApiKey(id) {
      const { settings } = get();
      get().patchSettings({
        ai: { ...settings.ai, keys: settings.ai.keys.filter((entry) => entry.id !== id) },
      });
    },

    setTheme(theme) {
      document.documentElement.dataset.theme = theme;
      get().patchSettings({ theme });
    },

    async selectFolder() {
      try {
        const source = await pickDirectory();
        if (!source) {
          set({
            banner: {
              level: 'warn',
              message:
                'This browser does not support direct folder access. Use "Select folder (fallback)" instead.',
            },
          });
          return;
        }
        await applyScan(source);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Folder selection failed.';
        set({ banner: { level: 'error', message } });
        log('error', message);
      }
    },

    async selectFiles(files) {
      const source = sourceFromFileList(files);
      if (!source) {
        set({ banner: { level: 'warn', message: 'No PDF files were found in that folder.' } });
        return;
      }
      try {
        await applyScan(source);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Folder scan failed.';
        set({ banner: { level: 'error', message } });
        log('error', message);
      }
    },

    async resumeSession() {
      set({ resumeOffer: null });
      const handle = await loadRootHandle().catch(() => null);
      if (!handle) {
        set({
          banner: {
            level: 'info',
            message:
              'Select the same handouts folder again — already completed handouts will be skipped automatically.',
          },
        });
        return;
      }
      try {
        const source = await restoreDirectory(handle);
        if (!source) {
          set({
            banner: {
              level: 'warn',
              message: 'Folder permission was declined. Select the handouts folder again to resume.',
            },
          });
          return;
        }
        await applyScan(source);
        log('info', 'Previous session restored.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not reopen the folder.';
        set({ banner: { level: 'error', message } });
      }
    },

    async startOver() {
      await clearSession().catch(() => undefined);
      await saveRootHandle(null).catch(() => undefined);
      readers.clear();
      set({
        resumeOffer: null,
        source: null,
        rootName: '',
        courses: [],
        handouts: {},
        order: [],
        existingOutputs: new Set<string>(),
        totalHighlights: 0,
        logs: [],
        banner: { level: 'info', message: 'Previous session cleared.' },
      });
    },

    requestStart() {
      const state = get();
      const { order, handouts, existingOutputs, settings, courses } = state;
      const existing = order.filter((id) => {
        const handout = handouts[id];
        const reader = readers.get(id);
        if (!handout || !reader) return false;
        return existingOutputs.has(
          `${handout.courseCode}/${outputNameFor(reader.path, settings.output.suffix)}`,
        );
      }).length;

      const usable = settings.ai.keys.filter(
        (entry) => entry.enabled && entry.key.trim().length > 0,
      ).length;
      const budget = settings.ai.dailyBudgetPerKey;
      const spentToday = state.keyStats.reduce((sum, row) => sum + row.usedToday, 0);

      set({
        confirm: {
          courses: courses.length,
          handouts: order.length,
          existingOutputs: existing,
          toProcess: pendingQueue(state).length,
          coverage: settings.highlight.coverage,
          passesPerChunk: PASSES_PER_CHUNK[settings.highlight.coverage],
          poolCapacityToday:
            budget > 0 && providerMeta(settings.ai.provider).browserDirect
              ? Math.max(0, usable * budget - spentToday)
              : null,
        },
      });
    },

    cancelConfirm() {
      set({ confirm: null });
    },

    async startProcessing() {
      const queue = pendingQueue(get());
      if (queue.length === 0) {
        set({
          confirm: null,
          banner: { level: 'info', message: 'Nothing left to process in this folder.' },
        });
        return;
      }
      await run(queue);
    },

    stopProcessing() {
      if (!abortController) return;
      set({ stopping: true });
      abortController.abort();
    },

    async retryFailed() {
      const { order, handouts } = get();
      const failed = order.filter((id) => handouts[id]?.status === 'failed');
      if (failed.length === 0) return;
      for (const id of failed) patchHandout(id, { status: 'pending', error: undefined });
      await run(failed);
    },

    async downloadOne(handoutId) {
      const output = await getOutput(handoutId).catch(() => null);
      if (!output) {
        set({
          banner: {
            level: 'warn',
            message: 'That output is no longer cached in this browser. Re-process the handout.',
          },
        });
        return;
      }
      downloadBytes(output.bytes, output.fileName);
    },

    async downloadAll() {
      const { order, handouts, settings } = get();
      const entries = order
        .map((id) => ({ id, handout: handouts[id] }))
        .filter((row) => row.handout?.status === 'completed')
        .map((row) => {
          const handout = row.handout as Handout;
          const reader = readers.get(row.id);
          const name =
            handout.outputName ?? outputNameFor(reader?.path ?? handout.fileName, settings.output.suffix);
          return { handoutId: row.id, path: `${handout.courseCode}/${name}` };
        });

      if (entries.length === 0) {
        set({ banner: { level: 'info', message: 'No completed handouts to download yet.' } });
        return;
      }

      set({ zipping: { done: 0, total: entries.length } });
      try {
        const blob = await buildZip(entries, (progress) => set({ zipping: progress }));
        downloadBlob(blob, 'VU_AI_Highlighted_Handouts.zip');
        log('success', `Packaged ${entries.length} highlighted handout(s) into a ZIP.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'ZIP creation failed.';
        set({ banner: { level: 'error', message } });
        log('error', message);
      } finally {
        set({ zipping: null });
      }
    },

    previewHandout(handoutId) {
      set({ previewHandoutId: handoutId });
    },

    selectCourse(course) {
      set((state) => ({ selectedCourse: state.selectedCourse === course ? null : course }));
    },

    toggleLogs() {
      set((state) => ({ logsOpen: !state.logsOpen }));
    },

    toggleSettings(open) {
      set((state) => ({ settingsOpen: open ?? !state.settingsOpen }));
    },

    clearLogs() {
      set({ logs: [] });
    },

    dismissBanner() {
      set({ banner: null });
    },

    async runConnectionTest() {
      set({ connection: { state: 'testing', results: [] } });
      try {
        const results = await testConnection(get().settings.ai);
        set({ connection: { state: 'done', results } });
        for (const result of results) {
          log(result.ok ? 'success' : 'error', `${result.message} (${result.ms} ms)`, undefined, result.label);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Connection test failed.';
        set({ connection: { state: 'done', results: [{ label: APP_NAME, ok: false, message, ms: 0 }] } });
        log('error', `Connection test failed: ${message}`);
      }
    },
  };
});

export { DEFAULT_SETTINGS };
