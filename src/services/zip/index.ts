/**
 * ZIP packaging for the download-all path.
 *
 * Built with fflate's streaming writer and stored (not deflated) entries:
 * PDF content is already compressed, so deflating it would burn CPU for
 * nothing. Entries are added one at a time and the chunks go straight into a
 * Blob, so the whole archive never has to exist in memory as one buffer.
 */
import { Zip, ZipPassThrough } from 'fflate';
import { getOutput } from '../persist';

export interface ZipEntry {
  /** Path inside the archive, e.g. `CS101/Handout 01_AI_Highlighted.pdf`. */
  path: string;
  handoutId: string;
}

export interface ZipProgress {
  done: number;
  total: number;
}

/** Build the archive, pulling each handout's bytes out of storage in turn. */
export async function buildZip(
  entries: readonly ZipEntry[],
  onProgress?: (progress: ZipProgress) => void,
): Promise<Blob> {
  const chunks: BlobPart[] = [];

  const finished = new Promise<void>((resolve, reject) => {
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (chunk.length > 0) {
        const copy = new Uint8Array(chunk.length);
        copy.set(chunk);
        chunks.push(copy);
      }
      if (final) resolve();
    });

    void (async () => {
      try {
        let done = 0;
        for (const entry of entries) {
          const output = await getOutput(entry.handoutId);
          if (!output) continue;
          const file = new ZipPassThrough(entry.path);
          zip.add(file);
          const bytes = new Uint8Array(output.bytes.byteLength);
          bytes.set(output.bytes);
          file.push(bytes, true);
          done += 1;
          onProgress?.({ done, total: entries.length });
        }
        zip.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });

  await finished;
  return new Blob(chunks, { type: 'application/zip' });
}

/** Hand a blob to the browser as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the transfer before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  downloadBlob(new Blob([copy], { type: 'application/pdf' }), fileName);
}
