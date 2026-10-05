/**
 * Analysis orchestration: chunk the handout, call the provider, validate the
 * JSON strictly, and retry only where retrying can actually help.
 */
import {
  AiError,
  type AiConfig,
  type AiHighlight,
  type AiResponse,
  type DocumentText,
  type Importance,
} from '../../types';
import { buildChunks, buildUserMessage, SYSTEM_PROMPT } from './prompt';
import { getProvider, PROVIDERS, providerMeta } from './providers';

export { PROVIDERS, providerMeta } from './providers';
export { SYSTEM_PROMPT } from './prompt';

/** Per-request wall clock budget. */
const REQUEST_TIMEOUT_MS = 120_000;
/** Attempts per chunk, including the first. */
const MAX_ATTEMPTS = 3;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function complete(
  config: AiConfig,
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
      config,
    );
  } finally {
    clearTimeout(timer);
    abort?.removeEventListener('abort', onAbort);
  }
}

export interface AnalyzeHooks {
  onChunk?: (done: number, total: number) => void;
  onRetry?: (attempt: number, reason: string) => void;
  signal?: AbortSignal;
}

/**
 * Analyse a whole document. Chunks are processed one at a time so a long
 * handout never holds several large requests in flight, and a chunk that
 * cannot be analysed fails the handout rather than silently losing content.
 */
export async function analyzeDocument(
  text: DocumentText,
  meta: { courseCode: string; handoutName: string },
  config: AiConfig,
  hooks: AnalyzeHooks = {},
): Promise<AiHighlight[]> {
  validateConfig(config);
  const chunks = buildChunks(text.pages);
  const all: AiHighlight[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) continue;
    hooks.onChunk?.(i, chunks.length);

    const user = buildUserMessage({
      content: chunk.content,
      courseCode: meta.courseCode,
      handoutName: meta.handoutName,
      maxHighlights: chunk.maxHighlights,
    });

    let lastError: AiError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (hooks.signal?.aborted) throw new AiError('Processing was stopped.', 'unknown', false);
      try {
        const reply = await complete(
          config,
          attempt === 1 ? SYSTEM_PROMPT : SYSTEM_PROMPT + JSON_REMINDER,
          user,
          4096,
          hooks.signal,
        );
        const parsed = parseAiResponse(reply);
        all.push(...parsed.highlights);
        lastError = null;
        break;
      } catch (error) {
        const aiError =
          error instanceof AiError
            ? error
            : new AiError(error instanceof Error ? error.message : 'Unknown AI failure.', 'unknown', false);
        lastError = aiError;
        if (!aiError.retryable || attempt === MAX_ATTEMPTS) break;
        hooks.onRetry?.(attempt, aiError.message);
        // Back off further for rate limits than for a malformed reply.
        const base = aiError.kind === 'rate-limit' ? 4000 : 1200;
        await sleep(base * attempt);
      }
    }
    if (lastError) throw lastError;
  }

  hooks.onChunk?.(chunks.length, chunks.length);
  return all;
}

/** Reject an unusable configuration before any request is attempted. */
export function validateConfig(config: AiConfig): void {
  const meta = providerMeta(config.provider);
  if (meta.browserDirect && config.apiKey.trim().length === 0) {
    throw new AiError('Add your API key before processing.', 'auth', false);
  }
  if (config.provider === 'proxy' && config.proxyUrl.trim().length === 0) {
    throw new AiError('Add your proxy endpoint URL before processing.', 'unknown', false);
  }
  if (config.model.trim().length === 0) {
    throw new AiError('Choose an AI model before processing.', 'model', false);
  }
}

/** A real round-trip against the configured provider, used by Test Connection. */
export async function testConnection(config: AiConfig): Promise<string> {
  validateConfig(config);
  const reply = await complete(
    config,
    'You verify API connectivity. Reply with JSON only.',
    'Reply with exactly {"highlights":[]} and nothing else.',
    64,
  );
  parseAiResponse(reply);
  const label = PROVIDERS.find((p) => p.id === config.provider)?.label ?? config.provider;
  return `${label} responded correctly using ${config.model}.`;
}
