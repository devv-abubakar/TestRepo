import type { ApiKeyEntry, CoverageMode, HighlightSettings, Settings } from '../types';
import { DEFAULT_HIGHLIGHT_COLOR, DEFAULT_SUFFIX } from '../constants';
import { PROVIDERS } from '../services/ai';

/** Free-tier Gemini keys are metered per project, so these are per key. */
export const DEFAULT_RPM_PER_KEY = 15;
export const DEFAULT_DAILY_BUDGET_PER_KEY = 1000;

export function newKeyEntry(index: number): ApiKeyEntry {
  return {
    id: `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    label: `Project ${String.fromCharCode(65 + Math.min(index, 25))}`,
    key: '',
    enabled: true,
  };
}

/**
 * The knobs each coverage mode sets. Selecting a mode writes these into the
 * settings so the advanced fields always show what is actually in force, and
 * stay editable afterwards.
 */
export const COVERAGE_PRESETS: Record<
  CoverageMode,
  Pick<
    HighlightSettings,
    'coverage' | 'minImportance' | 'maxPerPage' | 'pageCoverageCeiling' | 'minConfidence' | 'ruleBasedSweep'
  >
> = {
  selective: {
    coverage: 'selective',
    minImportance: 'medium',
    maxPerPage: 6,
    // Kept on the slider's 0.05 step grid, so the control cannot display a
    // value that differs from the one actually in force.
    pageCoverageCeiling: 0.35,
    minConfidence: 0.9,
    ruleBasedSweep: false,
  },
  balanced: {
    coverage: 'balanced',
    minImportance: 'low',
    maxPerPage: 10,
    pageCoverageCeiling: 0.5,
    minConfidence: 0.9,
    ruleBasedSweep: true,
  },
  complete: {
    coverage: 'complete',
    minImportance: 'low',
    // Uncapped per page: the coverage ceiling is the limit that matters here.
    maxPerPage: 0,
    pageCoverageCeiling: 0.75,
    minConfidence: 0.88,
    ruleBasedSweep: true,
  },
};

/** Rough number of AI requests each mode spends per chunk of text. */
export const PASSES_PER_CHUNK: Record<CoverageMode, number> = {
  selective: 1,
  balanced: 2,
  complete: 3,
};

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    provider: 'gemini',
    keys: [],
    model: PROVIDERS[0]?.defaultModel ?? 'gemini-3.1-flash-lite',
    temperature: 0.1,
    proxyUrl: '',
    rememberKey: false,
    requestsPerMinutePerKey: DEFAULT_RPM_PER_KEY,
    dailyBudgetPerKey: DEFAULT_DAILY_BUDGET_PER_KEY,
    maxParallelRequests: 4,
  },
  highlight: {
    color: DEFAULT_HIGHLIGHT_COLOR,
    opacity: 0.38,
    ...COVERAGE_PRESETS.complete,
  },
  content: {
    addStudyMessage: true,
    addStudentsGuide: true,
    addWhatsApp: true,
  },
  output: {
    suffix: DEFAULT_SUFFIX,
    reprocessExisting: false,
    concurrency: 2,
  },
  theme: 'light',
};

/** Keys restored from storage are merged back in, never invented. */
function mergeKeys(stored: unknown, restored: ApiKeyEntry[]): ApiKeyEntry[] {
  const shells = Array.isArray(stored) ? (stored as Partial<ApiKeyEntry>[]) : [];
  const byId = new Map(restored.map((entry) => [entry.id, entry.key]));
  const merged: ApiKeyEntry[] = [];
  for (const shell of shells) {
    if (typeof shell?.id !== 'string') continue;
    merged.push({
      id: shell.id,
      label: typeof shell.label === 'string' && shell.label.length > 0 ? shell.label : 'Key',
      key: byId.get(shell.id) ?? '',
      enabled: shell.enabled !== false,
    });
  }
  // A remembered key whose shell is gone is still usable.
  for (const entry of restored) {
    if (!merged.some((row) => row.id === entry.id)) merged.push(entry);
  }
  return merged.length > 0 ? merged : [newKeyEntry(0)];
}

/** Merge stored settings over the defaults without trusting their shape. */
export function mergeSettings(stored: Partial<Settings>, keys: ApiKeyEntry[]): Settings {
  const ai = (stored.ai ?? {}) as Partial<Settings['ai']> & { keys?: unknown };
  return {
    ai: {
      ...DEFAULT_SETTINGS.ai,
      ...ai,
      keys: mergeKeys(ai.keys, keys),
    },
    highlight: { ...DEFAULT_SETTINGS.highlight, ...(stored.highlight ?? {}) },
    content: { ...DEFAULT_SETTINGS.content, ...(stored.content ?? {}) },
    output: { ...DEFAULT_SETTINGS.output, ...(stored.output ?? {}) },
    theme: stored.theme === 'dark' ? 'dark' : 'light',
  };
}
