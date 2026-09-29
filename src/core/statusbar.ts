/**
 * Detects how much of the top of a screenshot is the phone's own status bar.
 *
 * Developers screenshot on their personal device, so uploads arrive carrying a
 * 47%-battery icon, three unread notification dots and a carrier name. Cropping
 * that away and letting the tool draw a neutral status bar instead is the single
 * change that most makes a homemade screenshot look like a designed one.
 *
 * The heuristic reads the vertical structure every Android status bar shares:
 *
 *   rows of flat padding  →  rows containing icons  →  rows of flat padding
 *   →  app content
 *
 * So: walk down from the top, find where the icons start, then find where the
 * flat band after them ends. Cap the result, and return 0 rather than guess when
 * the shape is not there — an over-eager crop that eats the app's own header is
 * worse than no crop at all.
 */

const TOLERANCE = 26;
const UNIFORM_THRESHOLD = 0.93;
/** Never crop more than this fraction of the image. */
export const MAX_CROP = 0.14;

interface RowStats {
  uniform: boolean;
}

function analyseRow(rgba: Uint8ClampedArray, width: number, y: number): RowStats {
  const offset = y * width * 4;
  // Sample at most 160 columns; full-width scanning buys no accuracy here.
  const step = Math.max(1, Math.floor(width / 160));
  let samples = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  for (let x = 0; x < width; x += step) {
    const o = offset + x * 4;
    sumR += rgba[o] ?? 0;
    sumG += rgba[o + 1] ?? 0;
    sumB += rgba[o + 2] ?? 0;
    samples += 1;
  }
  if (samples === 0) return { uniform: true };

  const avgR = sumR / samples;
  const avgG = sumG / samples;
  const avgB = sumB / samples;

  let near = 0;
  for (let x = 0; x < width; x += step) {
    const o = offset + x * 4;
    const d =
      Math.abs((rgba[o] ?? 0) - avgR) +
      Math.abs((rgba[o + 1] ?? 0) - avgG) +
      Math.abs((rgba[o + 2] ?? 0) - avgB);
    if (d <= TOLERANCE * 3) near += 1;
  }

  return { uniform: near / samples >= UNIFORM_THRESHOLD };
}

/**
 * Returns the status bar height in pixels, or 0 when no confident match is found.
 */
export function detectStatusBarHeight(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return 0;

  const cap = Math.floor(height * MAX_CROP);
  if (cap < 4) return 0;

  const rows: boolean[] = [];
  for (let y = 0; y < cap + 2 && y < height; y += 1) {
    rows.push(analyseRow(rgba, width, y).uniform);
  }

  // Where do the icons begin?
  let iconStart = -1;
  for (let y = 0; y < rows.length; y += 1) {
    if (!rows[y]) {
      iconStart = y;
      break;
    }
  }
  // A screenshot whose very first row already has content has no status bar
  // padding, and anything we cropped would be app UI.
  if (iconStart <= 0) return 0;

  // Where does the flat band after the icons end?
  for (let y = iconStart + 1; y < rows.length; y += 1) {
    if (rows[y]) {
      // Require at least one more flat row, so a single flat row inside the
      // icon area does not end the search early.
      if (rows[y + 1] === true || y + 1 >= rows.length) {
        return y <= cap ? y : 0;
      }
    }
  }

  return 0;
}

export function detectCropFraction(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const px = detectStatusBarHeight(rgba, width, height);
  if (px <= 0 || height <= 0) return 0;
  return Math.min(MAX_CROP, px / height);
}
