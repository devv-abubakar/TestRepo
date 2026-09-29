import { contrast, parseHex, withAlpha } from './color';
import { angledGradient, clearShadow, coverRect, drawMesh, drawNoise, drawVignette } from './draw';
import { drawDevice, fitBody } from './frames';
import { fitText } from './text';
import { templateById } from './templates';
import type { TextBox } from './templates';
import type { Rect, RenderSpec, ResolvedSlide } from './types';

export const WATERMARK_TEXT = 'Made with StoreShot';

/**
 * Renders one store asset onto a canvas context.
 *
 * The context is expected to already be sized to `spec.width * spec.dpr` and
 * scaled, so this function always draws in logical export pixels. That means the
 * on-screen preview and the exported file run through exactly the same code path
 * — the only difference is `dpr`. Anything that looks right in the preview is
 * what lands in the PNG.
 */
export function renderSlide(ctx: CanvasRenderingContext2D, spec: RenderSpec): void {
  const frame: Rect = { x: 0, y: 0, w: spec.width, h: spec.height };
  const { resolved } = spec;

  ctx.save();
  ctx.clearRect(0, 0, spec.width, spec.height);

  paintBackground(ctx, frame, spec);

  const template = templateById(resolved.templateId);
  const layout = template.layout(frame, resolved);

  layout.decorate?.(ctx, frame, resolved);

  if (layout.deviceBox) {
    const deviceStyle = layout.forceFrameless
      ? { ...resolved.device, kind: 'none' as const }
      : resolved.device;

    const ratio =
      spec.imageWidth > 0 && spec.imageHeight > 0
        ? spec.imageWidth / spec.imageHeight
        : layout.forceFrameless
          ? frame.w / frame.h
          : 9 / 19.5;

    const body = layout.forceFrameless
      ? layout.deviceBox
      : fitBody(layout.deviceBox, ratio, deviceStyle.kind === 'tablet' ? 'tablet' : 'phone');

    if (layout.echoDevice && !layout.forceFrameless) {
      const e = layout.echoDevice;
      const echoBody: Rect = {
        x: body.x + body.w * e.offsetX,
        y: body.y + body.h * e.offsetY,
        w: body.w * e.scale,
        h: body.h * e.scale,
      };
      ctx.save();
      ctx.globalAlpha = 1 - e.dim;
      drawDevice(ctx, echoBody, deviceStyle, spec.image, {
        width: spec.imageWidth,
        height: spec.imageHeight,
      }, { rotate: layout.rotate + e.rotate });
      ctx.restore();
    }

    drawDevice(ctx, body, deviceStyle, spec.image, {
      width: spec.imageWidth,
      height: spec.imageHeight,
    }, { rotate: layout.rotate });
    clearShadow(ctx);
  }

  layout.overlay?.(ctx, frame, resolved);

  drawTextBlock(ctx, layout.text, resolved, frame);

  if (resolved.watermark) drawWatermark(ctx, frame, resolved);

  ctx.restore();
}

function paintBackground(ctx: CanvasRenderingContext2D, frame: Rect, spec: RenderSpec): void {
  const bg = spec.resolved.background;
  const colors = bg.colors.length > 0 ? bg.colors : ['#101218'];

  switch (bg.kind) {
    case 'solid':
      ctx.fillStyle = colors[0]!;
      ctx.fillRect(0, 0, frame.w, frame.h);
      break;
    case 'mesh':
      drawMesh(ctx, frame, colors);
      break;
    case 'image-blur': {
      // The screenshot itself, blown up and blurred, then darkened. Guarantees a
      // background that belongs to the app even with no palette chosen.
      ctx.fillStyle = colors[0]!;
      ctx.fillRect(0, 0, frame.w, frame.h);
      if (spec.image && spec.imageWidth > 0) {
        ctx.save();
        ctx.filter = `blur(${Math.round(frame.w * 0.06)}px) saturate(1.4)`;
        const { sx, sy, sw, sh } = coverRect(frame, spec.imageWidth, spec.imageHeight);
        // Overdraw the edges so the blur does not reveal the canvas behind it.
        const bleed = frame.w * 0.08;
        ctx.drawImage(
          spec.image,
          sx,
          sy,
          sw,
          sh,
          -bleed,
          -bleed,
          frame.w + bleed * 2,
          frame.h + bleed * 2,
        );
        ctx.restore();
        ctx.fillStyle = withAlpha(colors[0]!, 0.58);
        ctx.fillRect(0, 0, frame.w, frame.h);
      }
      break;
    }
    case 'gradient':
    default:
      ctx.fillStyle = angledGradient(ctx, frame, bg.angle, colors);
      ctx.fillRect(0, 0, frame.w, frame.h);
      break;
  }

  drawVignette(ctx, frame, bg.vignette);
  if (bg.noise > 0) drawNoise(ctx, frame, bg.noise);
}

function fontString(family: string, weight: number, size: number): string {
  return `${weight} ${size}px "${family}", "Plus Jakarta Sans", system-ui, -apple-system, sans-serif`;
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  tb: TextBox,
  resolved: ResolvedSlide,
  frame: Rect,
): void {
  const { typography, slide } = resolved;
  const headline = typography.uppercase ? slide.headline.toUpperCase() : slide.headline;
  const sub = slide.subheadline;
  if (headline.trim().length === 0 && sub.trim().length === 0) return;

  const maxHeadline = frame.w * tb.headlineRatio * typography.scale;
  const subSize = Math.max(11, frame.w * tb.subRatio * typography.scale);
  const spacing = frame.w * 0.014;

  ctx.save();
  ctx.textAlign = tb.align;
  ctx.textBaseline = 'top';

  /**
   * Tracking is stored per mille of the FONT size, not of the canvas width.
   *
   * Deriving it from canvas width gives every text run the same absolute
   * spacing, so a value that merely tightens a 110px headline crushes a 37px
   * subtitle into an unreadable block. Canvas measures letter spacing in user
   * space, independent of the transform, so a font-relative value also renders
   * identically in the thumbnail and in the export.
   */
  const trackingFor = (size: number) => `${(typography.letterSpacing / 1000) * size}px`;

  // Reserve room for the subheadline before sizing the headline, otherwise a
  // long caption pushes the subtitle out of the box.
  const subLineHeight = 1.32;
  const subReserve =
    sub.trim().length > 0 ? subSize * subLineHeight * Math.min(3, sub.split('\n').length + 1) + spacing : 0;

  const headlineLineHeight = 1.08;
  const measureAt = (text: string, size: number) => {
    ctx.font = fontString(typography.headlineFont, typography.headlineWeight, size);
    if ('letterSpacing' in ctx) ctx.letterSpacing = trackingFor(size);
    return ctx.measureText(text).width;
  };

  const fitted = fitText(
    measureAt,
    headline,
    tb.box.w,
    Math.max(subSize, tb.box.h - subReserve),
    headlineLineHeight,
    { min: Math.max(10, frame.w * 0.022), max: maxHeadline },
  );

  const headlineHeight = fitted.lines.length * fitted.fontSize * headlineLineHeight;

  ctx.font = fontString(typography.bodyFont, 500, subSize);
  if ('letterSpacing' in ctx) ctx.letterSpacing = trackingFor(subSize);
  const subLines = sub.trim().length > 0 ? wrapWith(ctx, sub, tb.box.w) : [];
  const subHeight = subLines.length * subSize * subLineHeight;

  const totalHeight = headlineHeight + (subHeight > 0 ? subHeight + spacing : 0);
  const y =
    tb.vAlign === 'top'
      ? tb.box.y
      : tb.vAlign === 'bottom'
        ? tb.box.y + tb.box.h - totalHeight
        : tb.box.y + (tb.box.h - totalHeight) / 2;

  const x =
    tb.align === 'left' ? tb.box.x : tb.align === 'right' ? tb.box.x + tb.box.w : tb.box.x + tb.box.w / 2;

  // A soft shadow keeps type legible if it ever overlaps the device or a bright
  // part of the background. Subtle enough to be invisible on a flat background.
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = fitted.fontSize * 0.28;
  ctx.shadowOffsetY = fitted.fontSize * 0.04;

  ctx.fillStyle = resolved.textColor;
  ctx.font = fontString(typography.headlineFont, typography.headlineWeight, fitted.fontSize);
  if ('letterSpacing' in ctx) ctx.letterSpacing = trackingFor(fitted.fontSize);
  fitted.lines.forEach((line, i) => {
    ctx.fillText(line, x, y + i * fitted.fontSize * headlineLineHeight);
  });

  if (subLines.length > 0) {
    // Accent colour for the subtitle, but only when it stays readable on the
    // background. Otherwise fall back to the resolved text colour.
    const bgSample = parseHex(resolved.background.colors[0] ?? '#101218');
    const accentReadable = contrast(bgSample, parseHex(resolved.accent)) >= 3;
    ctx.fillStyle = accentReadable ? resolved.accent : withAlpha(resolved.textColor, 0.74);
    ctx.font = fontString(typography.bodyFont, 500, subSize);
    if ('letterSpacing' in ctx) ctx.letterSpacing = trackingFor(subSize);
    ctx.shadowBlur = subSize * 0.22;
    const subY = y + headlineHeight + spacing;
    subLines.forEach((line, i) => {
      ctx.fillText(line, x, subY + i * subSize * subLineHeight);
    });
  }

  ctx.restore();
}

function wrapWith(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const measure = (t: string) => ctx.measureText(t).width;
  return text
    .split('\n')
    .flatMap((paragraph) => {
      const words = paragraph.replace(/\s+/g, ' ').trim();
      if (words.length === 0) return [''];
      const lines: string[] = [];
      let current = '';
      for (const word of words.split(' ')) {
        const candidate = current.length === 0 ? word : `${current} ${word}`;
        if (measure(candidate) <= maxWidth) current = candidate;
        else {
          if (current.length > 0) lines.push(current);
          current = word;
        }
      }
      if (current.length > 0) lines.push(current);
      return lines;
    })
    .slice(0, 4);
}

function drawWatermark(ctx: CanvasRenderingContext2D, frame: Rect, resolved: ResolvedSlide): void {
  const size = Math.max(9, frame.w * 0.0165);
  ctx.save();
  ctx.font = fontString('Plus Jakarta Sans', 600, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${size * 0.06}px`;
  // The mark can land on top of the device in the templates that bleed off the
  // bottom edge, so it carries its own shadow rather than relying on the
  // background behind it.
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = size * 0.9;
  ctx.fillStyle = withAlpha(resolved.textColor, 0.5);
  ctx.fillText(WATERMARK_TEXT, frame.w / 2, frame.h - frame.h * 0.018);
  ctx.restore();
}
