/**
 * Turning matched character ranges into page rectangles.
 *
 * Kept free of any pdf.js import so the geometry can be exercised directly in
 * tests against hand-built pages.
 */
import type { PageText, Rect } from '../../types';

/**
 * Turn a character range of a page's folded text into page rectangles,
 * one per visual line. Returns an empty array when the range maps to
 * nothing drawable.
 */
export function rangeToRects(page: PageText, start: number, end: number): Rect[] {
  const out: Rect[] = [];
  let groupPiece = -1;
  let groupFirst = -1;
  let groupLast = -1;

  const flush = () => {
    if (groupPiece < 0) return;
    const piece = page.pieces[groupPiece];
    if (!piece) return;
    const len = piece.str.length || 1;
    const from = (page.posInPiece[groupFirst] as number) / len;
    const to = ((page.posInPiece[groupLast] as number) + 1) / len;
    const x = piece.rect.x + from * piece.rect.width;
    const width = Math.max((to - from) * piece.rect.width, 0.5);
    out.push({ x, y: piece.rect.y, width, height: piece.rect.height });
    groupPiece = -1;
  };

  const from = Math.max(0, start);
  const to = Math.min(page.normalized.length, end);
  for (let i = from; i < to; i += 1) {
    const pi = page.pieceOf[i] as number;
    if (pi < 0) continue;
    if (pi !== groupPiece) {
      flush();
      groupPiece = pi;
      groupFirst = i;
    }
    groupLast = i;
  }
  flush();

  return mergeRects(out);
}

/** Join rectangles that sit on the same line into single spans. */
export function mergeRects(rects: Rect[]): Rect[] {
  if (rects.length <= 1) return rects;
  const sorted = [...rects].sort((a, b) => (Math.abs(a.y - b.y) > 1 ? b.y - a.y : a.x - b.x));
  const merged: Rect[] = [];

  for (const rect of sorted) {
    const last = merged[merged.length - 1];
    if (last) {
      const line = Math.max(last.height, rect.height, 1);
      const sameLine = Math.abs(last.y - rect.y) <= line * 0.4;
      const gap = rect.x - (last.x + last.width);
      if (sameLine && gap <= line * 1.2 && gap > -line * 4) {
        const right = Math.max(last.x + last.width, rect.x + rect.width);
        last.x = Math.min(last.x, rect.x);
        last.width = right - last.x;
        last.height = Math.max(last.height, rect.height);
        last.y = Math.min(last.y, rect.y);
        continue;
      }
    }
    merged.push({ ...rect });
  }
  return merged;
}
