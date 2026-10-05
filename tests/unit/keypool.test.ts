import { describe, expect, it } from 'vitest';
import { KeyPool, type PoolLimits } from '../../src/services/ai/keypool';
import { AiError, type ApiKeyEntry } from '../../src/types';

const LIMITS: PoolLimits = {
  requestsPerMinutePerKey: 0,
  dailyBudgetPerKey: 0,
  maxParallel: 4,
};

function keys(count: number): ApiKeyEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `k${i + 1}`,
    label: `Project ${String.fromCharCode(65 + i)}`,
    key: `secret-value-${i + 1}`,
    enabled: true,
  }));
}

const rateLimit = () => new AiError('Rate limit reached for this API key.', 'rate-limit', true);
const authError = () => new AiError('Invalid API key.', 'auth', false);

describe('KeyPool rotation', () => {
  it('spreads consecutive requests across every key', async () => {
    const pool = new KeyPool(keys(3), LIMITS);
    const used: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await pool.run('task', async (_key, label) => {
        used.push(label);
      });
    }
    expect(new Set(used).size).toBe(3);
    // Least-recently-used ordering means a clean round robin.
    expect(used.slice(0, 3)).toEqual(['Project A', 'Project B', 'Project C']);
  });

  it('ignores disabled and blank keys', () => {
    const entries = keys(3);
    entries[1]!.enabled = false;
    entries[2]!.key = '   ';
    const pool = new KeyPool(entries, LIMITS);
    expect(pool.total).toBe(1);
    expect(pool.stats().map((row) => row.label)).toEqual(['Project A']);
  });

  it('runs requests in parallel up to the configured ceiling', async () => {
    const pool = new KeyPool(keys(4), { ...LIMITS, maxParallel: 2 });
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        pool.run('task', async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 15));
          inFlight -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it('spaces requests from one key to respect its per-minute limit', async () => {
    // 600 rpm is one request every 100 ms.
    const pool = new KeyPool(keys(1), { ...LIMITS, requestsPerMinutePerKey: 600 });
    const started = Date.now();
    await pool.run('a', async () => undefined);
    await pool.run('b', async () => undefined);
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
  });

  it('never exposes a key value through its stats', async () => {
    const pool = new KeyPool(keys(2), LIMITS);
    await pool.run('task', async () => undefined);
    const serialized = JSON.stringify(pool.stats());
    expect(serialized).not.toContain('secret-value');
  });
});

describe('KeyPool failure handling', () => {
  it('moves the work to another key when one is rate-limited', async () => {
    const pool = new KeyPool(keys(2), LIMITS);
    const seen: string[] = [];
    const result = await pool.run('task', async (_key, label) => {
      seen.push(label);
      if (seen.length === 1) throw rateLimit();
      return 'done';
    });
    expect(result).toBe('done');
    expect(seen).toEqual(['Project A', 'Project B']);
    const first = pool.stats().find((row) => row.label === 'Project A');
    expect(first?.status).toBe('cooling');
    expect(first?.rateLimited).toBe(1);
    expect(first?.cooldownUntil).toBeGreaterThan(Date.now());
  });

  it('disables a key the provider rejects, and succeeds on the next one', async () => {
    const pool = new KeyPool(keys(2), LIMITS);
    const result = await pool.run('task', async (_key, label) => {
      if (label === 'Project A') throw authError();
      return label;
    });
    expect(result).toBe('Project B');
    expect(pool.stats().find((row) => row.label === 'Project A')?.status).toBe('disabled');
    expect(pool.size).toBe(1);
  });

  it('reports a clear error once every key is unusable', async () => {
    const pool = new KeyPool(keys(2), LIMITS);
    await expect(
      pool.run('task', async () => {
        throw authError();
      }),
    ).rejects.toThrow(/disabled or invalid/i);
  });

  it('does not penalise a key for a problem that is not its fault', async () => {
    const pool = new KeyPool(keys(2), LIMITS);
    await expect(
      pool.run('task', async () => {
        throw new AiError('The AI reply was not valid JSON.', 'invalid-response', true);
      }),
    ).rejects.toThrow(/valid JSON/);
    // One attempt only, and the key stays available.
    const stats = pool.stats();
    expect(stats.reduce((sum, row) => sum + row.requests, 0)).toBe(1);
    expect(stats.every((row) => row.status === 'idle')).toBe(true);
  });

  it('parks a key that reaches its daily budget', async () => {
    const pool = new KeyPool(keys(2), { ...LIMITS, dailyBudgetPerKey: 1 });
    await pool.run('a', async () => undefined);
    await pool.run('b', async () => undefined);
    expect(pool.stats().every((row) => row.status === 'exhausted')).toBe(true);
    await expect(pool.run('c', async () => undefined)).rejects.toThrow(/daily quota/i);
  });

  it('restores usage carried over from an earlier session on the same day', () => {
    const day = new Date().toISOString().slice(0, 10);
    const pool = new KeyPool(
      keys(2),
      { ...LIMITS, dailyBudgetPerKey: 10 },
      {},
      { day, used: { k1: 10, k2: 3 } },
    );
    const stats = pool.stats();
    expect(stats[0]?.status).toBe('exhausted');
    expect(stats[1]?.usedToday).toBe(3);
    expect(pool.size).toBe(1);
  });

  it('ignores usage recorded on a previous day', () => {
    const pool = new KeyPool(
      keys(1),
      { ...LIMITS, dailyBudgetPerKey: 10 },
      {},
      { day: '2000-01-01', used: { k1: 10 } },
    );
    expect(pool.stats()[0]?.usedToday).toBe(0);
    expect(pool.stats()[0]?.status).toBe('idle');
  });

  it('counts successes and failures per key', async () => {
    const pool = new KeyPool(keys(2), LIMITS);
    await pool.run('ok', async () => undefined);
    await pool.run('ok', async () => undefined);
    const stats = pool.stats();
    expect(stats.reduce((sum, row) => sum + row.succeeded, 0)).toBe(2);
    expect(stats.reduce((sum, row) => sum + row.failed, 0)).toBe(0);
  });

  it('refuses to run with no keys at all', async () => {
    const pool = new KeyPool([], LIMITS);
    await expect(pool.run('task', async () => undefined)).rejects.toThrow(/No API keys/i);
  });

  it('stops waiting when processing is cancelled', async () => {
    const pool = new KeyPool(keys(1), { ...LIMITS, dailyBudgetPerKey: 1 });
    await pool.run('a', async () => undefined);
    const controller = new AbortController();
    controller.abort();
    await expect(pool.run('b', async () => undefined, controller.signal)).rejects.toThrow();
  });
});

describe('KeyPool parallelism', () => {
  it('never claims more parallelism than it has usable keys', () => {
    const pool = new KeyPool(keys(2), { ...LIMITS, maxParallel: 8 });
    expect(pool.parallelism).toBe(2);
  });

  it('is capped by the configured maximum', () => {
    const pool = new KeyPool(keys(8), { ...LIMITS, maxParallel: 3 });
    expect(pool.parallelism).toBe(3);
  });
});
