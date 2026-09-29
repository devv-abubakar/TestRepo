import { zlibSync } from 'fflate';

/**
 * A minimal PNG encoder that writes 8-bit truecolour (colour type 2) images.
 *
 * Why this exists: `canvas.toBlob('image/png')` always produces RGBA
 * (colour type 6), because a canvas always has an alpha channel. Google Play
 * asks for "24-bit PNG (no alpha)" for screenshots and the feature graphic, and
 * uploads carrying an alpha channel are a common, confusing rejection. Exporting
 * JPEG dodges the rule but throws away quality on flat UI colour and text.
 *
 * So the alpha channel is dropped here, in the browser, and a real 24-bit PNG is
 * written by hand. The image is composited over opaque white first, so any
 * transparency the canvas happens to carry resolves the same way a viewer would
 * see it rather than turning black.
 */

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/**
 * Per-scanline adaptive filtering. PNG lets each row choose its own filter, and
 * picking the one with the smallest total deviation before deflating shrinks
 * gradient-heavy store graphics substantially — typically 25-40% versus writing
 * filter 0 everywhere.
 */
function filterScanlines(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3;
  const out = new Uint8Array((stride + 1) * height);
  const none = new Uint8Array(stride);
  const sub = new Uint8Array(stride);
  const up = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : rgb.subarray((y - 1) * stride, y * stride);

    let sumNone = 0;
    let sumSub = 0;
    let sumUp = 0;

    for (let i = 0; i < stride; i += 1) {
      const raw = row[i]!;
      const left = i >= 3 ? row[i - 3]! : 0;
      const above = prev ? prev[i]! : 0;

      none[i] = raw;
      sub[i] = (raw - left) & 0xff;
      up[i] = (raw - above) & 0xff;

      sumNone += raw < 128 ? raw : 256 - raw;
      sumSub += sub[i]! < 128 ? sub[i]! : 256 - sub[i]!;
      sumUp += up[i]! < 128 ? up[i]! : 256 - up[i]!;
    }

    const best = sumNone <= sumSub && sumNone <= sumUp ? 0 : sumSub <= sumUp ? 1 : 2;
    const offset = y * (stride + 1);
    out[offset] = best;
    out.set(best === 0 ? none : best === 1 ? sub : up, offset + 1);
  }

  return out;
}

/** Drops alpha by compositing over opaque white. */
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array, pixels: number): Uint8Array {
  const rgb = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    const s = i * 4;
    const d = i * 3;
    const a = (rgba[s + 3] ?? 255) / 255;
    if (a === 1) {
      rgb[d] = rgba[s] ?? 0;
      rgb[d + 1] = rgba[s + 1] ?? 0;
      rgb[d + 2] = rgba[s + 2] ?? 0;
    } else {
      rgb[d] = Math.round((rgba[s] ?? 0) * a + 255 * (1 - a));
      rgb[d + 1] = Math.round((rgba[s + 1] ?? 0) * a + 255 * (1 - a));
      rgb[d + 2] = Math.round((rgba[s + 2] ?? 0) * a + 255 * (1 - a));
    }
  }
  return rgb;
}

export interface Png24Options {
  /** 0-9; 9 is slowest and smallest. Store assets are exported once, so default high. */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/** Encodes RGBA pixel data as a 24-bit (no alpha) PNG. */
export function encodePng24(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: Png24Options = {},
): Uint8Array {
  if (width <= 0 || height <= 0) throw new Error('encodePng24: width and height must be positive');
  const expected = width * height * 4;
  if (rgba.length < expected) {
    throw new Error(`encodePng24: expected ${expected} bytes of RGBA, received ${rgba.length}`);
  }

  const rgb = rgbaToRgb(rgba, width * height);
  const filtered = filterScanlines(rgb, width, height);
  const compressed = zlibSync(filtered, { level: options.level ?? 9 });

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour, no alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ];

  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Reads back the colour type of a PNG. Used by the test suite and the export check. */
export function readPngColorType(png: Uint8Array): number | null {
  if (png.length < 26) return null;
  for (let i = 0; i < 8; i += 1) if (png[i] !== SIGNATURE[i]) return null;
  return png[25] ?? null;
}
