/**
 * Local folder access.
 *
 * Two backends sit behind one interface. The File System Access API is the
 * preferred one: it can write each `*_AI_Highlighted.pdf` straight back into
 * its course folder and its directory handle can be stored for a later
 * resume. Browsers without it fall back to a `webkitdirectory` input, which
 * can still read the whole tree but has to deliver output as downloads.
 *
 * Neither backend reads anything before the user has granted permission on a
 * folder they picked themselves.
 */
import type { HandoutRef } from '../../types';

export type SourceMode = 'file-system-access' | 'directory-input';

export interface ScannedHandout extends HandoutRef {
  /** Relative path inside the course folder, for nested layouts. */
  path: string;
  read(): Promise<Uint8Array>;
}

export interface ScannedCourse {
  code: string;
  handouts: ScannedHandout[];
}

export interface ScanResult {
  rootName: string;
  courses: ScannedCourse[];
  /** `${courseCode}/${outputFileName}` for outputs that already exist. */
  existingOutputs: Set<string>;
  totalHandouts: number;
}

export interface HandoutSource {
  readonly mode: SourceMode;
  readonly rootName: string;
  /** True when outputs can be written back into the course folders. */
  readonly canWrite: boolean;
  scan(suffix: string): Promise<ScanResult>;
  write(courseCode: string, fileName: string, bytes: Uint8Array): Promise<void>;
}

/** Courses are top-level folders; loose PDFs at the root land here. */
const LOOSE_COURSE = 'Uncategorized';
const PDF_PATTERN = /\.pdf$/i;

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function outputNameFor(fileName: string, suffix: string): string {
  return `${fileName.replace(PDF_PATTERN, '')}${suffix}.pdf`;
}

function isOutputName(fileName: string, suffix: string): boolean {
  return new RegExp(`${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.pdf$`, 'i').test(fileName);
}

function handoutId(courseCode: string, path: string): string {
  return `${courseCode}/${path}`;
}

// ------------------------------------------------- File System Access API

async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite',
): Promise<boolean> {
  const query = await handle.queryPermission({ mode });
  if (query === 'granted') return true;
  const request = await handle.requestPermission({ mode });
  return request === 'granted';
}

/** Depth-first walk of one course folder, keeping relative paths intact. */
async function walkCourse(
  dir: FileSystemDirectoryHandle,
  courseCode: string,
  prefix: string,
  suffix: string,
  into: ScannedCourse,
  existing: Set<string>,
): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      await walkCourse(entry, courseCode, `${prefix}${entry.name}/`, suffix, into, existing);
      continue;
    }
    if (!PDF_PATTERN.test(entry.name)) continue;
    if (isOutputName(entry.name, suffix)) {
      existing.add(handoutId(courseCode, `${prefix}${entry.name}`));
      continue;
    }
    const path = `${prefix}${entry.name}`;
    const file = await entry.getFile();
    into.handouts.push({
      id: handoutId(courseCode, path),
      courseCode,
      fileName: entry.name,
      path,
      size: file.size,
      read: async () => new Uint8Array(await (await entry.getFile()).arrayBuffer()),
    });
  }
}

class DirectoryHandleSource implements HandoutSource {
  readonly mode: SourceMode = 'file-system-access';

  constructor(
    private readonly root: FileSystemDirectoryHandle,
    readonly canWrite: boolean,
  ) {}

  get rootName(): string {
    return this.root.name;
  }

  /** The handle itself, so it can be stored for a later resume. */
  get handle(): FileSystemDirectoryHandle {
    return this.root;
  }

  async scan(suffix: string): Promise<ScanResult> {
    const courses: ScannedCourse[] = [];
    const existingOutputs = new Set<string>();
    const loose: ScannedCourse = { code: LOOSE_COURSE, handouts: [] };

    for await (const entry of this.root.values()) {
      if (entry.kind === 'directory') {
        const course: ScannedCourse = { code: entry.name, handouts: [] };
        await walkCourse(entry, entry.name, '', suffix, course, existingOutputs);
        if (course.handouts.length > 0 || existingOutputs.size > 0) courses.push(course);
        continue;
      }
      if (!PDF_PATTERN.test(entry.name)) continue;
      if (isOutputName(entry.name, suffix)) {
        existingOutputs.add(handoutId(LOOSE_COURSE, entry.name));
        continue;
      }
      const file = await entry.getFile();
      loose.handouts.push({
        id: handoutId(LOOSE_COURSE, entry.name),
        courseCode: LOOSE_COURSE,
        fileName: entry.name,
        path: entry.name,
        size: file.size,
        read: async () => new Uint8Array(await (await entry.getFile()).arrayBuffer()),
      });
    }

    if (loose.handouts.length > 0) courses.push(loose);
    courses.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    for (const course of courses) {
      course.handouts.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    }

    return {
      rootName: this.root.name,
      courses: courses.filter((course) => course.handouts.length > 0),
      existingOutputs,
      totalHandouts: courses.reduce((sum, course) => sum + course.handouts.length, 0),
    };
  }

  async write(courseCode: string, fileName: string, bytes: Uint8Array): Promise<void> {
    if (!this.canWrite) throw new Error('This folder was opened read-only.');
    const dir =
      courseCode === LOOSE_COURSE
        ? this.root
        : await this.root.getDirectoryHandle(courseCode, { create: false });
    // Nested handouts keep their sub-folder.
    const segments = fileName.split('/');
    const leaf = segments.pop();
    if (!leaf) throw new Error('Invalid output file name.');
    let target = dir;
    for (const segment of segments) {
      target = await target.getDirectoryHandle(segment, { create: true });
    }
    const handle = await target.getFileHandle(leaf, { create: true });
    const writable = await handle.createWritable();
    try {
      // A freshly allocated buffer keeps the write typed to a plain
      // ArrayBuffer, which is what the streams API accepts.
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      await writable.write(copy);
    } finally {
      await writable.close();
    }
  }
}

/** Ask the user for a folder. Returns null when the picker is dismissed. */
export async function pickDirectory(): Promise<DirectoryHandleSource | null> {
  const picker = window.showDirectoryPicker;
  if (!picker) return null;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picker.call(window, { id: 'vu-handouts', mode: 'readwrite' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
  const writable = await ensurePermission(handle, 'readwrite');
  if (!writable) {
    const readable = await ensurePermission(handle, 'read');
    if (!readable) throw new Error('Folder access was denied.');
  }
  return new DirectoryHandleSource(handle, writable);
}

/** Re-open a stored handle for a resumed session, re-checking permission. */
export async function restoreDirectory(
  handle: FileSystemDirectoryHandle,
): Promise<DirectoryHandleSource | null> {
  const writable = await ensurePermission(handle, 'readwrite');
  if (writable) return new DirectoryHandleSource(handle, true);
  const readable = await ensurePermission(handle, 'read');
  return readable ? new DirectoryHandleSource(handle, false) : null;
}

export function directoryHandleOf(source: HandoutSource): FileSystemDirectoryHandle | null {
  return source instanceof DirectoryHandleSource ? source.handle : null;
}

// ------------------------------------------------------ webkitdirectory

class FileListSource implements HandoutSource {
  readonly mode: SourceMode = 'directory-input';
  readonly canWrite = false;

  constructor(
    readonly rootName: string,
    private readonly files: readonly File[],
  ) {}

  scan(suffix: string): Promise<ScanResult> {
    const byCourse = new Map<string, ScannedCourse>();
    const existingOutputs = new Set<string>();

    for (const file of this.files) {
      if (!PDF_PATTERN.test(file.name)) continue;
      const relative = (file.webkitRelativePath || file.name).split('/');
      // The first segment is the picked folder itself.
      const inside = relative.length > 1 ? relative.slice(1) : relative;
      const courseCode = inside.length > 1 ? (inside[0] as string) : LOOSE_COURSE;
      const path = inside.length > 1 ? inside.slice(1).join('/') : (inside[0] as string);

      if (isOutputName(file.name, suffix)) {
        existingOutputs.add(handoutId(courseCode, path));
        continue;
      }
      let course = byCourse.get(courseCode);
      if (!course) {
        course = { code: courseCode, handouts: [] };
        byCourse.set(courseCode, course);
      }
      course.handouts.push({
        id: handoutId(courseCode, path),
        courseCode,
        fileName: file.name,
        path,
        size: file.size,
        read: async () => new Uint8Array(await file.arrayBuffer()),
      });
    }

    const courses = [...byCourse.values()].sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true }),
    );
    for (const course of courses) {
      course.handouts.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    }

    return Promise.resolve({
      rootName: this.rootName,
      courses,
      existingOutputs,
      totalHandouts: courses.reduce((sum, course) => sum + course.handouts.length, 0),
    });
  }

  write(): Promise<void> {
    return Promise.reject(
      new Error('This browser cannot write to local folders — use the download buttons instead.'),
    );
  }
}

/** Build a source from a `<input type="file" webkitdirectory>` selection. */
export function sourceFromFileList(files: FileList): HandoutSource | null {
  const list = [...files].filter((file) => PDF_PATTERN.test(file.name));
  if (list.length === 0) return null;
  const first = list[0] as File;
  const rootName = (first.webkitRelativePath || '').split('/')[0] || 'Selected handouts';
  return new FileListSource(rootName, list);
}
