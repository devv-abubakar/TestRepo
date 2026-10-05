/**
 * API key pool.
 *
 * Gemini's free tier is metered per cloud project, so several keys from
 * several projects add up: their per-minute and per-day quotas are
 * independent. The pool turns that into throughput by keeping one request in
 * flight per key, spacing each key's requests to stay inside its RPM limit,
 * and moving work to another key the moment one is rate-limited.
 *
 * Nothing here ever logs or returns a key value — only its label.
 */
import { AiError, type ApiKeyEntry, type KeyStats, type KeyStatus } from '../../types';

export interface PoolLimits {
  /** Requests per minute per key. 0 disables spacing. */
  requestsPerMinutePerKey: number;
  /** Requests per key per UTC day. 0 disables the budget. */
  dailyBudgetPerKey: number;
  /** Hard ceiling on concurrent requests across the pool. */
  maxParallel: number;
}

/** Usage that must survive a reload, so a daily budget is not forgotten. */
export interface DailyUsage {
  day: string;
  used: Record<string, number>;
}

/** Exponential cooldown applied to a key after consecutive rate limits. */
const RATE_LIMIT_COOLDOWNS_MS = [20_000, 45_000, 90_000, 180_000, 300_000];
const NETWORK_COOLDOWN_MS = 5_000;
/** One request at a time per key keeps the RPM accounting honest. */
const PER_KEY_IN_FLIGHT = 1;
/**
 * Longest the pool will block waiting for a key. A rate-limit cooldown is
 * seconds, so anything beyond this means the pool has nothing useful left and
 * the caller deserves to be told rather than left hanging.
 */
const MAX_WAIT_MS = 10 * 60_000;

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Epoch ms of the next UTC midnight, when free-tier day quotas reset. */
function nextUtcMidnight(now = Date.now()): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

interface Slot {
  entry: ApiKeyEntry;
  status: KeyStatus;
  inFlight: number;
  requests: number;
  succeeded: number;
  failed: number;
  rateLimited: number;
  consecutiveRateLimits: number;
  usedToday: number;
  cooldownUntil: number;
  /** Earliest time this key may send again, from the RPM spacing. */
  nextAllowedAt: number;
  lastUsedAt: number;
  lastError?: string;
  task?: string;
}

export interface PoolEvents {
  /** Called whenever any key's state changes. */
  onStats?: (stats: KeyStats[]) => void;
  /** Called when usage counters change, so they can be persisted. */
  onUsage?: (usage: DailyUsage) => void;
  /** Human-readable pool activity, already free of secrets. */
  onLog?: (level: 'info' | 'success' | 'warn' | 'error', message: string, keyLabel: string) => void;
}

export class KeyPool {
  private readonly slots: Slot[];
  private readonly waiters: (() => void)[] = [];
  private day: string;

  constructor(
    entries: readonly ApiKeyEntry[],
    private limits: PoolLimits,
    private readonly events: PoolEvents = {},
    usage?: DailyUsage,
  ) {
    this.day = utcDay();
    const carried = usage && usage.day === this.day ? usage.used : {};
    this.slots = entries
      .filter((entry) => entry.enabled && entry.key.trim().length > 0)
      .map((entry) => ({
        entry,
        status: 'idle' as KeyStatus,
        inFlight: 0,
        requests: 0,
        succeeded: 0,
        failed: 0,
        rateLimited: 0,
        consecutiveRateLimits: 0,
        usedToday: carried[entry.id] ?? 0,
        cooldownUntil: 0,
        nextAllowedAt: 0,
        lastUsedAt: 0,
      }));

    for (const slot of this.slots) {
      if (this.overBudget(slot)) {
        slot.status = 'exhausted';
        slot.cooldownUntil = nextUtcMidnight();
      }
    }
  }

  /** Number of keys that could serve a request now or later today. */
  get size(): number {
    return this.slots.filter((slot) => slot.status !== 'disabled' && slot.status !== 'exhausted').length;
  }

  get total(): number {
    return this.slots.length;
  }

  stats(): KeyStats[] {
    return this.slots.map((slot) => ({
      id: slot.entry.id,
      label: slot.entry.label,
      status: slot.status,
      inFlight: slot.inFlight,
      requests: slot.requests,
      succeeded: slot.succeeded,
      failed: slot.failed,
      rateLimited: slot.rateLimited,
      usedToday: slot.usedToday,
      cooldownUntil: slot.cooldownUntil,
      lastUsedAt: slot.lastUsedAt,
      ...(slot.lastError === undefined ? {} : { lastError: slot.lastError }),
      ...(slot.task === undefined ? {} : { task: slot.task }),
    }));
  }

  /** Effective parallelism: never more requests than usable keys. */
  get parallelism(): number {
    return Math.max(1, Math.min(this.limits.maxParallel, Math.max(this.size, 1)));
  }

  setLimits(limits: PoolLimits): void {
    this.limits = limits;
  }

  private overBudget(slot: Slot): boolean {
    return this.limits.dailyBudgetPerKey > 0 && slot.usedToday >= this.limits.dailyBudgetPerKey;
  }

  private publish(): void {
    this.events.onStats?.(this.stats());
  }

  private publishUsage(): void {
    const used: Record<string, number> = {};
    for (const slot of this.slots) used[slot.entry.id] = slot.usedToday;
    this.events.onUsage?.({ day: this.day, used });
  }

  /** Reset day counters when the UTC day rolls over mid-batch. */
  private rolloverIfNeeded(): void {
    const today = utcDay();
    if (today === this.day) return;
    this.day = today;
    for (const slot of this.slots) {
      slot.usedToday = 0;
      if (slot.status === 'exhausted') {
        slot.status = 'idle';
        slot.cooldownUntil = 0;
      }
    }
    this.publish();
    this.publishUsage();
  }

  private wake(): void {
    const pending = this.waiters.splice(0, this.waiters.length);
    for (const resolve of pending) resolve();
  }

  /**
   * Earliest moment some key could serve a request, or null when none can.
   *
   * A key parked for the day is deliberately not an opening: its reset is
   * hours away, and blocking a batch until then would look like a hang.
   */
  private nextOpening(now: number): number | null {
    let soonest: number | null = null;
    for (const slot of this.slots) {
      if (slot.status === 'disabled' || slot.status === 'exhausted') continue;
      if (slot.inFlight >= PER_KEY_IN_FLIGHT) continue;
      if (this.overBudget(slot)) continue;
      const at = Math.max(slot.cooldownUntil, slot.nextAllowedAt, now);
      if (at - now > MAX_WAIT_MS) continue;
      if (soonest === null || at < soonest) soonest = at;
    }
    return soonest;
  }

  private pick(now: number): Slot | null {
    const inFlightTotal = this.slots.reduce((sum, slot) => sum + slot.inFlight, 0);
    if (inFlightTotal >= this.limits.maxParallel) return null;

    let best: Slot | null = null;
    for (const slot of this.slots) {
      if (slot.status === 'disabled' || slot.status === 'exhausted') continue;
      if (slot.inFlight >= PER_KEY_IN_FLIGHT) continue;
      if (slot.cooldownUntil > now || slot.nextAllowedAt > now) continue;
      if (this.overBudget(slot)) continue;
      // Least recently used wins, which spreads load evenly across projects.
      if (best === null || slot.lastUsedAt < best.lastUsedAt) best = slot;
    }
    return best;
  }

  private async acquire(task: string, signal?: AbortSignal): Promise<Slot> {
    if (this.slots.length === 0) {
      throw new AiError('No API keys are configured.', 'auth', false);
    }
    for (;;) {
      if (signal?.aborted) throw new AiError('Processing was stopped.', 'unknown', false);
      this.rolloverIfNeeded();
      const now = Date.now();

      const slot = this.pick(now);
      if (slot) {
        slot.inFlight += 1;
        slot.status = 'active';
        slot.lastUsedAt = now;
        slot.task = task;
        slot.requests += 1;
        slot.usedToday += 1;
        if (this.limits.requestsPerMinutePerKey > 0) {
          slot.nextAllowedAt = now + Math.ceil(60_000 / this.limits.requestsPerMinutePerKey);
        }
        this.publish();
        this.publishUsage();
        return slot;
      }

      const opening = this.nextOpening(now);
      const anyBusy = this.slots.some((s) => s.inFlight > 0);
      if (opening === null && !anyBusy) {
        const exhausted = this.slots.filter(
          (s) => s.status === 'exhausted' || this.overBudget(s),
        ).length;
        throw new AiError(
          exhausted > 0
            ? `All ${this.slots.length} API key(s) have reached their daily quota. ` +
              'Add another key, or wait for the quota to reset.'
            : 'All API keys are disabled or invalid.',
          'rate-limit',
          false,
        );
      }

      // Wait for the next opening, or for an in-flight request to finish.
      const waitMs = opening === null ? 1_000 : Math.max(50, Math.min(opening - now, 5_000));
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', finish);
          resolve();
        };
        const timer = setTimeout(finish, waitMs);
        this.waiters.push(finish);
        signal?.addEventListener('abort', finish, { once: true });
      });
    }
  }

  private release(slot: Slot, error: AiError | null): void {
    slot.inFlight = Math.max(0, slot.inFlight - 1);
    slot.task = undefined;

    if (!error) {
      slot.succeeded += 1;
      slot.consecutiveRateLimits = 0;
      slot.lastError = undefined;
      if (slot.status === 'active') slot.status = this.overBudget(slot) ? 'exhausted' : 'idle';
      if (slot.status === 'exhausted') {
        slot.cooldownUntil = nextUtcMidnight();
        this.events.onLog?.(
          'warn',
          `daily budget of ${this.limits.dailyBudgetPerKey} requests reached — parked until the quota resets`,
          slot.entry.label,
        );
      }
      this.publish();
      this.wake();
      return;
    }

    slot.failed += 1;
    slot.lastError = error.message;

    if (error.kind === 'auth') {
      slot.status = 'disabled';
      this.events.onLog?.('error', `key rejected by the provider — disabled for this session`, slot.entry.label);
    } else if (error.kind === 'rate-limit') {
      slot.rateLimited += 1;
      const daily = /per day|daily|quota.*exceeded|RESOURCE_EXHAUSTED/i.test(error.message);
      if (daily && slot.rateLimited >= 2) {
        slot.status = 'exhausted';
        slot.cooldownUntil = nextUtcMidnight();
        this.events.onLog?.('warn', 'daily quota appears exhausted — parked until it resets', slot.entry.label);
      } else {
        const index = Math.min(slot.consecutiveRateLimits, RATE_LIMIT_COOLDOWNS_MS.length - 1);
        const cooldown = RATE_LIMIT_COOLDOWNS_MS[index] as number;
        slot.consecutiveRateLimits += 1;
        slot.status = 'cooling';
        slot.cooldownUntil = Date.now() + cooldown;
        this.events.onLog?.(
          'warn',
          `rate limited — resting ${Math.round(cooldown / 1000)}s, work moved to another key`,
          slot.entry.label,
        );
      }
    } else if (error.kind === 'network' || error.kind === 'timeout') {
      slot.status = 'cooling';
      slot.cooldownUntil = Date.now() + NETWORK_COOLDOWN_MS;
    } else if (slot.status === 'active') {
      // Not the key's fault (bad model, malformed reply): leave it available.
      slot.status = 'idle';
    }

    this.publish();
    this.wake();
  }

  /**
   * Run one request on a pooled key, moving to a different key when the one
   * it picked turns out to be rate-limited, invalid or unreachable.
   *
   * `task` is a short description used in the log and in the key's live state.
   */
  async run<T>(
    task: string,
    work: (key: string, label: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const attempts = Math.max(2, Math.min(this.slots.length + 1, 5));
    let last: AiError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const slot = await this.acquire(task, signal);
      try {
        const result = await work(slot.entry.key, slot.entry.label);
        this.release(slot, null);
        return result;
      } catch (error) {
        const aiError =
          error instanceof AiError
            ? error
            : new AiError(error instanceof Error ? error.message : 'Unknown AI failure.', 'unknown', false);
        this.release(slot, aiError);
        last = aiError;

        // Only key-specific problems are worth another key.
        const keySpecific =
          aiError.kind === 'auth' ||
          aiError.kind === 'rate-limit' ||
          aiError.kind === 'network' ||
          aiError.kind === 'timeout';
        if (!keySpecific) throw aiError;
      }
    }
    throw last ?? new AiError('The AI request could not be completed.', 'unknown', false);
  }
}
