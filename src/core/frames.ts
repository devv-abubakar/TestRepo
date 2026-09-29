import { clearShadow, coverRect, roundRectPath } from './draw';
import type { DeviceStyle, FrameColor, Rect } from './types';

/**
 * Device frames are drawn from primitives rather than loaded as artwork.
 *
 * That is a deliberate legal decision, not a shortcut. The silhouettes of real
 * phones are protected trade dress, and shipping a recognisable iPhone or Galaxy
 * outline — even as a redrawn asset — is exactly the kind of thing that gets a
 * tool like this taken down. These frames are generic: a rounded slab with a
 * uniform bezel and an optional camera cutout. They also scale to any export
 * size without resampling, which no PNG mockup can do.
 */

export interface FrameMetrics {
  /** Outer body of the device. */
  body: Rect;
  bodyRadius: number;
  bezel: number;
  /** Where the screenshot goes. */
  screen: Rect;
  screenRadius: number;
}

interface FrameProportions {
  /** Corner radius as a fraction of body width. */
  radius: number;
  /** Bezel thickness as a fraction of body width. */
  bezel: number;
}

const PROPORTIONS: Record<'phone' | 'tablet', FrameProportions> = {
  phone: { radius: 0.13, bezel: 0.026 },
  tablet: { radius: 0.055, bezel: 0.034 },
};

export interface FramePaint {
  body: string[];
  edge: string;
  highlight: string;
}

export const FRAME_COLORS: Record<FrameColor, FramePaint> = {
  graphite: { body: ['#3a3d45', '#1b1d22', '#2e3138'], edge: '#5c6169', highlight: '#8f959f' },
  silver: { body: ['#e8eaee', '#b9bdc6', '#d6d9df'], edge: '#f2f4f7', highlight: '#ffffff' },
  white: { body: ['#fbfbfc', '#dfe1e6', '#f1f2f5'], edge: '#ffffff', highlight: '#ffffff' },
  sand: { body: ['#e7d7c4', '#c2ab92', '#dbc8b1'], edge: '#f3e8d9', highlight: '#fffaf3' },
  midnight: { body: ['#1e2230', '#0a0c13', '#141824'], edge: '#39405a', highlight: '#5d6a8f' },
};

/**
 * Computes frame geometry for a body rect. Pure, so the layout maths is unit
 * tested independently of any canvas.
 */
export function frameMetrics(body: Rect, kind: 'phone' | 'tablet'): FrameMetrics {
  const p = PROPORTIONS[kind];
  const bezel = body.w * p.bezel;
  const bodyRadius = body.w * p.radius;
  return {
    body,
    bodyRadius,
    bezel,
    screen: {
      x: body.x + bezel,
      y: body.y + bezel,
      w: Math.max(1, body.w - bezel * 2),
      h: Math.max(1, body.h - bezel * 2),
    },
    screenRadius: Math.max(0, bodyRadius - bezel * 0.85),
  };
}

/**
 * Fits a device body of the given aspect ratio inside `box`, centred.
 * Screenshots are almost never exactly 9:19.5, so the frame follows the
 * screenshot's own ratio and the box just bounds it.
 */
export function fitBody(box: Rect, screenRatio: number, kind: 'phone' | 'tablet'): Rect {
  const p = PROPORTIONS[kind].bezel;
  const safeScreenRatio = screenRatio > 0 ? screenRatio : 0.5;

  // The bezel is a fraction of body WIDTH on all four sides, so the body's
  // aspect ratio is not simply the screen's. Solving
  //   screenRatio = (1 - 2p) / (1/R - 2p)
  // for R, the body ratio, gives:
  const bodyRatio = 1 / ((1 - 2 * p) / safeScreenRatio + 2 * p);

  const byHeight = { w: box.h * bodyRatio, h: box.h };
  const chosen = byHeight.w <= box.w ? byHeight : { w: box.w, h: box.w / bodyRatio };

  return {
    x: box.x + (box.w - chosen.w) / 2,
    y: box.y + (box.h - chosen.h) / 2,
    w: chosen.w,
    h: chosen.h,
  };
}

function drawCutout(ctx: CanvasRenderingContext2D, m: FrameMetrics, style: DeviceStyle): void {
  if (style.cutout === 'none') return;
  const w = m.body.w;
  ctx.save();
  ctx.fillStyle = 'rgba(6,7,10,0.94)';
  ctx.beginPath();
  if (style.cutout === 'punch') {
    const d = w * 0.052;
    ctx.arc(m.body.x + w / 2, m.screen.y + w * 0.055, d / 2, 0, Math.PI * 2);
  } else {
    const pill: Rect = {
      x: m.body.x + w / 2 - w * 0.115,
      y: m.screen.y + w * 0.028,
      w: w * 0.23,
      h: w * 0.062,
    };
    roundRectPath(ctx, pill, pill.h / 2);
  }
  ctx.fill();
  ctx.restore();
}

function drawButtons(ctx: CanvasRenderingContext2D, m: FrameMetrics, paint: FramePaint): void {
  const w = m.body.w;
  const thickness = Math.max(1, w * 0.012);
  const buttons: Rect[] = [
    // Power, right edge.
    { x: m.body.x + m.body.w, y: m.body.y + m.body.h * 0.24, w: thickness, h: m.body.h * 0.1 },
    // Volume pair, left edge.
    { x: m.body.x - thickness, y: m.body.y + m.body.h * 0.18, w: thickness, h: m.body.h * 0.06 },
    { x: m.body.x - thickness, y: m.body.y + m.body.h * 0.26, w: thickness, h: m.body.h * 0.06 },
  ];
  ctx.save();
  ctx.fillStyle = paint.edge;
  for (const b of buttons) {
    ctx.beginPath();
    roundRectPath(ctx, b, thickness / 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Height of the drawn status bar, as a fraction of screen width. */
const STATUS_BAR_RATIO = 0.085;

/** A neutral status bar. No carrier name, no vendor iconography. */
function drawStatusBar(ctx: CanvasRenderingContext2D, m: FrameMetrics, onDark: boolean): void {
  const w = m.screen.w;
  const barHeight = w * STATUS_BAR_RATIO;
  const inset = w * 0.075;
  const color = onDark ? 'rgba(255,255,255,0.92)' : 'rgba(16,18,24,0.88)';
  const cy = m.screen.y + barHeight * 0.55;

  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 ${w * 0.038}px "Plus Jakarta Sans", system-ui, sans-serif`;
  ctx.fillText('9:41', m.screen.x + inset, cy);

  // Signal bars, wifi arc and battery, drawn as plain shapes.
  const right = m.screen.x + m.screen.w - inset;
  const unit = w * 0.011;

  const battery: Rect = { x: right - unit * 2.4, y: cy - unit * 0.9, w: unit * 2.4, h: unit * 1.8 };
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  roundRectPath(ctx, battery, unit * 0.45);
  ctx.fill();

  for (let i = 0; i < 4; i += 1) {
    const h = unit * (0.7 + i * 0.45);
    ctx.fillRect(right - unit * 8.6 + i * unit * 1.5, cy + unit * 0.9 - h, unit, h);
  }

  ctx.lineWidth = unit * 0.7;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(right - unit * 4.2, cy + unit * 0.8, unit * 1.5, Math.PI * 1.2, Math.PI * 1.8);
  ctx.stroke();
  ctx.restore();
}

export interface DrawFrameResult {
  metrics: FrameMetrics;
}

/**
 * Samples the status bar band that was just painted to decide whether its icons
 * should be light or dark. Reads a handful of pixels rather than the whole band;
 * a canvas read is the expensive part, not the arithmetic.
 */
function isBandDark(ctx: CanvasRenderingContext2D, screen: Rect): boolean {
  try {
    const t = ctx.getTransform();
    const x = Math.round(screen.x * t.a + t.e);
    const y = Math.round((screen.y + screen.h * 0.01) * t.d + t.f);
    const w = Math.max(1, Math.round(screen.w * t.a));
    const { data } = ctx.getImageData(x, y, w, 1);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4 * 8) {
      sum += (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
      n += 3;
    }
    return n === 0 ? true : sum / n < 140;
  } catch {
    // A tainted canvas would throw; assume a dark band rather than fail to draw.
    return true;
  }
}

/**
 * Draws the device and the screenshot inside it.
 *
 * `rotate` is applied about the body centre; callers pass radians. The caller is
 * responsible for the surrounding save/restore of any outer transform.
 */
export function drawDevice(
  ctx: CanvasRenderingContext2D,
  body: Rect,
  style: DeviceStyle,
  image: CanvasImageSource | null,
  imageSize: { width: number; height: number },
  options: { rotate?: number; screenFallback?: string } = {},
): DrawFrameResult {
  const kind = style.kind === 'tablet' ? 'tablet' : 'phone';
  const metrics = frameMetrics(body, kind);
  const paint = FRAME_COLORS[style.color] ?? FRAME_COLORS.graphite;
  const rotate = options.rotate ?? 0;

  ctx.save();
  if (rotate !== 0) {
    ctx.translate(body.x + body.w / 2, body.y + body.h / 2);
    ctx.rotate(rotate);
    ctx.translate(-(body.x + body.w / 2), -(body.y + body.h / 2));
  }

  if (style.kind === 'none') {
    // Frameless: the screenshot itself becomes the rounded card.
    const radius = body.w * 0.045;
    if (style.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = body.w * 0.13;
      ctx.shadowOffsetY = body.w * 0.045;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      roundRectPath(ctx, body, radius);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, body, radius);
    ctx.clip();
    paintScreen(ctx, body, image, imageSize, options.screenFallback ?? '#11141c');
    ctx.restore();
    ctx.restore();
    return { metrics: { ...metrics, screen: body, screenRadius: radius } };
  }

  if (style.shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = body.w * 0.16;
    ctx.shadowOffsetY = body.w * 0.06;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    roundRectPath(ctx, body, metrics.bodyRadius);
    ctx.fill();
    ctx.restore();
  }
  clearShadow(ctx);

  // Body. A three-stop diagonal gradient reads as brushed metal without any
  // texture asset.
  const bodyGradient = ctx.createLinearGradient(
    body.x,
    body.y,
    body.x + body.w,
    body.y + body.h,
  );
  bodyGradient.addColorStop(0, paint.body[0] ?? '#333');
  bodyGradient.addColorStop(0.5, paint.body[1] ?? '#111');
  bodyGradient.addColorStop(1, paint.body[2] ?? '#2a2a2a');

  ctx.beginPath();
  roundRectPath(ctx, body, metrics.bodyRadius);
  ctx.fillStyle = bodyGradient;
  ctx.fill();

  // A hairline highlight along the top edge sells the curvature.
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, body, metrics.bodyRadius);
  ctx.clip();
  const edgeGradient = ctx.createLinearGradient(body.x, body.y, body.x, body.y + body.h * 0.12);
  edgeGradient.addColorStop(0, paint.highlight.startsWith('#') ? `${paint.highlight}66` : paint.highlight);
  edgeGradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = edgeGradient;
  ctx.fillRect(body.x, body.y, body.w, body.h * 0.12);
  ctx.restore();

  drawButtons(ctx, metrics, paint);

  // Screen well, drawn slightly darker than the bezel so the screenshot's own
  // edges never disappear into the frame.
  const statusInset = style.statusBar && image ? metrics.screen.w * STATUS_BAR_RATIO : 0;

  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, metrics.screen, metrics.screenRadius);
  ctx.fillStyle = '#05060a';
  ctx.fill();
  ctx.clip();
  paintScreen(
    ctx,
    metrics.screen,
    image,
    imageSize,
    options.screenFallback ?? '#11141c',
    statusInset,
  );
  ctx.restore();

  if (style.statusBar && image) {
    ctx.save();
    ctx.beginPath();
    roundRectPath(ctx, metrics.screen, metrics.screenRadius);
    ctx.clip();
    drawStatusBar(ctx, metrics, isBandDark(ctx, metrics.screen));
    ctx.restore();
  }

  drawCutout(ctx, metrics, style);

  // Glass reflection: a single soft diagonal sweep at low opacity. Anything
  // stronger competes with the screenshot for attention.
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, metrics.screen, metrics.screenRadius);
  ctx.clip();
  ctx.globalCompositeOperation = 'screen';
  const glass = ctx.createLinearGradient(
    metrics.screen.x,
    metrics.screen.y,
    metrics.screen.x + metrics.screen.w * 0.8,
    metrics.screen.y + metrics.screen.h * 0.5,
  );
  glass.addColorStop(0, 'rgba(255,255,255,0.10)');
  glass.addColorStop(0.35, 'rgba(255,255,255,0.03)');
  glass.addColorStop(0.55, 'rgba(255,255,255,0)');
  ctx.fillStyle = glass;
  ctx.fillRect(metrics.screen.x, metrics.screen.y, metrics.screen.w, metrics.screen.h);
  ctx.restore();

  ctx.restore();
  return { metrics };
}

/**
 * Draws the screenshot into the screen area, optionally reserving a band at the
 * top for the drawn status bar.
 *
 * The band is filled by stretching the screenshot's own topmost row of pixels.
 * That costs nothing, needs no `getImageData`, and produces a band in exactly
 * the app's own header colour — so a light app gets a light bar and a dark app
 * a dark one, with no seam. Without the inset, the status bar and the camera
 * cutout are painted straight over the app's first line of content.
 */
function paintScreen(
  ctx: CanvasRenderingContext2D,
  screen: Rect,
  image: CanvasImageSource | null,
  imageSize: { width: number; height: number },
  fallback: string,
  topInset = 0,
): void {
  if (!image || imageSize.width <= 0 || imageSize.height <= 0) {
    ctx.fillStyle = fallback;
    ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
    return;
  }

  const inset = Math.max(0, Math.min(topInset, screen.h * 0.3));
  if (inset > 0) {
    ctx.drawImage(image, 0, 0, imageSize.width, 1, screen.x, screen.y, screen.w, inset + 1);
  }

  const content: Rect = { x: screen.x, y: screen.y + inset, w: screen.w, h: screen.h - inset };
  const { sx, sy, sw, sh } = coverRect(content, imageSize.width, imageSize.height);
  ctx.drawImage(image, sx, sy, sw, sh, content.x, content.y, content.w, content.h);
}
