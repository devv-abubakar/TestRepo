import { luminance, parseHex, readableTextOn, rgbToHsl, shift, toHex, hslToRgb } from './color';
import type { Background } from './types';

export interface Palette {
  id: string;
  label: string;
  /** Background gradient stops, dark-to-light or brand-to-accent. */
  colors: string[];
  accent: string;
  text: string;
}

/**
 * Curated palettes. Each one was checked so that `text` clears a 4.5:1 contrast
 * ratio against the darkest gradient stop — a screenshot caption that cannot be
 * read at thumbnail size is worse than no caption.
 */
export const PALETTES: Palette[] = [
  { id: 'midnight', label: 'Midnight', colors: ['#0b1020', '#1b2a5e'], accent: '#5987ff', text: '#ffffff' },
  { id: 'ink', label: 'Ink', colors: ['#111318', '#2a2f3d'], accent: '#c6ff4f', text: '#ffffff' },
  { id: 'ember', label: 'Ember', colors: ['#2b0a10', '#8f1d2c'], accent: '#ff9d5c', text: '#ffffff' },
  { id: 'forest', label: 'Forest', colors: ['#06211a', '#0f5741'], accent: '#7ef0b2', text: '#ffffff' },
  { id: 'violet', label: 'Violet', colors: ['#1a0b2e', '#5a2a9e'], accent: '#d6a8ff', text: '#ffffff' },
  { id: 'paper', label: 'Paper', colors: ['#f6f4ef', '#e2ded3'], accent: '#1f6feb', text: '#101218' },
  { id: 'mint', label: 'Mint', colors: ['#eafaf3', '#c5eddc'], accent: '#0b6b4f', text: '#101218' },
  { id: 'sand', label: 'Sand', colors: ['#fbf1e4', '#efd9bd'], accent: '#a1521f', text: '#101218' },
  { id: 'slate', label: 'Slate', colors: ['#e8ecf2', '#c6cfdd'], accent: '#24406b', text: '#101218' },
  { id: 'nightshift', label: 'Nightshift', colors: ['#04070f', '#0d1b3a', '#123b63'], accent: '#48d6ff', text: '#ffffff' },
];

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]!;
}

interface Bucket {
  r: number;
  g: number;
  b: number;
  n: number;
  weight: number;
}

/**
 * Derives a palette from a screenshot's pixels.
 *
 * Takes raw RGBA rather than an image element so it stays testable and can run
 * in a worker. Downsample before calling: 64x64 is plenty and keeps this under
 * a millisecond.
 *
 * The weighting is the important part. A naive "most common colour" on an app
 * screenshot returns the white or dark-grey background every time, which makes
 * every generated set look identical. Instead each pixel is weighted by
 * saturation and by distance from pure black/white, so the app's actual brand
 * colour wins even when it covers only a small part of the screen.
 */
export function extractPalette(rgba: Uint8ClampedArray, width: number, height: number): Palette {
  const buckets = new Map<number, Bucket>();
  let counted = 0;
  const total = width * height;
  if (total === 0 || rgba.length < 4) return paletteById('midnight');

  // 5 bits per channel => 32768 possible buckets, coarse enough to merge
  // gradients and antialiasing but fine enough to keep distinct brand hues apart.
  for (let i = 0; i < total; i += 1) {
    const o = i * 4;
    const a = rgba[o + 3] ?? 255;
    if (a < 128) continue;
    const r = rgba[o] ?? 0;
    const g = rgba[o + 1] ?? 0;
    const b = rgba[o + 2] ?? 0;

    const { s, l } = rgbToHsl({ r, g, b });
    // Ignore near-white and near-black: they are chrome, not identity.
    if (l > 0.94 || l < 0.05) continue;
    // Saturation is raised to a power and given almost no floor, because the
    // neutral grey of a typical app background outnumbers the brand colour by
    // twenty to one. A generous floor lets sheer pixel count win, and every
    // generated set comes out the same grey.
    const weight = (0.02 + Math.pow(s, 1.5) * 2) * (1 - Math.abs(l - 0.5) * 0.85);
    counted += 1;

    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.n += 1;
      bucket.weight += weight;
    } else {
      buckets.set(key, { r, g, b, n: 1, weight });
    }
  }

  if (buckets.size === 0) return paletteById('midnight');

  const averaged = [...buckets.values()].map((b) => ({
    ...b,
    r: b.r / b.n,
    g: b.g / b.n,
    b: b.b / b.n,
  }));

  // A ten-pixel red notification badge should not decide the whole theme, so a
  // bucket has to cover a minimum share of the image to be eligible at all.
  const floor = Math.max(2, counted * 0.004);
  const eligible = averaged.filter((b) => b.n >= floor);
  const ranked = (eligible.length > 0 ? eligible : averaged).sort((a, b) => b.weight - a.weight);

  const dominant = ranked[0]!;
  const dominantHex = toHex(dominant);
  const { h, s } = rgbToHsl(dominant);

  // Build the background as a deepened two-stop gradient of the dominant hue.
  // Deepening rather than using the raw colour keeps the screenshot itself the
  // brightest thing in the frame, which is what draws the eye.
  const isLight = luminance(dominant) > 0.45;
  const sat = Math.max(0.28, Math.min(s, 0.72));
  const stopA = toHex(hslToRgb(h, sat, isLight ? 0.9 : 0.1));
  const stopB = toHex(hslToRgb(h + 14, sat * 0.95, isLight ? 0.78 : 0.26));

  // Accent: a complementary-ish hue that stays legible on the background.
  const accentSeed = shift(dominantHex, 32, 0.25, isLight ? -0.25 : 0.3);

  return {
    id: 'auto',
    label: 'From screenshot',
    colors: [stopA, stopB],
    accent: accentSeed,
    text: readableTextOn(parseHex(stopA)),
  };
}

export function paletteToBackground(palette: Palette, base: Background): Background {
  return { ...base, colors: [...palette.colors] };
}
