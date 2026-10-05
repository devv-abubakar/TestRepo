/**
 * Analysis orchestration.
 *
 * A handout is split into page-aligned chunks and the chunks are analysed in
 * parallel across the API key pool, so several free-tier projects do the work
 * of one paid one. Every chunk reports which key picked it up and how long it
 * took, which is what the activity log shows.
 */
import {
  AiError,
  type AiConfig,
  type AiHighlight,
  type AiResponse,
  type CoverageMode,
  type DocumentText,
  type Importance,
} from '../../types';
import { normalizeQuote } from '../../utils/text';
import { KeyPool, type DailyUsage, type PoolLimits } from './keypool';
import {
  buildChunks,
  buildUserMessage,
  passPlan,
  structuredSystemPrompt,
  sweepSystemPrompt,
  systemPrompt,
  type Chunk,
  type PassKind,
} from './prompt';
import { getProvider, PROVIDERS, providerMeta, type ProviderAuth } from './providers';

export { PROVIDERS, providerMeta } from './providers';
export { passPlan, systemPrompt } from './prompt';
export { KeyPool } from './keypool';
export type { DailyUsage, PoolLimits } from './keypool';

/** Per-request wall clock budget. */
const REQUEST_TIMEOUT_MS = 120_000;
/** Attempts within one key before the chunk is handed back to the pool. */
const JSON_ATTEMPTS = 2;
const IMPORTANCES: readonly Importance[] = ['high', 'medium', 'low'];

const JSON_REMINDER =
  '\n\nYour previous reply was not valid JSON. Reply with JSON only — no prose, no code fences — ' +
  'exactly as {"highlights":[{"text":"...","importance":"high","reason":"..."}]}.';

/** Pull the JSON object out of a reply that may carry fences or chatter. */
function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new AiError('The AI reply contained no JSON object.', 'invalid-response', true);
  }
  return body.slice(start, end + 1);
}

/**
 * Strict schema validation. A malformed entry is dropped rather than coerced:
 * a guessed importance or a truncated quote would end up as a wrong highlight.
 */
export function parseAiResponse(raw: string): AiResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError('The AI reply was not valid JSON.', 'invalid-response', true);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new AiError('The AI reply was not a JSON object.', 'invalid-response', true);
  }
  const list = (parsed as { highlights?: unknown }).highlights;
  if (!Array.isArray(list)) {
    throw new AiError('The AI reply had no "highlights" array.', 'invalid-response', true);
  }

  const highlights: AiHighlight[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const text = record.text;
    const importance = record.importance;
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    if (typeof importance !== 'string' || !IMPORTANCES.includes(importance as Importance)) continue;
    highlights.push({
      text,
      importance: importance as Importance,
      reason: typeof record.reason === 'string' ? record.reason.slice(0, 120) : '',
    });
  }
  return { highlights };
}

async function complete(
  config: AiConfig,
  auth: ProviderAuth,
  system: string,
  user: string,
  maxTokens: number,
  abort?: AbortSignal,
): Promise<string> {
  const provider = getProvider(config.provider);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  abort?.addEventListener('abort', onAbort);
  try {
    return await provider.complete(
      {
        system,
        user,
        model: config.model,
        temperature: config.temperature,
        maxTokens,
        signal: controller.signal,
      },
      auth,
    );
  } finally {
    clearTimeout(timer);
    abort?.removeEventListener('abort', onAbort);
  }
}

export interface ChunkInfo {
  /** 1-based chunk number. */
  index: number;
  total: number;
  /** 1-based page numbers this chunk covers. */
  pages: number[];
  keyLabel: string;
  /** Which review pass this request belongs to. */
  pass: PassKind;
  /** 1-based pass number out of the plan's total. */
  passIndex: number;
  passTotal: number;
}

export interface AnalyzeHooks {
  signal?: AbortSignal;
  onChunkStart?: (info: ChunkInfo) => void;
  onChunkDone?: (info: ChunkInfo & { highlights: number; ms: number }) => void;
  onRetry?: (info: { index: number; attempt: number; reason: string }) => void;
}

/** What the caller wants analysed, and how thoroughly. */
export interface AnalyzeRequest {
  courseCode: string;
  handoutName: string;
  coverage: CoverageMode;
}

export interface AnalysisResult {
  highlights: AiHighlight[];
  /** AI requests actually spent, for the coverage report. */
  requests: number;
}

const PASS_LABEL: Record<PassKind, string> = {
  primary: 'first pass',
  gap: 'gap sweep',
  structured: 'definition sweep',
};

export function passLabel(kind: PassKind): string {
  return PASS_LABEL[kind];
}

function pageLabel(chunk: Chunk): number[] {
  return chunk.pageIndices.map((index) => index + 1);
}

/** Build the limits object the pool needs from the user's settings. */
export function poolLimits(config: AiConfig): PoolLimits {
  return {
    requestsPerMinutePerKey: Math.max(0, config.requestsPerMinutePerKey),
    dailyBudgetPerKey: Math.max(0, config.dailyBudgetPerKey),
    maxParallel: Math.max(1, config.maxParallelRequests),
  };
}

/** A pool holding a single key, for providers that do not use the pool. */
export function singleKeyPool(config: AiConfig, usage?: DailyUsage): KeyPool {
  return new KeyPool(
    [{ id: 'proxy', label: 'Proxy', key: 'proxy', enabled: true }],
    poolLimits(config),
    {},
    usage,
  );
}

/** Dedupe candidates by their normalized text, keeping the first seen. */
function dedupe(highlights: readonly AiHighlight[]): AiHighlight[] {
  const seen = new Set<string>();
  const out: AiHighlight[] = [];
  for (const highlight of highlights) {
    const key = normalizeQuote(highlight.text);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(highlight);
  }
  return out;
}

/**
 * One request to the model. JSON problems are retried here, on the same key,
 * because a malformed reply is the model's fault rather than the key's.
 */
async function runPass(
  chunk: Chunk,
  meta: AnalyzeRequest,
  config: AiConfig,
  pool: KeyPool,
  pass: { kind: PassKind; share: number; index: number; total: number },
  alreadySelected: readonly string[],
  info: { index: number; total: number },
  hooks: AnalyzeHooks,
): Promise<AiHighlight[]> {
  const pages = pageLabel(chunk);
  const mode = meta.coverage;
  const system =
    pass.kind === 'primary'
      ? systemPrompt(mode)
      : pass.kind === 'gap'
        ? sweepSystemPrompt(mode)
        : structuredSystemPrompt();

  const user = buildUserMessage(
    {
      content: chunk.content,
      courseCode: meta.courseCode,
      handoutName: meta.handoutName,
      maxHighlights: Math.max(3, Math.round(chunk.maxHighlights * pass.share)),
    },
    pass.kind === 'primary' ? [] : alreadySelected,
  );

  const task = `${meta.handoutName} · pages ${pages[0]}-${pages[pages.length - 1]} · ${PASS_LABEL[pass.kind]}`;
  const shared = {
    ...info,
    pages,
    pass: pass.kind,
    passIndex: pass.index,
    passTotal: pass.total,
  };

  return pool.run(
    task,
    async (key, keyLabel) => {
      const auth: ProviderAuth = { apiKey: key, proxyUrl: config.proxyUrl };
      const started = Date.now();
      hooks.onChunkStart?.({ ...shared, keyLabel });

      let lastError: AiError | null = null;
      for (let attempt = 1; attempt <= JSON_ATTEMPTS; attempt += 1) {
        if (hooks.signal?.aborted) throw new AiError('Processing was stopped.', 'unknown', false);
        try {
          const reply = await complete(
            config,
            auth,
            attempt === 1 ? system : system + JSON_REMINDER,
            user,
            4096,
            hooks.signal,
          );
          const parsed = parseAiResponse(reply);
          hooks.onChunkDone?.({
            ...shared,
            keyLabel,
            highlights: parsed.highlights.length,
            ms: Date.now() - started,
          });
          return parsed.highlights;
        } catch (error) {
          const aiError =
            error instanceof AiError
              ? error
              : new AiError(error instanceof Error ? error.message : 'Unknown AI failure.', 'unknown', false);
          lastError = aiError;
          // Anything that is not a bad reply belongs to the pool to handle.
          if (aiError.kind !== 'invalid-response' || attempt === JSON_ATTEMPTS) throw aiError;
          hooks.onRetry?.({ index: info.index, attempt, reason: aiError.message });
        }
      }
      throw lastError ?? new AiError('The AI request failed.', 'unknown', false);
    },
    hooks.signal,
  );
}

/**
 * Analyse one chunk with every pass the coverage mode calls for. The passes
 * run in order because each later one is told what the earlier ones already
 * found — that exclusion list is what makes a sweep recover misses instead of
 * returning the same spans again.
 *
 * A sweep that fails does not fail the handout: the primary pass already
 * produced usable highlights, and losing them to a rate limit on an extra
 * request would be worse than slightly thinner coverage.
 */
async function analyzeChunk(
  chunk: Chunk,
  meta: AnalyzeRequest,
  config: AiConfig,
  pool: KeyPool,
  info: { index: number; total: number },
  hooks: AnalyzeHooks,
): Promise<{ highlights: AiHighlight[]; requests: number }> {
  const plan = passPlan(meta.coverage);
  const collected: AiHighlight[] = [];
  let requests = 0;

  for (let i = 0; i < plan.length; i += 1) {
    const pass = plan[i];
    if (!pass) continue;
    const descriptor = { ...pass, index: i + 1, total: plan.length };
    try {
      const found = await runPass(
        chunk,
        meta,
        config,
        pool,
        descriptor,
        collected.map((highlight) => highlight.text),
        info,
        hooks,
      );
      requests += 1;
      collected.push(...found);
    } catch (error) {
      requests += 1;
      if (pass.kind === 'primary') throw error;
      const reason = error instanceof Error ? error.message : 'unknown error';
      hooks.onRetry?.({ index: info.index, attempt: descriptor.index, reason: `${PASS_LABEL[pass.kind]} skipped — ${reason}` });
      break;
    }
  }

  return { highlights: dedupe(collected), requests };
}

/**
 * Analyse a whole document. Chunks run concurrently up to the pool's
 * parallelism, and the first hard failure fails the handout — a partially
 * analysed handout would be highlighted from incomplete information.
 */
export async function analyzeDocument(
  text: DocumentText,
  meta: AnalyzeRequest,
  config: AiConfig,
  pool: KeyPool,
  hooks: AnalyzeHooks = {},
): Promise<AnalysisResult> {
  validateConfig(config);
  const chunks = buildChunks(text.pages, meta.coverage);
  const results: AiHighlight[][] = new Array<AiHighlight[]>(chunks.length).fill([]);
  const counts: number[] = new Array<number>(chunks.length).fill(0);

  let cursor = 0;
  let failure: unknown = null;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (failure !== null || hooks.signal?.aborted) return;
      const index = cursor;
      cursor += 1;
      const chunk = chunks[index];
      if (!chunk) return;
      try {
        const outcome = await analyzeChunk(
          chunk,
          meta,
          config,
          pool,
          { index: index + 1, total: chunks.length },
          hooks,
        );
        results[index] = outcome.highlights;
        counts[index] = outcome.requests;
      } catch (error) {
        // Record the first failure and let the other workers wind down.
        if (failure === null) failure = error;
        return;
      }
    }
  };

  const lanes = Math.max(1, Math.min(pool.parallelism, chunks.length || 1));
  await Promise.all(Array.from({ length: lanes }, worker));

  if (failure !== null) throw failure;
  if (hooks.signal?.aborted) throw new AiError('Processing was stopped.', 'unknown', false);
  return {
    highlights: dedupe(results.flat()),
    requests: counts.reduce((sum, value) => sum + value, 0),
  };
}

/** Reject an unusable configuration before any request is attempted. */
export function validateConfig(config: AiConfig): void {
  const meta = providerMeta(config.provider);
  if (meta.browserDirect) {
    const usable = config.keys.filter((entry) => entry.enabled && entry.key.trim().length > 0);
    if (usable.length === 0) {
      throw new AiError('Add at least one API key before processing.', 'auth', false);
    }
  }
  if (config.provider === 'proxy' && config.proxyUrl.trim().length === 0) {
    throw new AiError('Add your proxy endpoint URL before processing.', 'unknown', false);
  }
  if (config.model.trim().length === 0) {
    throw new AiError('Choose an AI model before processing.', 'model', false);
  }
}

export interface ConnectionResult {
  label: string;
  ok: boolean;
  message: string;
  ms: number;
}

/**
 * A real round-trip per key, so a bad key in a pool of ten is identified
 * before a 300-handout batch starts rather than during it.
 */
export async function testConnection(config: AiConfig): Promise<ConnectionResult[]> {
  validateConfig(config);
  const meta = providerMeta(config.provider);
  const targets: { label: string; key: string }[] = meta.browserDirect
    ? config.keys
        .filter((entry) => entry.enabled && entry.key.trim().length > 0)
        .map((entry) => ({ label: entry.label, key: entry.key }))
    : [{ label: 'Proxy', key: '' }];

  const results: ConnectionResult[] = [];
  for (const target of targets) {
    const started = Date.now();
    try {
      const reply = await complete(
        config,
        { apiKey: target.key, proxyUrl: config.proxyUrl },
        'You verify API connectivity. Reply with JSON only.',
        'Reply with exactly {"highlights":[]} and nothing else.',
        64,
      );
      parseAiResponse(reply);
      results.push({
        label: target.label,
        ok: true,
        message: `OK — ${config.model} responded correctly.`,
        ms: Date.now() - started,
      });
    } catch (error) {
      results.push({
        label: target.label,
        ok: false,
        message: error instanceof Error ? error.message : 'Connection failed.',
        ms: Date.now() - started,
      });
    }
  }
  return results;
}

/** Label used when the UI has to describe the provider in one word. */
export function providerLabel(config: AiConfig): string {
  return PROVIDERS.find((entry) => entry.id === config.provider)?.label ?? config.provider;
}
