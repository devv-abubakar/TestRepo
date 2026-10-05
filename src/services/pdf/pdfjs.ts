/** Single place where the pdf.js worker and its data files are wired up. */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const base = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/**
 * Standard-font and CMap data are served from the bundle (see the
 * `pdfjs-assets` plugin). They are not optional: a handout that uses a
 * non-embedded base-14 font renders as a blank page without them, which
 * would make the blank-space detection behind footer placement unreliable.
 */
const STANDARD_FONT_DATA_URL = `${base}pdfjs/standard_fonts/`;
const CMAP_URL = `${base}pdfjs/cmaps/`;

export const pdfjs = pdfjsLib;

export type PdfDocument = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
export type PdfPage = Awaited<ReturnType<PdfDocument['getPage']>>;

/**
 * Open a PDF for reading. pdf.js takes ownership of the buffer it is given,
 * so callers that still need the original bytes must pass a copy.
 */
export async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  const task = pdfjsLib.getDocument({
    data: bytes,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    // Handouts are documents, not applications: no scripting, no eval.
    isEvalSupported: false,
  });
  return task.promise;
}
