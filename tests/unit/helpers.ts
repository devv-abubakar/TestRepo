import type { PageText, TextPiece } from '../../src/types';
import { foldFragment, squashSpace } from '../../src/utils/text';

/**
 * Build a `PageText` the way the extractor would, from one run per word so
 * tests exercise the same piece-boundary logic real PDFs produce.
 */
export function makePage(
  pageIndex: number,
  lines: readonly string[],
  options: { width?: number; height?: number; fontSize?: number } = {},
): PageText {
  const width = options.width ?? 595;
  const height = options.height ?? 842;
  const fontSize = options.fontSize ?? 11;
  const pieces: TextPiece[] = [];

  let y = height - 60;
  for (const line of lines) {
    let x = 50;
    for (const word of line.split(' ')) {
      const folded = foldFragment(word);
      if (folded.length === 0) continue;
      const pieceWidth = folded.length * fontSize * 0.5;
      pieces.push({
        str: folded,
        rect: { x, y, width: pieceWidth, height: fontSize },
        fontSize,
        normStart: 0,
        normEnd: 0,
      });
      x += pieceWidth + fontSize * 0.3;
    }
    y -= fontSize * 1.6;
  }

  let normalized = '';
  const pieceOf: number[] = [];
  const posInPiece: number[] = [];
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i] as TextPiece;
    if (i > 0) {
      normalized += ' ';
      pieceOf.push(-1);
      posInPiece.push(-1);
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
