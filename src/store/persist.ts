import { isProject, sanitizeProject } from '../core/project';
import type { Project } from '../core/types';

/**
 * Local persistence.
 *
 * Screenshots are stored as the original Blob in IndexedDB rather than as
 * decoded pixels: a Blob survives structured cloning, costs what the file costs,
 * and re-decodes in a few milliseconds. The project itself goes in
 * localStorage, which is simpler and small enough not to matter.
 *
 * None of this leaves the device. That is the point of the product, so it is
 * also the reason there is no server-side draft.
 */

const DB_NAME = 'storeshot';
const DB_VERSION = 1;
const STORE = 'screenshots';
const PROJECT_KEY = 'storeshot.project.v1';

export interface StoredImage {
  id: string;
  name: string;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    // Private browsing and blocked site data both land here. The app must still
    // work, just without a saved draft.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function putImage(image: StoredImage): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const request = tx(db, 'readwrite').put(image);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
  db.close();
}

export async function getAllImages(): Promise<StoredImage[]> {
  const db = await openDb();
  if (!db) return [];
  const result = await new Promise<StoredImage[]>((resolve) => {
    const request = tx(db, 'readonly').getAll();
    request.onsuccess = () => resolve((request.result as StoredImage[]) ?? []);
    request.onerror = () => resolve([]);
  });
  db.close();
  return result;
}

export async function deleteImage(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const request = tx(db, 'readwrite').delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
  db.close();
}

export async function clearImages(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const request = tx(db, 'readwrite').clear();
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
  db.close();
}

export function saveProject(project: Project): void {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
  } catch {
    // Quota exceeded or storage disabled; the session simply is not restorable.
  }
}

export function loadProject(): Project | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isProject(parsed)) return null;
    return sanitizeProject(parsed);
  } catch {
    return null;
  }
}

export function clearProject(): void {
  try {
    localStorage.removeItem(PROJECT_KEY);
  } catch {
    /* nothing to do */
  }
}
