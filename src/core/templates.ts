import { angledGradient, withAlphaSafe } from './decor';
import type { PresetId, Rect, ResolvedSlide, TemplateId } from './types';

export interface TextBox {
  box: Rect;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle' | 'bottom';
  /** Headline cap as a fraction of canvas width. Keeps type sane across presets. */
  headlineRatio: number;
  subRatio: number;
}

export interface TemplateLayout {
  /** Box the device body is fitted into; null for text-only compositions. */
  deviceBox: Rect | null;
  rotate: number;
  text: TextBox;
  /** Painted after the background, before the device. */
  decorate?: (ctx: CanvasRenderingContext2D, frame: Rect, resolved: ResolvedSlide) => void;
  /** Painted last — scrims that must sit above the screenshot. */
  overlay?: (ctx: CanvasRenderingContext2D, frame: Rect, resolved: ResolvedSlide) => void;
  /** Ignore the user's frame choice; this template only works frameless. */
  forceFrameless?: boolean;
  /** Draw a second, receding device behind the first. */
  echoDevice?: { scale: number; offsetX: number; offsetY: number; rotate: number; dim: number };
}

export interface Template {
  id: TemplateId;
  label: string;
  /** One line shown in the picker. Says what the template is *for*. */
  blurb: string;
  layout: (frame: Rect, resolved: ResolvedSlide) => TemplateLayout;
  /** Presets this template is offered for. */
  presets: PresetId[] | 'all';
}

const f = (frame: Rect, fx: number, fy: number, fw: number, fh: number): Rect => ({
  x: frame.x + frame.w * fx,
  y: frame.y + frame.h * fy,
  w: frame.w * fw,
  h: frame.h * fh,
});

const isWide = (frame: Rect) => frame.w / frame.h > 1.15;

/**
 * Every template defines a portrait composition and a landscape one.
 *
 * Rather than hand-tune sixteen layouts, landscape reuses a shared side-by-side
 * arrangement — type on one side, device on the other — with each template
 * keeping its own rotation, decoration and type scale. A feature graphic is
 * 1024x500, so a stacked portrait layout simply cannot work there.
 */
function sideBySide(
  frame: Rect,
  opts: { textLeft?: boolean; headlineRatio?: number; deviceFraction?: number } = {},
): { deviceBox: Rect; text: TextBox } {
  const textLeft = opts.textLeft ?? true;
  const deviceFraction = opts.deviceFraction ?? 0.42;
  const pad = 0.055;
  const textWidth = 1 - deviceFraction - pad * 2.2;

  return {
    deviceBox: textLeft
      ? f(frame, 1 - deviceFraction - pad * 0.4, 0.1, deviceFraction, 0.95)
      : f(frame, pad * 0.4, 0.1, deviceFraction, 0.95),
    text: {
      box: textLeft ? f(frame, pad, 0.16, textWidth, 0.68) : f(frame, 1 - pad - textWidth, 0.16, textWidth, 0.68),
      align: textLeft ? 'left' : 'right',
      vAlign: 'middle',
      headlineRatio: opts.headlineRatio ?? 0.085,
      subRatio: 0.036,
    },
  };
}

export const TEMPLATES: Template[] = [
  {
    id: 'spotlight',
    label: 'Spotlight',
    blurb: 'Centred device under a glow. The safe, always-works default.',
    presets: 'all',
    layout: (frame) => {
      if (isWide(frame)) return { rotate: 0, ...sideBySide(frame), decorate: glow };
      return {
        deviceBox: f(frame, 0.13, 0.275, 0.74, 0.665),
        rotate: 0,
        decorate: glow,
        text: {
          box: f(frame, 0.08, 0.065, 0.84, 0.175),
          align: 'center',
          vAlign: 'middle',
          headlineRatio: 0.082,
          subRatio: 0.034,
        },
      };
    },
  },
  {
    id: 'tilt',
    label: 'Tilt',
    blurb: 'Angled device with the headline hard left. Reads as modern and fast.',
    presets: 'all',
    layout: (frame) => {
      if (isWide(frame)) return { rotate: -0.05, ...sideBySide(frame), decorate: glow };
      return {
        deviceBox: f(frame, 0.16, 0.3, 0.78, 0.76),
        rotate: -0.055,
        decorate: glow,
        text: {
          box: f(frame, 0.075, 0.07, 0.8, 0.185),
          align: 'left',
          vAlign: 'middle',
          headlineRatio: 0.09,
          subRatio: 0.035,
        },
      };
    },
  },
  {
    id: 'bleed',
    label: 'Bleed',
    blurb: 'Oversized type, device running off the bottom edge. Highest impact.',
    presets: 'all',
    layout: (frame) => {
      if (isWide(frame)) return { rotate: 0, ...sideBySide(frame, { headlineRatio: 0.1 }) };
      return {
        deviceBox: f(frame, 0.12, 0.355, 0.8, 0.85),
        rotate: 0,
        text: {
          box: f(frame, 0.075, 0.06, 0.85, 0.25),
          align: 'left',
          vAlign: 'middle',
          headlineRatio: 0.115,
          subRatio: 0.038,
        },
      };
    },
  },
  {
    id: 'split',
    label: 'Split',
    blurb: 'Diagonal colour block behind the type. Good for a feature sequence.',
    presets: 'all',
    layout: (frame) => {
      if (isWide(frame)) return { rotate: 0, ...sideBySide(frame), decorate: diagonal };
      return {
        deviceBox: f(frame, 0.14, 0.325, 0.72, 0.63),
        rotate: 0,
        decorate: diagonal,
        text: {
          box: f(frame, 0.08, 0.055, 0.84, 0.19),
          align: 'left',
          vAlign: 'middle',
          headlineRatio: 0.086,
          subRatio: 0.034,
        },
      };
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    blurb: 'Small caption, lots of air. Lets a well-designed UI speak for itself.',
    presets: 'all',
    layout: (frame) => {
      if (isWide(frame)) return { rotate: 0, ...sideBySide(frame, { headlineRatio: 0.062 }) };
      return {
        deviceBox: f(frame, 0.18, 0.235, 0.64, 0.66),
        rotate: 0,
        text: {
          box: f(frame, 0.12, 0.075, 0.76, 0.125),
          align: 'center',
          vAlign: 'middle',
          headlineRatio: 0.055,
          subRatio: 0.028,
        },
      };
    },
  },
  {
    id: 'bold-type',
    label: 'Bold type',
    blurb: 'Type first, device second. Use it for the opening screenshot.',
    presets: 'all',
    layout: (frame) => {
      if (isWide(frame)) return { rotate: 0, ...sideBySide(frame, { headlineRatio: 0.12, deviceFraction: 0.3 }) };
      return {
        deviceBox: f(frame, 0.22, 0.575, 0.56, 0.62),
        rotate: 0,
        text: {
          box: f(frame, 0.075, 0.075, 0.85, 0.44),
          align: 'left',
          vAlign: 'top',
          headlineRatio: 0.135,
          subRatio: 0.04,
        },
      };
    },
  },
  {
    id: 'frameless',
    label: 'Frameless',
    blurb: 'Screenshot fills the frame, caption over a scrim. Shows the most UI.',
    presets: 'all',
    layout: (frame) => ({
      deviceBox: { ...frame },
      rotate: 0,
      forceFrameless: true,
      overlay: bottomScrim,
      text: {
        box: isWide(frame) ? f(frame, 0.06, 0.6, 0.6, 0.3) : f(frame, 0.075, 0.7, 0.85, 0.22),
        align: 'left',
        vAlign: 'bottom',
        headlineRatio: isWide(frame) ? 0.075 : 0.082,
        subRatio: 0.032,
      },
    }),
  },
  {
    id: 'duo',
    label: 'Duo',
    blurb: 'A second device receding behind the first. Suggests depth and breadth.',
    presets: 'all',
    layout: (frame) => {
      const echo = { scale: 0.88, offsetX: -0.13, offsetY: -0.045, rotate: -0.09, dim: 0.45 };
      if (isWide(frame)) return { rotate: 0.03, ...sideBySide(frame), decorate: glow, echoDevice: echo };
      return {
        deviceBox: f(frame, 0.2, 0.31, 0.68, 0.64),
        rotate: 0.035,
        decorate: glow,
        echoDevice: echo,
        text: {
          box: f(frame, 0.08, 0.065, 0.84, 0.175),
          align: 'center',
          vAlign: 'middle',
          headlineRatio: 0.078,
          subRatio: 0.033,
        },
      };
    },
  },
];

/** Radial bloom behind the device, tinted with the slide accent. */
function glow(ctx: CanvasRenderingContext2D, frame: Rect, resolved: ResolvedSlide): void {
  const cx = frame.x + frame.w * 0.5;
  const cy = frame.y + frame.h * 0.58;
  const radius = Math.max(frame.w, frame.h) * 0.52;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, withAlphaSafe(resolved.accent, 0.34));
  gradient.addColorStop(0.5, withAlphaSafe(resolved.accent, 0.1));
  gradient.addColorStop(1, withAlphaSafe(resolved.accent, 0));
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
  ctx.restore();
}

/** Accent wedge across the upper third, clipped to the canvas. */
function diagonal(ctx: CanvasRenderingContext2D, frame: Rect, resolved: ResolvedSlide): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(frame.x, frame.y);
  ctx.lineTo(frame.x + frame.w, frame.y);
  ctx.lineTo(frame.x + frame.w, frame.y + frame.h * 0.34);
  ctx.lineTo(frame.x, frame.y + frame.h * 0.46);
  ctx.closePath();
  ctx.fillStyle = angledGradient(ctx, frame, 110, [
    withAlphaSafe(resolved.accent, 0.3),
    withAlphaSafe(resolved.accent, 0.08),
  ]);
  ctx.fill();
  ctx.restore();
}

/**
 * Gradient scrim so a caption stays readable over an arbitrary screenshot.
 *
 * This is the one place the tool must not trust the user's colour choice: the
 * screenshot underneath is unknown, and white text on a white app screen is the
 * single most common way these graphics fail.
 */
function bottomScrim(ctx: CanvasRenderingContext2D, frame: Rect, resolved: ResolvedSlide): void {
  const dark = resolved.textColor === '#ffffff';
  const top = frame.y + frame.h * (isWide(frame) ? 0.42 : 0.55);
  const gradient = ctx.createLinearGradient(frame.x, top, frame.x, frame.y + frame.h);
  gradient.addColorStop(0, dark ? 'rgba(4,5,9,0)' : 'rgba(255,255,255,0)');
  gradient.addColorStop(0.55, dark ? 'rgba(4,5,9,0.62)' : 'rgba(255,255,255,0.68)');
  gradient.addColorStop(1, dark ? 'rgba(4,5,9,0.92)' : 'rgba(255,255,255,0.95)');
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(frame.x, top, frame.w, frame.y + frame.h - top);
  ctx.restore();
}

export function templateById(id: TemplateId): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}

export function templatesForPreset(preset: PresetId): Template[] {
  return TEMPLATES.filter((t) => t.presets === 'all' || t.presets.includes(preset));
}
