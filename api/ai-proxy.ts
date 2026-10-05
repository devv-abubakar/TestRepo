/**
 * Optional serverless proxy for AI requests.
 *
 * Deploying this keeps the provider key server-side: the browser posts the
 * extracted text and gets the model's reply, never seeing a secret. Select
 * "Secure backend proxy" in the app's AI settings and point it at this route.
 *
 * Written against the standard Request/Response API, so it runs unchanged on
 * Vercel (Edge or Node), Netlify Functions v2, Cloudflare Workers and Deno
 * Deploy. For Vercel Edge, add `export const config = { runtime: 'edge' }`.
 *
 * Required environment variables:
 *   AI_PROVIDER        anthropic | openai | gemini   (default: anthropic)
 *   ANTHROPIC_API_KEY  when AI_PROVIDER=anthropic
 *   OPENAI_API_KEY     when AI_PROVIDER=openai
 *   GEMINI_API_KEY     when AI_PROVIDER=gemini
 * Optional:
 *   AI_ALLOWED_ORIGIN  exact origin allowed to call this route (default: *)
 *   AI_MODEL_ALLOWLIST comma-separated model ids this route will accept
 */

interface ProxyRequest {
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
}

/** Hard ceiling on the payload, so the route cannot be used as a relay. */
const MAX_BODY_BYTES = 200_000;
const MAX_OUTPUT_TOKENS = 8192;

function env(name: string): string | undefined {
  // Works across runtimes that expose either process.env or Deno.env.
  const fromProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (fromProcess?.env?.[name]) return fromProcess.env[name];
  const deno = (globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }).Deno;
  return deno?.env?.get(name);
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': env('AI_ALLOWED_ORIGIN') ?? '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  });
}

function parseBody(raw: unknown): ProxyRequest | string {
  if (typeof raw !== 'object' || raw === null) return 'Body must be a JSON object.';
  const record = raw as Record<string, unknown>;
  const { model, system, user } = record;
  if (typeof model !== 'string' || model.trim().length === 0) return 'A "model" is required.';
  if (typeof system !== 'string' || typeof user !== 'string') return '"system" and "user" are required.';

  const allowlist = (env('AI_MODEL_ALLOWLIST') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (allowlist.length > 0 && !allowlist.includes(model)) {
    return `Model "${model}" is not allowed by this proxy.`;
  }

  const temperature = typeof record.temperature === 'number' ? record.temperature : 0.1;
  const maxTokens = typeof record.maxTokens === 'number' ? record.maxTokens : 4096;
  return {
    model,
    system,
    user,
    temperature: Math.min(Math.max(temperature, 0), 1),
    maxTokens: Math.min(Math.max(Math.round(maxTokens), 1), MAX_OUTPUT_TOKENS),
  };
}

async function callAnthropic(key: string, request: ProxyRequest): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic responded ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { content?: { text?: string }[] };
  return (body.content ?? []).map((block) => block.text ?? '').join('');
}

async function callOpenai(key: string, request: ProxyRequest): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: request.model,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI responded ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? '';
}

async function callGemini(key: string, request: ProxyRequest): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    request.model,
  )}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.user }] }],
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!response.ok) throw new Error(`Gemini responded ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (body.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large.' }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const body = parseBody(parsed);
  if (typeof body === 'string') return json({ error: body }, 400);

  const provider = (env('AI_PROVIDER') ?? 'anthropic').toLowerCase();
  const keyName =
    provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY';
  const key = env(keyName);
  if (!key) return json({ error: `${keyName} is not configured on the server.` }, 500);

  try {
    const text =
      provider === 'openai'
        ? await callOpenai(key, body)
        : provider === 'gemini'
          ? await callGemini(key, body)
          : await callAnthropic(key, body);
    if (text.trim().length === 0) return json({ error: 'The model returned an empty reply.' }, 502);
    return json({ text });
  } catch (error) {
    // The upstream message can carry request details but never the key.
    const message = error instanceof Error ? error.message : 'Upstream AI request failed.';
    return json({ error: message }, 502);
  }
}
