/**
 * Durable processing state.
 *
 * Two things have to survive a closed tab: what has already been completed
 * (so a 300-handout batch is never redone) and the generated files themselves
 * when the browser cannot write to the chosen folder. Both live in IndexedDB.
 * Output bytes are stored and read one handout at a time — never all at once.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OutputFile, SessionSnapshot, Settings } from '../../types';

const DB_NAME = 'vu-handouts-highlighter';
const DB_VERSION = 1;
const SETTINGS_KEY = 'vu-highlighter.settings.v1';
const API_KEY_KEY = 'vu-highlighter.apikey.v1';

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
 * Settings go to localStorage; the API key is kept out of that blob and only
 * stored separately when the user explicitly opts in.
 */
export function saveSettings(settings: Settings): void {
  try {
    const { ai, ...rest } = settings;
    const { apiKey, ...safeAi } = ai;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...rest, ai: safeAi }));
    if (ai.rememberKey && apiKey.length > 0) localStorage.setItem(API_KEY_KEY, apiKey);
    else localStorage.removeItem(API_KEY_KEY);
  } catch {
    // Private-mode storage failures must never break processing.
  }
}

export function loadSettings(): { settings: Partial<Settings>; apiKey: string } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const apiKey = localStorage.getItem(API_KEY_KEY) ?? '';
    if (!raw) return { settings: {}, apiKey };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { settings: parsed, apiKey };
  } catch {
    return { settings: {}, apiKey: '' };
  }
}

export function forgetApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_KEY);
  } catch {
    // Nothing to do.
  }
}
