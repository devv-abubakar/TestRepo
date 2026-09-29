export interface FontOption {
  family: string;
  label: string;
  /** Weights actually loaded; the picker only offers these. */
  weights: number[];
  note: string;
}

/**
 * Fonts are loaded from Google Fonts, which permits commercial use and
 * embedding in exported images. Nothing here needs a licence the user does not
 * already have.
 */
export const FONTS: FontOption[] = [
  { family: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans', weights: [500, 700, 800], note: 'Warm and geometric. Safe default.' },
  { family: 'Space Grotesk', label: 'Space Grotesk', weights: [500, 700], note: 'Technical. Suits developer tools.' },
  { family: 'Manrope', label: 'Manrope', weights: [500, 700, 800], note: 'Clean and quiet. Lets the UI lead.' },
  { family: 'DM Sans', label: 'DM Sans', weights: [500, 700], note: 'Friendly. Good for consumer apps.' },
  { family: 'Sora', label: 'Sora', weights: [500, 700, 800], note: 'Confident, slightly editorial.' },
  { family: 'Bricolage Grotesque', label: 'Bricolage', weights: [500, 700, 800], note: 'Characterful. Stands out in a feed.' },
  { family: 'Noto Nastaliq Urdu', label: 'Noto Nastaliq Urdu', weights: [500, 700], note: 'For Urdu captions.' },
];

/**
 * Canvas text silently falls back to a system font when the requested family is
 * not yet loaded — and because the preview and the export run milliseconds
 * apart, that shows up as an export whose type does not match what the user
 * approved. So every face is awaited before any render.
 */
export async function ensureFontsLoaded(families: string[], weights: number[]): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const jobs: Promise<unknown>[] = [];
  for (const family of new Set(families)) {
    for (const weight of new Set(weights)) {
      // A size must be given; it does not affect which file is fetched.
      jobs.push(document.fonts.load(`${weight} 64px "${family}"`).catch(() => undefined));
    }
  }
  await Promise.all(jobs);
  await document.fonts.ready;
}

export function fontOption(family: string): FontOption {
  return FONTS.find((f) => f.family === family) ?? FONTS[0]!;
}
