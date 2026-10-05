import type { Settings } from '../types';
import { DEFAULT_HIGHLIGHT_COLOR, DEFAULT_SUFFIX } from '../constants';
import { PROVIDERS } from '../services/ai';

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    provider: 'anthropic',
    apiKey: '',
    model: PROVIDERS[0]?.defaultModel ?? '',
    temperature: 0.1,
    proxyUrl: '',
    rememberKey: false,
  },
  highlight: {
    color: DEFAULT_HIGHLIGHT_COLOR,
    opacity: 0.38,
    minImportance: 'medium',
    maxPerPage: 6,
    minConfidence: 0.9,
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

/** Merge stored settings over the defaults without trusting their shape. */
export function mergeSettings(stored: Partial<Settings>, apiKey: string): Settings {
  return {
    ai: { ...DEFAULT_SETTINGS.ai, ...(stored.ai ?? {}), apiKey },
    highlight: { ...DEFAULT_SETTINGS.highlight, ...(stored.highlight ?? {}) },
    content: { ...DEFAULT_SETTINGS.content, ...(stored.content ?? {}) },
    output: { ...DEFAULT_SETTINGS.output, ...(stored.output ?? {}) },
    theme: stored.theme === 'dark' ? 'dark' : 'light',
  };
}
