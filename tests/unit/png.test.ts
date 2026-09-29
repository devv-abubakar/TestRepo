import { describe, expect, it } from 'vitest';
import { unzlibSync } from 'fflate';
import { encodePng24, rgbaToRgb, readPngColorType } from '../../src/core/png';

/** Reverses the adaptive filtering so the test can compare real pixel values. */
function decodeTruecolorPng(png: Uint8Array): { width: number; height: number; rgb: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];

  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    const body = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += len + 12;
  }

  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }

  const raw = unzlibSync(joined);
  const stride = width * 3;
  const rgb = new Uint8Array(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 3 ? rgb[y * stride + i - 3]! : 0;
      const above = y === 0 ? 0 : rgb[(y - 1) * stride + i]!;
      const value =
        filter === 0 ? line[i]! : filter === 1 ? (line[i]! + left) & 0xff : (line[i]! + above) & 0xff;
      rgb[y * stride + i] = value;
    }
  }

  return { width, height, rgb };
}

function solid(width: number, height: number, r: number, g: number, b: number, a = 255) {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = a;
  }
  return px;
}

describe('encodePng24', () => {
  it('writes a valid PNG signature and colour type 2 (no alpha)', () => {
    const png = encodePng24(solid(4, 4, 10, 20, 30), 4, 4);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(readPngColorType(png)).toBe(2);
  });

  it('round-trips exact pixel values', () => {
    const width = 17;
    const height = 9;
    const px = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      px[i * 4] = (i * 7) % 256;
      px[i * 4 + 1] = (i * 13) % 256;
      px[i * 4 + 2] = (i * 29) % 256;
      px[i * 4 + 3] = 255;
    }

    const decoded = decodeTruecolorPng(encodePng24(px, width, height));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    for (let i = 0; i < width * height; i += 1) {
      expect(decoded.rgb[i * 3]).toBe((i * 7) % 256);
      expect(decoded.rgb[i * 3 + 1]).toBe((i * 13) % 256);
      expect(decoded.rgb[i * 3 + 2]).toBe((i * 29) % 256);
    }
  });

  it('ends with an IEND chunk', () => {
    const png = encodePng24(solid(2, 2, 0, 0, 0), 2, 2);
    const tail = [...png.subarray(png.length - 8, png.length - 4)];
    expect(String.fromCharCode(...tail)).toBe('IEND');
  });

  it('composites transparency over white rather than over black', () => {
    // A fully transparent black pixel must read as white, not as #000000.
    const rgb = rgbaToRgb(solid(1, 1, 0, 0, 0, 0), 1);
    expect([...rgb]).toEqual([255, 255, 255]);

    const half = rgbaToRgb(solid(1, 1, 0, 0, 0, 128), 1);
    expect(half[0]).toBeGreaterThan(120);
    expect(half[0]).toBeLessThan(135);
  });

  it('is meaningfully smaller than unfiltered output on a gradient', () => {
    const width = 256;
    const height = 256;
    const px = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        px[i] = x;
        px[i + 1] = y;
        px[i + 2] = 128;
        px[i + 3] = 255;
      }
    }
    const png = encodePng24(px, width, height);
    // Raw RGB would be 196608 bytes. Adaptive filtering plus deflate should land
    // far below that on a smooth gradient.
    expect(png.length).toBeLessThan(40_000);
  });

  it('rejects mismatched dimensions', () => {
    expect(() => encodePng24(solid(2, 2, 0, 0, 0), 4, 4)).toThrow(/expected/);
    expect(() => encodePng24(solid(2, 2, 0, 0, 0), 0, 2)).toThrow(/positive/);
  });
});
