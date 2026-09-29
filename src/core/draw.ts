import type { Rect } from './types';
import { parseHex, withAlpha } from './color';

export function roundRectPath(
  ctx: CanvasRenderingContext2D | Path2D,
  rect: Rect,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, rect.w / 2, rect.h / 2));
  const { x, y, w, h } = rect;
  if ('roundRect' in ctx && typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
}

/**
 * Builds a linear gradient across `rect` at `angleDeg`, measured clockwise from
 * left-to-right, so a value of 90 runs top-to-bottom.
 */
export function angledGradient(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  angleDeg: number,
  stops: string[],
): CanvasGradient {
  const rad = (angleDeg * Math.PI) / 180;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  // Project the rect's half-diagonal onto the gradient axis so the first and
  // last stop always land exactly on the rect's edge, at any angle.
  const half = (Math.abs(Math.cos(rad)) * rect.w + Math.abs(Math.sin(rad)) * rect.h) / 2;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  const list = stops.length === 1 ? [stops[0]!, stops[0]!] : stops;
  list.forEach((color, i) => gradient.addColorStop(i / (list.length - 1), color));
  return gradient;
}

/** Soft radial darkening at the edges. Keeps the eye on the device. */
export function drawVignette(ctx: CanvasRenderingContext2D, rect: Rect, strength: number): void {
  if (strength <= 0) return;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const outer = Math.hypot(rect.w, rect.h) / 2;
  const gradient = ctx.createRadialGradient(cx, cy, outer * 0.38, cx, cy, outer);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.72, strength)})`);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/**
 * Deterministic film grain.
 *
 * Flat gradients develop visible banding once Play re-encodes an upload, and a
 * little noise hides it. The pattern is generated from a fixed seed so the same
 * project always exports identical bytes — important for anyone diffing assets
 * in version control.
 */
export function drawNoise(ctx: CanvasRenderingContext2D, rect: Rect, amount: number): void {
  if (amount <= 0) return;
  const tile = 128;
  const canvas = document.createElement('canvas');
  canvas.width = tile;
  canvas.height = tile;
  const tileCtx = canvas.getContext('2d');
  if (!tileCtx) return;

  const data = tileCtx.createImageData(tile, tile);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < tile * tile; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = seed >>> 24;
    data.data[i * 4] = v;
    data.data[i * 4 + 1] = v;
    data.data[i * 4 + 2] = v;
    data.data[i * 4 + 3] = 255;
  }
  tileCtx.putImageData(data, 0, 0);

  const pattern = ctx.createPattern(canvas, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(0.18, amount);
  ctx.fillStyle = pattern;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/**
 * Mesh gradient: a handful of large, soft radial blobs. Gives depth that a plain
 * two-stop linear gradient cannot, which is what the good store listings use.
 */
export function drawMesh(ctx: CanvasRenderingContext2D, rect: Rect, colors: string[]): void {
  const base = colors[0] ?? '#101218';
  ctx.save();
  ctx.fillStyle = base;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  const blobs = [
    { x: 0.12, y: 0.1, r: 0.72 },
    { x: 0.92, y: 0.22, r: 0.6 },
    { x: 0.2, y: 0.88, r: 0.66 },
    { x: 0.84, y: 0.94, r: 0.54 },
  ];

  ctx.globalCompositeOperation = 'lighter';
  blobs.forEach((blob, i) => {
    const color = colors[(i % Math.max(1, colors.length - 1)) + 1] ?? colors[0] ?? base;
    const cx = rect.x + rect.w * blob.x;
    const cy = rect.y + rect.h * blob.y;
    const radius = Math.max(rect.w, rect.h) * blob.r;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, withAlpha(color, 0.55));
    gradient.addColorStop(0.55, withAlpha(color, 0.16));
    gradient.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  });
  ctx.restore();
}

/** `object-fit: cover` for canvas: fills the box, cropping the overflow. */
export function coverRect(
  box: Rect,
  sourceWidth: number,
  sourceHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(1, sourceWidth), sh: Math.max(1, sourceHeight) };
  }
  const boxRatio = box.w / box.h;
  const srcRatio = sourceWidth / sourceHeight;
  if (srcRatio > boxRatio) {
    const sw = sourceHeight * boxRatio;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / boxRatio;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

/** `object-fit: contain`: whole source visible, letterboxed inside the box. */
export function containRect(box: Rect, sourceWidth: number, sourceHeight: number): Rect {
  if (sourceWidth <= 0 || sourceHeight <= 0) return box;
  const scale = Math.min(box.w / sourceWidth, box.h / sourceHeight);
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export function dropShadow(
  ctx: CanvasRenderingContext2D,
  color: string,
  blur: number,
  offsetY: number,
): void {
  const { r, g, b } = parseHex(color);
  ctx.shadowColor = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.45)`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = offsetY;
}

export function clearShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowOffsetX = 0;
}
