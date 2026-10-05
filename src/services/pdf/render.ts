/** Rasterising pages — used by OCR, whitespace detection and the preview. */
import type { PdfPage } from './pdfjs';

export interface RasterPage {
  canvas: HTMLCanvasElement;
  scale: number;
  /** Page size in PDF units. */
  width: number;
  height: number;
}

/**
 * Render one page to a canvas. The caller owns the canvas and should drop
 * the reference as soon as it is done — a 300-handout batch cannot afford to
 * keep rasters alive.
 */
export async function renderPage(page: PdfPage, scale: number): Promise<RasterPage> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D context unavailable in this browser.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return { canvas, scale, width: base.width, height: base.height };
}

/** Release a canvas's backing store eagerly rather than waiting for GC. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
