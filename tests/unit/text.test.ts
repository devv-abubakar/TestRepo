import { describe, expect, it } from 'vitest';
import { fitText, layoutParagraphs, truncateWords, wrapLines } from '../../src/core/text';

/** Monospace stand-in: every character is 10 units wide. */
const mono = (text: string) => text.length * 10;
const monoAt = (text: string, size: number) => text.length * size * 0.6;

describe('wrapLines', () => {
  it('wraps on word boundaries', () => {
    expect(wrapLines(mono, 'track every rupee', 100)).toEqual(['track', 'every', 'rupee']);
  });

  it('keeps words together when they fit', () => {
    expect(wrapLines(mono, 'a b c', 100)).toEqual(['a b c']);
  });

  it('collapses runs of whitespace', () => {
    expect(wrapLines(mono, '  a    b  ', 1000)).toEqual(['a b']);
  });

  it('returns nothing for empty input', () => {
    expect(wrapLines(mono, '   ', 100)).toEqual([]);
  });

  it('breaks a single word that cannot fit', () => {
    const lines = wrapLines(mono, 'com.abubakar.adtrace', 50);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(mono(line)).toBeLessThanOrEqual(50);
  });

  it('never exceeds the max width on realistic captions', () => {
    const caption = 'Find the app showing you popup ads and remove it in one tap';
    for (const width of [80, 150, 240, 500]) {
      for (const line of wrapLines(mono, caption, width)) {
        expect(mono(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe('layoutParagraphs', () => {
  it('preserves author line breaks', () => {
    expect(layoutParagraphs(mono, 'one\ntwo', 1000)).toEqual(['one', 'two']);
  });

  it('keeps a blank line as a blank line', () => {
    expect(layoutParagraphs(mono, 'a\n\nb', 1000)).toEqual(['a', '', 'b']);
  });
});

describe('fitText', () => {
  it('returns the largest size that still fits the box', () => {
    const result = fitText(monoAt, 'Track every rupee', 600, 200, 1.15, { min: 12, max: 200 });
    const height = result.lines.length * result.fontSize * 1.15;
    expect(height).toBeLessThanOrEqual(200);
    for (const line of result.lines) {
      expect(monoAt(line, result.fontSize)).toBeLessThanOrEqual(600);
    }
  });

  it('shrinks long text rather than overflowing', () => {
    const short = fitText(monoAt, 'Fast', 600, 300, 1.15, { min: 12, max: 160 });
    const long = fitText(
      monoAt,
      'Automatically detect which sideloaded application is responsible for the popup advertisement you just saw',
      600,
      300,
      1.15,
      { min: 12, max: 160 },
    );
    expect(long.fontSize).toBeLessThan(short.fontSize);
  });

  it('never drops below the minimum size', () => {
    const result = fitText(monoAt, 'x'.repeat(4000), 100, 40, 1.15, { min: 14, max: 120 });
    expect(result.fontSize).toBe(14);
  });
});

describe('truncateWords', () => {
  it('leaves short text untouched', () => {
    expect(truncateWords('Track spending', 40)).toBe('Track spending');
  });

  it('cuts on a word boundary and appends an ellipsis', () => {
    expect(truncateWords('Track every single rupee automatically', 20)).toBe('Track every single…');
  });
});
