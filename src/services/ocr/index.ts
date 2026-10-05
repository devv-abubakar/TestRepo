/**
 * OCR fallback for scanned handouts.
 *
 * Each page is rasterised, recognised with word-level boxes, and rebuilt into
 * the same `PageText` shape the native extractor produces — so matching,
 * highlighting and validation downstream cannot tell the difference.
 */
import { createWorker, type Worker } from 'tesseract.js';
import type { DocumentText, PageText, TextPiece } from '../../types';
import { foldFragment, squashSpace } from '../../utils/text';
import type { PdfDocument } from '../pdf/pdfjs';
import { releaseCanvas, renderPage } from '../pdf/render';

/** Rendering resolution for recognition; below ~1.8 accuracy drops sharply. */
const OCR_SCALE = 2;
/** Words recognised below this confidence are dropped entirely. */
const MIN_WORD_CONFIDENCE = 55;

const base = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/**
 * The recognition worker, its WASM core and — when the optional
 * `@tesseract.js-data/eng` package is installed — the English model are all
 * served from this origin, so nothing about a document reaches a third party.
 *
 * Without that package the model (~12 MB) is fetched from the public tessdata
 * host on first use. VITE_TESSERACT_LANG_PATH overrides either choice.
 */
const WORKER_PATH = `${base}tesseract/worker.min.js`;
const CORE_PATH = `${base}tesseract/`;
const LANG_PATH =
  import.meta.env.VITE_TESSERACT_LANG_PATH ??
  (__LOCAL_TESSDATA__ ? `${base}tesseract/lang` : 'https://tessdata.projectnaptha.com/4.0.0');

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrError';
  }
}

/** How long the engine may take to start before we give up on it. */
const START_TIMEOUT_MS = 60_000;
/** How long one page may take to recognise. */
const PAGE_TIMEOUT_MS = 120_000;

/**
 * Fail rather than hang. A stalled OCR engine — a blocked language-data
 * fetch, a worker that never answers — would otherwise freeze an entire
 * batch on one scanned handout.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OcrError(`${what} timed out after ${Math.round(ms / 1000)}s.`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

let workerPromise: Promise<Worker> | null = null;

/** Lazily start a single recognition worker and keep it warm for the batch. */
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = withTimeout(
      createWorker('eng', undefined, {
        workerPath: WORKER_PATH,
        corePath: CORE_PATH,
        langPath: LANG_PATH,
      }),
      START_TIMEOUT_MS,
      'OCR engine start-up',
    ).catch((error: unknown) => {
      workerPromise = null;
      if (error instanceof OcrError) throw error;
      throw new OcrError(
        `OCR engine could not start (${error instanceof Error ? error.message : 'unknown error'}). ` +
          'English language data is downloaded on first use, so an internet connection is required ' +
          'unless VITE_TESSERACT_LANG_PATH points at a self-hosted copy.',
      );
    });
  }
  return workerPromise;
}

/** Shut the worker down once a batch is finished. */
export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // A worker that never started needs no teardown.
  }
}

function collectWords(data: unknown): OcrWord[] {
  const out: OcrWord[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const bbox = record.bbox as OcrWord['bbox'] | undefined;
    if (typeof record.text === 'string' && bbox && typeof bbox.x0 === 'number' && !('words' in record)) {
      out.push({
        text: record.text,
        confidence: typeof record.confidence === 'number' ? record.confidence : 0,
        bbox,
      });
    }
    for (const key of ['blocks', 'paragraphs', 'lines', 'words']) {
      const child = record[key];
      if (Array.isArray(child)) for (const entry of child) visit(entry);
    }
  };
  visit(data);
  return out;
}

/** Rebuild a `PageText` from recognised words, mapping pixels to PDF units. */
function pageFromWords(
  pageIndex: number,
  width: number,
  height: number,
  scale: number,
  words: readonly OcrWord[],
): PageText {
  const pieces: TextPiece[] = [];
  for (const word of words) {
    const text = foldFragment(word.text).trim();
    if (text.length === 0 || word.confidence < MIN_WORD_CONFIDENCE) continue;
    const x = word.bbox.x0 / scale;
    const boxWidth = (word.bbox.x1 - word.bbox.x0) / scale;
    const boxHeight = (word.bbox.y1 - word.bbox.y0) / scale;
    // Canvas y grows downward; PDF user space grows upward from the baseline.
    const y = height - word.bbox.y1 / scale;
    pieces.push({
      str: text,
      rect: { x, y, width: boxWidth, height: boxHeight },
      fontSize: boxHeight,
      normStart: 0,
      normEnd: 0,
    });
  }

  // Reading order: top-to-bottom, then left-to-right within a line.
  pieces.sort((a, b) => {
    const line = Math.max(a.rect.height, b.rect.height, 1);
    if (Math.abs(a.rect.y - b.rect.y) > line * 0.6) return b.rect.y - a.rect.y;
    return a.rect.x - b.rect.x;
  });

  let normalized = '';
  const pieceOf: number[] = [];
  const posInPiece: number[] = [];

  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i] as TextPiece;
    if (i > 0) {
      const prev = pieces[i - 1] as TextPiece;
      const line = Math.max(prev.rect.height, piece.rect.height, 1);
      const newLine = Math.abs(prev.rect.y - piece.rect.y) > line * 0.6;
      if (newLine && normalized.endsWith('-') && /^\p{L}/u.test(piece.str)) {
        normalized = normalized.slice(0, -1);
        pieceOf.pop();
        posInPiece.pop();
        prev.normEnd -= 1;
      } else {
        normalized += ' ';
        pieceOf.push(-1);
        posInPiece.push(-1);
      }
    }
    piece.normStart = normalized.length;
    for (let j = 0; j < piece.str.length; j += 1) {
      pieceOf.push(i);
      posInPiece.push(j);
    }
    normalized += piece.str;
    piece.normEnd = normalized.length;
  }

  return {
    pageIndex,
    width,
    height,
    pieces,
    normalized,
    raw: squashSpace(pieces.map((p) => p.str).join(' ')),
    pieceOf: Int32Array.from(pieceOf),
    posInPiece: Int32Array.from(posInPiece),
  };
}

/** Recognise every page of a scanned document. */
export async function ocrDocument(
  doc: PdfDocument,
  onPage?: (page: number, total: number) => void,
): Promise<DocumentText> {
  const worker = await getWorker();
  const pages: PageText[] = [];
  let totalChars = 0;

  for (let n = 1; n <= doc.numPages; n += 1) {
    onPage?.(n, doc.numPages);
    const page = await doc.getPage(n);
    const raster = await renderPage(page, OCR_SCALE);
    try {
      const result = await withTimeout(
        worker.recognize(raster.canvas, {}, { blocks: true, text: false }),
        PAGE_TIMEOUT_MS,
        `OCR of page ${n}`,
      );
      const words = collectWords(result.data);
      if (words.length === 0 && typeof result.data.text === 'string' && result.data.text.trim().length > 0) {
        throw new OcrError('OCR returned text without word positions, so highlights cannot be placed.');
      }
      const built = pageFromWords(n - 1, raster.width, raster.height, raster.scale, words);
      totalChars += built.normalized.length;
      pages.push(built);
    } finally {
      releaseCanvas(raster.canvas);
      page.cleanup();
    }
  }

  if (totalChars === 0) {
    throw new OcrError('OCR found no readable text on any page of this handout.');
  }
  return { pages, usedOcr: true, totalChars };
}
