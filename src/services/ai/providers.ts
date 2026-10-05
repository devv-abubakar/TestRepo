/**
 * Provider abstraction.
 *
 * Every provider reduces to the same operation: take a system prompt and a
 * user message, return the model's raw text. Everything provider-specific —
 * endpoint, auth header, body shape, where the text hides in the response —
 * lives behind that single call, so adding a provider is one object.
 */
import { AiError, type ProviderId, type ProviderMeta } from '../../types';

export const PROVIDERS: readonly ProviderMeta[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    models: ['gemini-3.1-flash-lite', 'gemini-3.1-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultModel: 'gemini-3.1-flash-lite',
    browserDirect: true,
    keyHint: 'Google AI Studio key — one per cloud project multiplies the free quota',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'],
    defaultModel: 'claude-sonnet-5-5',
    browserDirect: true,
    keyHint: 'Starts with sk-ant-',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
    defaultModel: 'gpt-4.1-mini',
    browserDirect: true,
    keyHint: 'Starts with sk-',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'proxy',
    label: 'Secure backend proxy (recommended for deployment)',
    models: [],
    defaultModel: '',
    browserDirect: false,
    keyHint: 'No key needed in the browser — the proxy holds it',
    docsUrl: 'https://code.claude.com/docs',
  },
];

export function providerMeta(id: ProviderId): ProviderMeta {
  const found = PROVIDERS.find((p) => p.id === id);
  if (!found) throw new AiError(`Unknown AI provider "${id}".`, 'unknown', false);
  return found;
}

export interface CompletionRequest {
  system: string;
  user: string;
  model: string;
  temperature: number;
  maxTokens: number;
  signal: AbortSignal;
}

/** Credentials for one request. The pool decides which key is used. */
export interface ProviderAuth {
  apiKey: string;
  proxyUrl: string;
}

export interface Provider {
  readonly id: ProviderId;
  /** Return the model's raw text output. */
  complete(request: CompletionRequest, auth: ProviderAuth): Promise<string>;
}

/** Translate an HTTP failure into something a user can act on. */
function httpError(status: number, body: string): AiError {
  const detail = body.slice(0, 400).replace(/\s+/g, ' ').trim();
  if (status === 401 || status === 403) {
    return new AiError('Invalid API key or insufficient permissions.', 'auth', false);
  }
  if (status === 429) {
    // Gemini reports both per-minute and per-day exhaustion as 429; the body
    // is what tells them apart, so it is kept in the message for the pool.
    return new AiError(`Rate limit reached for this API key. ${detail}`, 'rate-limit', true);
  }
  if (status === 404) {
    return new AiError(`Model unavailable for this key. ${detail}`, 'model', false);
  }
  if (status === 400 || status === 422) {
    return new AiError(`The AI provider rejected the request. ${detail}`, 'model', false);
  }
  if (status >= 500) {
    return new AiError(`AI provider is unavailable (HTTP ${status}).`, 'network', true);
  }
  return new AiError(`AI request failed (HTTP ${status}). ${detail}`, 'unknown', status >= 500);
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AiError('The AI request timed out.', 'timeout', true);
    }
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new AiError(
      `Could not reach the AI provider (${reason}). Check your connection, and note that ` +
        'some providers block browser requests unless a backend proxy is used.',
      'network',
      true,
    );
  }
  if (!response.ok) throw httpError(response.status, await response.text().catch(() => ''));
  return response.json();
}

/** Safe nested read; provider responses are untrusted shapes. */
function dig(source: unknown, path: readonly (string | number)[]): unknown {
  let node: unknown = source;
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

function requireText(value: unknown, provider: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new AiError(`${provider} returned an empty response.`, 'invalid-response', true);
}

const anthropic: Provider = {
  id: 'anthropic',
  async complete(request, auth) {
    const json = await postJson(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': auth.apiKey,
        'anthropic-version': '2023-06-01',
        // Required for browser-originated calls (BYOK mode).
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      {
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      },
      request.signal,
    );
    const blocks = dig(json, ['content']);
    if (Array.isArray(blocks)) {
      const text = blocks
        .map((block) => (typeof dig(block, ['text']) === 'string' ? (dig(block, ['text']) as string) : ''))
        .join('');
      return requireText(text, 'Anthropic');
    }
    return requireText(undefined, 'Anthropic');
  },
};

const openai: Provider = {
  id: 'openai',
  async complete(request, auth) {
    const json = await postJson(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${auth.apiKey}` },
      {
        model: request.model,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      },
      request.signal,
    );
    return requireText(dig(json, ['choices', 0, 'message', 'content']), 'OpenAI');
  },
};

const gemini: Provider = {
  id: 'gemini',
  async complete(request, auth) {
    const model = encodeURIComponent(request.model);
    const json = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { 'x-goog-api-key': auth.apiKey },
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
          responseMimeType: 'application/json',
        },
      },
      request.signal,
    );
    const parts = dig(json, ['candidates', 0, 'content', 'parts']);
    if (Array.isArray(parts)) {
      const text = parts
        .map((part) => (typeof dig(part, ['text']) === 'string' ? (dig(part, ['text']) as string) : ''))
        .join('');
      return requireText(text, 'Gemini');
    }
    return requireText(undefined, 'Gemini');
  },
};

/**
 * Backend proxy mode: the browser never sees a provider key. The endpoint
 * takes {model, system, user, temperature, maxTokens} and answers {text}.
 */
const proxy: Provider = {
  id: 'proxy',
  async complete(request, auth) {
    const url = auth.proxyUrl.trim();
    if (url.length === 0) {
      throw new AiError('No proxy endpoint URL is configured.', 'unknown', false);
    }
    const json = await postJson(
      url,
      {},
      {
        model: request.model,
        system: request.system,
        user: request.user,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      },
      request.signal,
    );
    const text = dig(json, ['text']);
    if (typeof text === 'string') return requireText(text, 'Proxy');
    // Tolerate a proxy that simply forwards an OpenAI-shaped response.
    return requireText(dig(json, ['choices', 0, 'message', 'content']), 'Proxy');
  },
};

const REGISTRY: Record<ProviderId, Provider> = { anthropic, openai, gemini, proxy };

export function getProvider(id: ProviderId): Provider {
  const provider = REGISTRY[id];
  if (!provider) throw new AiError(`Unknown AI provider "${id}".`, 'unknown', false);
  return provider;
}
