/**
 * Finding somewhere safe to put the added footer.
 *
 * Operator-list inspection would tell us where text and images are declared,
 * but it says nothing about what the page actually looks like once clipping,
 * white fills and background rectangles are applied. Rasterising the page at
 * low resolution and looking for genuinely blank pixel rows answers the only
 * question that matters: is this strip empty? Text, diagrams, images, tables
 * and ruled lines are all caught the same way.
 */
import { releaseCanvas, renderPage } from './render';
import type { PdfPage } from './pdfjs';

/**
 * Anything darker than this on any channel counts as content. It is set
 * close to white on purpose: small antialiased glyphs render as light grey,
 * and treating those as blank is how a footer ends up on top of real text.
 */
const INK_THRESHOLD = 250;
/** A row with more ink pixels than this share of its width is not blank. */
const ROW_INK_TOLERANCE = 0.002;

export interface BlankBand {
  /** Bottom edge in PDF units, measured from the bottom of the page. */
  bottom: number;
  /** Height of the blank band in PDF units. */
  height: number;
}

export interface PageSpace {
  width: number;
  height: number;
  /** The blank band at the foot of the page, if any. */
  footer: BlankBand | null;
  /** Blank band to the right of the given baseline, if asked for. */
  inkRowsFromBottom: number;
}

/** Row-by-row ink census of a rasterised page, bottom row first. */
function inkByRow(canvas: HTMLCanvasElement): boolean[] {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const tolerance = Math.max(1, Math.floor(width * ROW_INK_TOLERANCE));
  const rows: boolean[] = new Array<boolean>(height).fill(false);

  for (let y = 0; y < height; y += 1) {
    let ink = 0;
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const i = rowStart + x * 4;
      const alpha = data[i + 3] as number;
      if (alpha < 16) continue;
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      if (r < INK_THRESHOLD || g < INK_THRESHOLD || b < INK_THRESHOLD) {
        ink += 1;
        if (ink > tolerance) break;
      }
    }
    rows[y] = ink > tolerance;
  }
  return rows;
}

/**
 * Measure the usable blank strip at the bottom of a page.
 *
 * The scale has to be high enough that 8pt footer text survives rasterising;
 * at half resolution such a line fades into the background and the strip
 * reads as empty when it is not.
 */
export async function measurePage(page: PdfPage, scale = 1): Promise<PageSpace> {
  const raster = await renderPage(page, scale);
  try {
    const rows = inkByRow(raster.canvas);
    const pxToPdf = 1 / raster.scale;

    let blankPx = 0;
    for (let y = rows.length - 1; y >= 0; y -= 1) {
      if (rows[y] === true) break;
      blankPx += 1;
    }
    const footerHeight = blankPx * pxToPdf;
    return {
      width: raster.width,
      height: raster.height,
      footer: footerHeight > 1 ? { bottom: 0, height: footerHeight } : null,
      inkRowsFromBottom: rows.length - blankPx,
    };
  } finally {
    releaseCanvas(raster.canvas);
  }
}

/**
 * Is the strip to the right of `(x, y)` on a text line clear for `needed`
 * PDF units of extra text? Used before appending the WhatsApp contact to the
 * end of an existing line.
 */
export async function hasClearRunway(
  page: PdfPage,
  x: number,
  baselineY: number,
  lineHeight: number,
  needed: number,
  scale = 1.2,
): Promise<boolean> {
  const raster = await renderPage(page, scale);
  try {
    const context = raster.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    const px = Math.floor(x * raster.scale);
    const right = Math.min(raster.canvas.width, Math.ceil((x + needed) * raster.scale));
    // PDF y grows upward; canvas y grows downward.
    const top = Math.max(0, Math.floor((raster.height - baselineY - lineHeight * 1.1) * raster.scale));
    const bottom = Math.min(
      raster.canvas.height,
      Math.ceil((raster.height - baselineY + lineHeight * 0.45) * raster.scale),
    );
    if (right <= px || bottom <= top) return false;

    const data = context.getImageData(px, top, right - px, bottom - top).data;
    let ink = 0;
    const tolerance = Math.max(2, Math.floor(((right - px) * (bottom - top)) * 0.002));
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] as number) < 16) continue;
      if (
        (data[i] as number) < INK_THRESHOLD ||
        (data[i + 1] as number) < INK_THRESHOLD ||
        (data[i + 2] as number) < INK_THRESHOLD
      ) {
        ink += 1;
        if (ink > tolerance) return false;
      }
    }
    return true;
  } finally {
    releaseCanvas(raster.canvas);
  }
}
