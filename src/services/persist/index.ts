/**
 * Durable processing state.
 *
 * Two things have to survive a closed tab: what has already been completed
 * (so a 300-handout batch is never redone) and the generated files themselves
 * when the browser cannot write to the chosen folder. Both live in IndexedDB.
 * Output bytes are stored and read one handout at a time — never all at once.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ApiKeyEntry, OutputFile, SessionSnapshot, Settings } from '../../types';
import type { DailyUsage } from '../ai';

const DB_NAME = 'vu-handouts-highlighter';
const DB_VERSION = 1;
const SETTINGS_KEY = 'vu-highlighter.settings.v1';
const API_KEYS_KEY = 'vu-highlighter.apikeys.v1';
const USAGE_KEY = 'vu-highlighter.keyusage.v1';

interface Schema extends DBSchema {
  meta: {
    key: string;
    value: unknown;
  };
  outputs: {
    key: string;
    value: OutputFile;
    indexes: { byCourse: string };
  };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
        if (!database.objectStoreNames.contains('outputs')) {
          const store = database.createObjectStore('outputs', { keyPath: 'handoutId' });
          store.createIndex('byCourse', 'courseCode');
        }
      },
    });
  }
  return dbPromise;
}

// ------------------------------------------------------------------ session

export async function saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
  (await db()).put('meta', snapshot, 'session');
}

export async function loadSnapshot(): Promise<SessionSnapshot | null> {
  const value = await (await db()).get('meta', 'session');
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<SessionSnapshot>;
  if (!Array.isArray(snapshot.handouts) || typeof snapshot.rootName !== 'string') return null;
  return snapshot as SessionSnapshot;
}

export async function clearSession(): Promise<void> {
  const database = await db();
  await database.delete('meta', 'session');
  await database.clear('outputs');
}

/**
 * Directory handles are structured-cloneable, so a resumed session can offer
 * to re-open the same folder (the browser still re-asks for permission).
 */
export async function saveRootHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const database = await db();
  if (handle) await database.put('meta', handle, 'rootHandle');
  else await database.delete('meta', 'rootHandle');
}

export async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const value = await (await db()).get('meta', 'rootHandle');
  if (!value || typeof value !== 'object') return null;
  if (!('queryPermission' in value)) return null;
  // Stored structured clone of a handle; its shape is only knowable at runtime.
  return value as unknown as FileSystemDirectoryHandle;
}

// ------------------------------------------------------------------ outputs

export async function putOutput(output: OutputFile): Promise<void> {
  await (await db()).put('outputs', output);
}

export async function getOutput(handoutId: string): Promise<OutputFile | null> {
  return (await (await db()).get('outputs', handoutId)) ?? null;
}

export async function deleteOutput(handoutId: string): Promise<void> {
  await (await db()).delete('outputs', handoutId);
}

// ----------------------------------------------------------------- settings

/**
 * Settings go to localStorage with the key *values* stripped out. Only the
 * labels, ids and enabled flags are kept, so a reload shows the same pool
 * without ever persisting a secret unless the user opts in.
 */
export function saveSettings(settings: Settings): void {
  try {
    const { ai, ...rest } = settings;
    const shells = ai.keys.map(({ id, label, enabled }) => ({ id, label, enabled, key: '' }));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...rest, ai: { ...ai, keys: shells } }));

    if (ai.rememberKey) {
      const withValues = ai.keys.filter((entry) => entry.key.trim().length > 0);
      if (withValues.length > 0) localStorage.setItem(API_KEYS_KEY, JSON.stringify(withValues));
      else localStorage.removeItem(API_KEYS_KEY);
    } else {
      localStorage.removeItem(API_KEYS_KEY);
    }
  } catch {
    // Private-mode storage failures must never break processing.
  }
}

function readKeys(): ApiKeyEntry[] {
  try {
    const raw = localStorage.getItem(API_KEYS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is ApiKeyEntry => {
        if (typeof entry !== 'object' || entry === null) return false;
        const row = entry as Partial<ApiKeyEntry>;
        return typeof row.id === 'string' && typeof row.key === 'string';
      })
      .map((entry) => ({
        id: entry.id,
        label: typeof entry.label === 'string' && entry.label.length > 0 ? entry.label : 'Key',
        key: entry.key,
        enabled: entry.enabled !== false,
      }));
  } catch {
    return [];
  }
}

export function loadSettings(): { settings: Partial<Settings>; keys: ApiKeyEntry[] } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const keys = readKeys();
    if (!raw) return { settings: {}, keys };
    return { settings: JSON.parse(raw) as Partial<Settings>, keys };
  } catch {
    return { settings: {}, keys: [] };
  }
}

export function forgetApiKeys(): void {
  try {
    localStorage.removeItem(API_KEYS_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Per-key daily usage. Without this a reload would forget that a key has
 * already spent most of its free daily quota.
 */
export function saveKeyUsage(usage: DailyUsage): void {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    // Not worth failing a batch over.
  }
}

export function loadKeyUsage(): DailyUsage | undefined {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const row = parsed as Partial<DailyUsage>;
    if (typeof row.day !== 'string' || typeof row.used !== 'object' || row.used === null) return undefined;
    return { day: row.day, used: row.used as Record<string, number> };
  } catch {
    return undefined;
  }
}
