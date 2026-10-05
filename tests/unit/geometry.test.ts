import { describe, expect, it } from 'vitest';
import { mergeRects, rangeToRects } from '../../src/services/pdf/geometry';
import { makePage } from './helpers';

describe('rangeToRects', () => {
  const page = makePage(0, ['Inflation is a sustained rise in the general price level.']);

  it('returns one rectangle per visual line for a span on a single line', () => {
    const at = page.normalized.indexOf('sustained rise');
    const rects = rangeToRects(page, at, at + 'sustained rise'.length);
    expect(rects).toHaveLength(1);
    expect(rects[0]?.width).toBeGreaterThan(0);
  });

  it('places the rectangle over the matched words, not the whole line', () => {
    const whole = rangeToRects(page, 0, page.normalized.length)[0];
    const at = page.normalized.indexOf('price level');
    const part = rangeToRects(page, at, at + 'price level'.length)[0];
    expect(whole).toBeDefined();
    expect(part).toBeDefined();
    expect(part!.width).toBeLessThan(whole!.width);
    expect(part!.x).toBeGreaterThan(whole!.x);
  });

  it('produces one rectangle per line when a span wraps', () => {
    const wrapped = makePage(0, ['first line of the concept', 'second line of the concept']);
    const start = wrapped.normalized.indexOf('line of the concept');
    const rects = rangeToRects(wrapped, start, wrapped.normalized.length);
    expect(rects).toHaveLength(2);
    expect(rects[0]?.y).toBeGreaterThan(rects[1]?.y ?? 0);
  });

  it('returns nothing for an empty range', () => {
    expect(rangeToRects(page, 5, 5)).toEqual([]);
  });
});

describe('mergeRects', () => {
  it('joins neighbouring rectangles on the same line', () => {
    const merged = mergeRects([
      { x: 10, y: 100, width: 20, height: 10 },
      { x: 32, y: 100, width: 20, height: 10 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.x).toBe(10);
    expect(merged[0]?.width).toBe(42);
  });

  it('keeps rectangles on different lines separate', () => {
    const merged = mergeRects([
      { x: 10, y: 100, width: 20, height: 10 },
      { x: 10, y: 60, width: 20, height: 10 },
    ]);
    expect(merged).toHaveLength(2);
  });
});
