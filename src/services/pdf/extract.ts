/**
 * Text extraction with coordinates.
 *
 * The page's folded text is built as one string so AI quotes can be located
 * with a plain substring search, while a parallel character map records which
 * extracted run each character came from. That map is what turns a matched
 * character range back into rectangles on the page.
 */
import type { DocumentText, PageText, TextPiece } from '../../types';
import { foldFragment, squashSpace } from '../../utils/text';
import { openPdf, type PdfDocument } from './pdfjs';

export { mergeRects, rangeToRects } from './geometry';

/** Below this many characters per page we assume the page is a scan. */
const SCAN_CHARS_PER_PAGE = 60;

interface RawItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
  hasEOL: boolean;
}

/**
 * pdf.js mixes marked-content markers into the item stream; only the entries
 * carrying glyphs and a transform are usable.
 */
function toRawItems(items: readonly unknown[]): RawItem[] {
  const out: RawItem[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Partial<RawItem>;
    if (typeof candidate.str !== 'string' || !Array.isArray(candidate.transform)) continue;
    out.push({
      str: candidate.str,
      width: typeof candidate.width === 'number' ? candidate.width : 0,
      height: typeof candidate.height === 'number' ? candidate.height : 0,
      transform: candidate.transform,
      hasEOL: candidate.hasEOL === true,
    });
  }
  return out;
}

/**
 * Decide what, if anything, separates two consecutive runs. Geometry beats
 * guesswork here: pdf.js happily splits a single word across runs when the
 * font changes, and inserting a space there would break an exact quote.
 */
function separatorFor(prev: TextPiece, next: TextPiece): 'none' | 'space' | 'dehyphenate' {
  const line = Math.max(prev.fontSize, next.fontSize, 1);
  const sameLine = Math.abs(prev.rect.y - next.rect.y) <= line * 0.5;

  if (!sameLine) {
    // A word broken across lines by a hyphen is rejoined without a space.
    if (/\p{L}-$/u.test(prev.str) && /^\p{L}/u.test(next.str)) return 'dehyphenate';
    return 'space';
  }
  const gap = next.rect.x - (prev.rect.x + prev.rect.width);
  return gap > line * 0.22 ? 'space' : 'none';
}

function buildPage(pageIndex: number, width: number, height: number, items: RawItem[]): PageText {
  const pieces: TextPiece[] = [];
  const folded: string[] = [];

  for (const item of items) {
    const t = item.transform;
    const fontSize = Math.hypot(t[2] ?? 0, t[3] ?? 0) || item.height || 10;
    const text = foldFragment(item.str);
    if (text.trim().length === 0) {
      // Whitespace-only runs carry no glyphs, but they do mark a gap.
      if (text.length > 0 && pieces.length > 0) {
        const last = pieces[pieces.length - 1] as TextPiece;
        if (!last.str.endsWith(' ')) last.str = `${last.str} `;
      }
      continue;
    }
    pieces.push({
      str: text,
      rect: { x: t[4] ?? 0, y: t[5] ?? 0, width: item.width, height: item.height || fontSize },
      fontSize,
      normStart: 0,
      normEnd: 0,
    });
    folded.push(text);
  }

  let normalized = '';
  const pieceOf: number[] = [];
  const posInPiece: number[] = [];

  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i] as TextPiece;
    if (i > 0) {
      const prev = pieces[i - 1] as TextPiece;
      const sep = separatorFor(prev, piece);
      if (sep === 'dehyphenate') {
        // Drop the trailing hyphen that only existed to wrap the line.
        if (normalized.endsWith('-')) {
          normalized = normalized.slice(0, -1);
          pieceOf.pop();
          posInPiece.pop();
          prev.normEnd -= 1;
        }
      } else if (sep === 'space' && !normalized.endsWith(' ') && !piece.str.startsWith(' ')) {
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
    raw: squashSpace(folded.join(' ')),
    pieceOf: Int32Array.from(pieceOf),
    posInPiece: Int32Array.from(posInPiece),
  };
}

/** Extract every page's text and coordinates from an already-open document. */
export async function extractDocumentText(
  doc: PdfDocument,
  onPage?: (page: number, total: number) => void,
): Promise<DocumentText> {
  const pages: PageText[] = [];
  let totalChars = 0;

  for (let n = 1; n <= doc.numPages; n += 1) {
    onPage?.(n, doc.numPages);
    const page = await doc.getPage(n);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = toRawItems(content.items);
      const built = buildPage(n - 1, viewport.width, viewport.height, items);
      totalChars += built.normalized.length;
      pages.push(built);
    } finally {
      page.cleanup();
    }
  }

  return { pages, usedOcr: false, totalChars };
}

/** Convenience wrapper for callers that only have bytes. */
export async function extractFromBytes(bytes: Uint8Array): Promise<DocumentText> {
  const doc = await openPdf(bytes.slice());
  try {
    return await extractDocumentText(doc);
  } finally {
    await doc.destroy();
  }
}

/**
 * True when the extracted layer is too thin to analyze, i.e. the handout is
 * a scan and OCR has to take over.
 */
export function needsOcr(text: DocumentText): boolean {
  if (text.pages.length === 0) return true;
  return text.totalChars / text.pages.length < SCAN_CHARS_PER_PAGE;
}
