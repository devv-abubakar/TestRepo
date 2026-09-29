export type Measure = (text: string) => number;

/**
 * Greedy word wrap. Long unbreakable tokens (URLs, package names) are split
 * mid-word rather than allowed to overflow the frame, because a caption running
 * off the edge of a store screenshot looks like a bug in the app itself.
 */
export function wrapLines(measure: Measure, text: string, maxWidth: number): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return [];
  if (maxWidth <= 0) return [normalized];

  const lines: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.length > 0) {
      lines.push(current);
      current = '';
    }
  };

  for (const word of normalized.split(' ')) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    pushCurrent();

    if (measure(word) <= maxWidth) {
      current = word;
      continue;
    }

    // The word alone does not fit: break it character by character.
    let chunk = '';
    for (const char of word) {
      const next = chunk + char;
      if (chunk.length > 0 && measure(next) > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  }

  pushCurrent();
  return lines;
}

/** Honours explicit line breaks the user typed, wrapping each paragraph. */
export function layoutParagraphs(measure: Measure, text: string, maxWidth: number): string[] {
  return text
    .split('\n')
    .flatMap((paragraph) =>
      paragraph.trim().length === 0 ? [''] : wrapLines(measure, paragraph, maxWidth),
    );
}

export interface FitResult {
  fontSize: number;
  lines: string[];
}

/**
 * Finds the largest font size at which `text` fits inside the given box.
 *
 * Callers pass a measuring function that already accounts for the font family
 * and weight, so this stays free of canvas. Binary search over integer sizes;
 * about 7 iterations for a realistic range, which is cheap enough to run on
 * every keystroke in the editor.
 */
export function fitText(
  measureAt: (text: string, fontSize: number) => number,
  text: string,
  maxWidth: number,
  maxHeight: number,
  lineHeight: number,
  bounds: { min: number; max: number },
): FitResult {
  const fits = (size: number) => {
    const lines = layoutParagraphs((t) => measureAt(t, size), text, maxWidth);
    const height = lines.length * size * lineHeight;
    return { ok: height <= maxHeight, lines };
  };

  let lo = bounds.min;
  let hi = Math.max(bounds.min, Math.floor(bounds.max));
  let best = fits(lo);
  let bestSize = lo;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const attempt = fits(mid);
    if (attempt.ok) {
      best = attempt;
      bestSize = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return { fontSize: bestSize, lines: best.lines };
}

/**
 * Trims a caption to a character budget on a word boundary, for the thumbnail
 * warning in the compliance panel.
 */
export function truncateWords(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
