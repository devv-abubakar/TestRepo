import { describe, expect, it } from 'vitest';
import { MAX_CROP, detectCropFraction, detectStatusBarHeight } from '../../src/core/statusbar';

interface Band {
  rows: number;
  /** null = flat fill, otherwise draw icon-like blocks. */
  icons: boolean;
  color: [number, number, number];
}

function buildImage(width: number, bands: Band[]): { rgba: Uint8ClampedArray; height: number } {
  const height = bands.reduce((n, b) => n + b.rows, 0);
  const rgba = new Uint8ClampedArray(width * height * 4);
  let y = 0;
  for (const band of bands) {
    for (let row = 0; row < band.rows; row += 1, y += 1) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        let [r, g, b] = band.color;
        if (band.icons) {
          // Icon clusters at the left and right, like a real status bar.
          const inIcon = x < width * 0.14 || x > width * 0.7;
          if (inIcon && Math.floor(x / 3) % 2 === 0) {
            r = 255 - r;
            g = 255 - g;
            b = 255 - b;
          }
        }
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = 255;
      }
    }
  }
  return { rgba, height };
}

describe('detectStatusBarHeight', () => {
  it('finds a typical dark status bar', () => {
    const { rgba, height } = buildImage(360, [
      { rows: 6, icons: false, color: [18, 18, 20] },
      { rows: 14, icons: true, color: [18, 18, 20] },
      { rows: 6, icons: false, color: [18, 18, 20] },
      { rows: 600, icons: true, color: [240, 240, 245] },
    ]);
    const px = detectStatusBarHeight(rgba, 360, height);
    expect(px).toBeGreaterThanOrEqual(18);
    expect(px).toBeLessThanOrEqual(30);
  });

  it('finds a light status bar too', () => {
    const { rgba, height } = buildImage(360, [
      { rows: 5, icons: false, color: [250, 250, 252] },
      { rows: 12, icons: true, color: [250, 250, 252] },
      { rows: 5, icons: false, color: [250, 250, 252] },
      { rows: 500, icons: true, color: [20, 24, 30] },
    ]);
    expect(detectStatusBarHeight(rgba, 360, height)).toBeGreaterThan(10);
  });

  it('returns 0 when the very first row already has content', () => {
    const { rgba, height } = buildImage(360, [{ rows: 400, icons: true, color: [120, 30, 30] }]);
    expect(detectStatusBarHeight(rgba, 360, height)).toBe(0);
  });

  it('returns 0 for a completely flat image', () => {
    const { rgba, height } = buildImage(360, [{ rows: 400, icons: false, color: [10, 10, 10] }]);
    expect(detectStatusBarHeight(rgba, 360, height)).toBe(0);
  });

  it('never crops more than the cap, even on a pathological image', () => {
    // Content starts only after a very tall band, which a naive scan would
    // happily crop away along with the app's own header.
    const { rgba, height } = buildImage(360, [
      { rows: 4, icons: false, color: [0, 0, 0] },
      { rows: 300, icons: true, color: [0, 0, 0] },
      { rows: 300, icons: false, color: [255, 255, 255] },
    ]);
    const fraction = detectCropFraction(rgba, 360, height);
    expect(fraction).toBeLessThanOrEqual(MAX_CROP);
  });

  it('handles degenerate input without throwing', () => {
    expect(detectStatusBarHeight(new Uint8ClampedArray(0), 0, 0)).toBe(0);
    expect(detectStatusBarHeight(new Uint8ClampedArray(16), 2, 2)).toBe(0);
  });
});
