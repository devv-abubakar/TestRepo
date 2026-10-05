/**
 * Text normalization shared by PDF extraction and AI-span matching.
 *
 * Both sides of a comparison must run through the exact same pipeline,
 * otherwise an innocuous difference (a ligature, a soft hyphen, a line
 * break inside a sentence) turns an exact quote into a fuzzy near-miss.
 */

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'st',
  'ﬆ': 'st',
};

/** Characters PDF producers use interchangeably with their ASCII twin. */
const FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  'ʼ': "'",
  '´': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '″': '"',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '―': '-',
  '−': '-',
  '⁄': '/',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '　': ' ',
  '•': ' ',
  '·': ' ',
  '…': ' ',
  '�': ' ',
};

/** Zero-width and formatting codepoints that must vanish entirely. */
const DROP = /[­​‌‍⁠﻿]/g;

/**
 * Fold one character to its canonical form. Returns a possibly multi-char
 * string (ligatures) or '' when the character should disappear.
 */
function foldChar(ch: string): string {
  const lig = LIGATURES[ch];
  if (lig !== undefined) return lig;
  const fold = FOLD[ch];
  if (fold !== undefined) return fold;
  return ch;
}

/**
 * Normalize a fragment for comparison: Unicode-folded, lowercased,
 * single-spaced. Whitespace is collapsed but *not* trimmed, because
 * callers stitch fragments together and need the boundary spaces.
 */
export function foldFragment(input: string): string {
  const pre = input.normalize('NFKC').replace(DROP, '');
  let out = '';
  for (const ch of pre) out += foldChar(ch);
  return out.toLowerCase().replace(/[\t\r\n\f\v]+/g, ' ').replace(/ {2,}/g, ' ');
}

/**
 * Normalize a whole quote for matching: folded, hyphenated line breaks
 * rejoined, collapsed and trimmed.
 */
export function normalizeQuote(input: string): string {
  // A hyphen followed by a line break is PDF line-wrapping, not a real hyphen.
  const dehyphenated = input.replace(/(\p{L})-[\r\n]+\s*(\p{L})/gu, '$1$2');
  return foldFragment(dehyphenated).trim();
}

/** Collapse runs of whitespace without touching anything else. */
export function squashSpace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Split a passage into sentence-ish chunks. Used as a matching fallback
 * when a multi-sentence quote straddles a page or column boundary.
 *
 * The lookahead accepts any letter rather than only a capital, because this
 * runs on already-folded (lowercased) text as well as raw model output.
 */
export function splitSentences(input: string): string[] {
  const parts = input
    .split(/(?<=[.!?:;])\s+(?=[\p{L}\p{N}(“"'])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [input.trim()];
}

/** Tokens used for anchor selection and overlap scoring. */
export function tokenize(input: string): string[] {
  return input.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
}

/**
 * Levenshtein distance, abandoned early once it provably exceeds `max`.
 * Returns `max + 1` when the strings are further apart than that.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0] as number;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(
        (prev[j] as number) + 1,
        (curr[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length] as number;
}

/** Similarity in [0, 1] derived from a bounded edit distance. */
export function similarity(a: string, b: string, floor = 0.5): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  const max = Math.ceil(longest * (1 - floor));
  const distance = boundedLevenshtein(a, b, max);
  if (distance > max) return 0;
  return 1 - distance / longest;
}
