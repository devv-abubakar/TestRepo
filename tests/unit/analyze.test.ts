import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeDocument, poolLimits } from '../../src/services/ai';
import { KeyPool } from '../../src/services/ai/keypool';
import { DEFAULT_SETTINGS } from '../../src/store/defaults';
import type { AiConfig, ApiKeyEntry, DocumentText } from '../../src/types';
import { makePage } from './helpers';

/**
 * These drive the real orchestration — chunking, the key pool, parallel
 * lanes, progress hooks — against a stubbed HTTP layer. The proxy provider is
 * used because it has the simplest wire format; the pool behaves identically
 * whichever provider sits behind it.
 */

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function keys(count: number): ApiKeyEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `k${i + 1}`,
    label: `Project ${String.fromCharCode(65 + i)}`,
    key: `key-${i + 1}`,
    enabled: true,
  }));
}

function config(patch: Partial<AiConfig> = {}): AiConfig {
  return {
    ...DEFAULT_SETTINGS.ai,
    provider: 'proxy',
    proxyUrl: 'https://example.invalid/api/ai-proxy',
    model: 'gemini-3.1-flash-lite',
    keys: keys(3),
    requestsPerMinutePerKey: 0,
    dailyBudgetPerKey: 0,
    ...patch,
  };
}

/** A document long enough to be split into several chunks. */
function longDocument(pages: number): DocumentText {
  const filler = 'word '.repeat(1800).trim();
  const built = Array.from({ length: pages }, (_, i) => makePage(i, [`page ${i + 1} ${filler}`]));
  return {
    pages: built,
    usedOcr: false,
    totalChars: built.reduce((sum, page) => sum + page.normalized.length, 0),
  };
}

function reply(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const META = { courseCode: 'CS101', handoutName: 'Handout 01.pdf', coverage: 'selective' as const };

describe('analyzeDocument', () => {
  it('collects highlights from every chunk', async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      return reply({
        text: JSON.stringify({
          highlights: [{ text: `span ${call}`, importance: 'high', reason: 'Definition' }],
        }),
      });
    }) as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    const result = await analyzeDocument(longDocument(4), META, cfg, pool);

    expect(call).toBeGreaterThan(1);
    expect(result.requests).toBe(call);
    expect(result.highlights).toHaveLength(call);
    expect(result.highlights.map((h) => h.text)).toContain('span 1');
  });

  it('reports which key handled each chunk, and the page range', async () => {
    globalThis.fetch = vi.fn(async () =>
      reply({ text: '{"highlights":[{"text":"a span","importance":"high","reason":"r"}]}' }),
    ) as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    const starts: { index: number; total: number; pages: number[]; keyLabel: string }[] = [];
    const dones: { index: number; highlights: number }[] = [];

    await analyzeDocument(longDocument(4), META, cfg, pool, {
      onChunkStart: (info) => starts.push(info),
      onChunkDone: (info) => dones.push({ index: info.index, highlights: info.highlights }),
    });

    expect(starts.length).toBeGreaterThan(1);
    expect(dones).toHaveLength(starts.length);
    for (const start of starts) {
      expect(start.keyLabel).toMatch(/^Project [A-C]$/);
      expect(start.pages.length).toBeGreaterThan(0);
      expect(start.total).toBe(starts.length);
    }
    // Every chunk is reported exactly once, in a stable numbering.
    expect(new Set(starts.map((s) => s.index)).size).toBe(starts.length);
  });

  it('runs chunks in parallel across the pool', async () => {
    let inFlight = 0;
    let peak = 0;
    globalThis.fetch = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return reply({ text: '{"highlights":[]}' });
    }) as typeof fetch;

    const cfg = config({ maxParallelRequests: 3 });
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    await analyzeDocument(longDocument(6), META, cfg, pool);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('moves a rate-limited chunk to another key and still finishes', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('{"error":"quota"}', { status: 429 });
      }
      return reply({ text: '{"highlights":[{"text":"kept","importance":"high","reason":"r"}]}' });
    }) as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    const { highlights } = await analyzeDocument(longDocument(3), META, cfg, pool);

    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights.every((h) => h.text === 'kept')).toBe(true);
    expect(pool.stats().some((row) => row.rateLimited === 1)).toBe(true);
  });

  it('retries a malformed reply once on the same key before failing', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return reply({ text: calls === 1 ? 'Sorry, I cannot do that.' : '{"highlights":[]}' });
    }) as typeof fetch;

    const cfg = config({ keys: keys(1) });
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    const retries: number[] = [];
    const { highlights } = await analyzeDocument(
      {
        pages: [makePage(0, ['a short single page of content'])],
        usedOcr: false,
        totalChars: 30,
      },
      META,
      cfg,
      pool,
      { onRetry: (info) => retries.push(info.attempt) },
    );

    expect(retries).toEqual([1]);
    expect(highlights).toEqual([]);
    expect(calls).toBe(2);
  });

  it('fails the handout when a chunk cannot be analysed at all', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    await expect(analyzeDocument(longDocument(3), META, cfg, pool)).rejects.toThrow(/key|permission/i);
  });

  it('refuses to start without a usable key', async () => {
    const cfg = config({ provider: 'gemini', keys: [] });
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    await expect(analyzeDocument(longDocument(2), META, cfg, pool)).rejects.toThrow(
      /at least one API key/i,
    );
  });

  it('stops promptly when processing is cancelled', async () => {
    globalThis.fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return reply({ text: '{"highlights":[]}' });
    }) as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    await expect(
      analyzeDocument(longDocument(8), META, cfg, pool, { signal: controller.signal }),
    ).rejects.toThrow(/stopped/i);
  });
});

describe('analyzeDocument coverage modes', () => {
  /** A single short page, so request counts are purely about passes. */
  function onePage(): DocumentText {
    return {
      pages: [makePage(0, ['Inflation is defined as a sustained increase in the price level.'])],
      usedOcr: false,
      totalChars: 64,
    };
  }

  it('spends one request per chunk in selective mode', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return reply({ text: '{"highlights":[]}' });
    }) as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    const result = await analyzeDocument(onePage(), { ...META, coverage: 'selective' }, cfg, pool);
    expect(calls).toBe(1);
    expect(result.requests).toBe(1);
  });

  it('adds a gap sweep in balanced mode', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return reply({ text: '{"highlights":[]}' });
    }) as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    await analyzeDocument(onePage(), { ...META, coverage: 'balanced' }, cfg, pool);
    expect(calls).toBe(2);
  });

  it('runs three passes in complete mode and reports each one', async () => {
    globalThis.fetch = vi.fn(async () => reply({ text: '{"highlights":[]}' })) as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    const passes: string[] = [];
    const result = await analyzeDocument(onePage(), { ...META, coverage: 'complete' }, cfg, pool, {
      onChunkDone: (info) => passes.push(info.pass),
    });

    expect(passes).toEqual(['primary', 'gap', 'structured']);
    expect(result.requests).toBe(3);
  });

  it('tells each sweep what the earlier passes already found', async () => {
    const bodies: string[] = [];
    let calls = 0;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      calls += 1;
      return reply({
        text: JSON.stringify({
          highlights: [{ text: `span from pass ${calls}`, importance: 'high', reason: 'r' }],
        }),
      });
    }) as unknown as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    const result = await analyzeDocument(onePage(), { ...META, coverage: 'complete' }, cfg, pool);

    expect(bodies).toHaveLength(3);
    expect(bodies[0]).not.toContain('ALREADY SELECTED');
    expect(bodies[1]).toContain('span from pass 1');
    // The third pass knows about both earlier ones.
    expect(bodies[2]).toContain('span from pass 1');
    expect(bodies[2]).toContain('span from pass 2');
    expect(result.highlights).toHaveLength(3);
  });

  it('collapses a span the sweep returns again', async () => {
    globalThis.fetch = vi.fn(async () =>
      reply({ text: '{"highlights":[{"text":"The same exact span","importance":"high","reason":"r"}]}' }),
    ) as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    const result = await analyzeDocument(onePage(), { ...META, coverage: 'complete' }, cfg, pool);
    expect(result.requests).toBe(3);
    expect(result.highlights).toHaveLength(1);
  });

  it('keeps the first pass when a sweep fails', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return reply({
          text: '{"highlights":[{"text":"kept from the first pass","importance":"high","reason":"r"}]}',
        });
      }
      return new Response('nope', { status: 401 });
    }) as typeof fetch;

    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    const notes: string[] = [];
    const result = await analyzeDocument(onePage(), { ...META, coverage: 'complete' }, cfg, pool, {
      onRetry: (info) => notes.push(info.reason),
    });

    expect(result.highlights.map((h) => h.text)).toEqual(['kept from the first pass']);
    expect(notes.some((note) => note.includes('gap sweep skipped'))).toBe(true);
  });

  it('still fails the handout when the first pass cannot run', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as typeof fetch;
    const cfg = config();
    const pool = new KeyPool(cfg.keys, poolLimits(cfg));
    await expect(
      analyzeDocument(onePage(), { ...META, coverage: 'complete' }, cfg, pool),
    ).rejects.toThrow();
  });
});
