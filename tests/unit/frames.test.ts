import { describe, expect, it } from 'vitest';
import { FRAME_COLORS, fitBody, frameMetrics } from '../../src/core/frames';
import { containRect, coverRect } from '../../src/core/draw';
import { parseHex, toHex } from '../../src/core/color';

describe('frameMetrics', () => {
  it('insets the screen by a uniform bezel on all sides', () => {
    const m = frameMetrics({ x: 0, y: 0, w: 1000, h: 2000 }, 'phone');
    expect(m.bezel).toBeCloseTo(26);
    expect(m.screen.x).toBeCloseTo(26);
    expect(m.screen.y).toBeCloseTo(26);
    expect(m.screen.w).toBeCloseTo(948);
    expect(m.screen.h).toBeCloseTo(1948);
  });

  it('keeps the screen radius inside the body radius', () => {
    const m = frameMetrics({ x: 0, y: 0, w: 800, h: 1600 }, 'phone');
    expect(m.screenRadius).toBeLessThan(m.bodyRadius);
    expect(m.screenRadius).toBeGreaterThan(0);
  });

  it('gives a tablet a thicker bezel and a tighter corner than a phone', () => {
    const box = { x: 0, y: 0, w: 1000, h: 1500 };
    const phone = frameMetrics(box, 'phone');
    const tablet = frameMetrics(box, 'tablet');
    expect(tablet.bezel).toBeGreaterThan(phone.bezel);
    expect(tablet.bodyRadius).toBeLessThan(phone.bodyRadius);
  });

  it('never produces a negative screen for a tiny body', () => {
    const m = frameMetrics({ x: 0, y: 0, w: 4, h: 4 }, 'phone');
    expect(m.screen.w).toBeGreaterThan(0);
    expect(m.screen.h).toBeGreaterThan(0);
  });
});

describe('fitBody', () => {
  const box = { x: 100, y: 50, w: 600, h: 1200 };

  it('produces a body whose SCREEN matches the requested ratio', () => {
    // This is the property that actually matters: the screenshot must not be
    // distorted, and the bezel is a fraction of body width, not of body height.
    for (const kind of ['phone', 'tablet'] as const) {
      for (const ratio of [9 / 16, 9 / 19.5, 3 / 4, 1, 16 / 9]) {
        const body = fitBody(box, ratio, kind);
        const m = frameMetrics(body, kind);
        expect(m.screen.w / m.screen.h).toBeCloseTo(ratio, 4);
      }
    }
  });

  it('stays inside the bounding box', () => {
    for (const ratio of [0.4, 9 / 16, 1, 2.2]) {
      const body = fitBody(box, ratio, 'phone');
      expect(body.w).toBeLessThanOrEqual(box.w + 0.01);
      expect(body.h).toBeLessThanOrEqual(box.h + 0.01);
      expect(body.x).toBeGreaterThanOrEqual(box.x - 0.01);
      expect(body.y).toBeGreaterThanOrEqual(box.y - 0.01);
    }
  });

  it('centres the body in the box', () => {
    const body = fitBody(box, 9 / 16, 'phone');
    expect(body.x + body.w / 2).toBeCloseTo(box.x + box.w / 2, 4);
    expect(body.y + body.h / 2).toBeCloseTo(box.y + box.h / 2, 4);
  });

  it('survives a degenerate ratio', () => {
    const body = fitBody(box, 0, 'phone');
    expect(Number.isFinite(body.w)).toBe(true);
    expect(body.w).toBeGreaterThan(0);
  });
});

describe('coverRect', () => {
  it('crops the long axis of a too-tall source', () => {
    const r = coverRect({ x: 0, y: 0, w: 100, h: 100 }, 100, 200);
    expect(r.sw).toBe(100);
    expect(r.sh).toBe(100);
    expect(r.sy).toBe(50);
  });

  it('crops the long axis of a too-wide source', () => {
    const r = coverRect({ x: 0, y: 0, w: 100, h: 100 }, 200, 100);
    expect(r.sh).toBe(100);
    expect(r.sw).toBe(100);
    expect(r.sx).toBe(50);
  });

  it('is a no-op when ratios already match', () => {
    const r = coverRect({ x: 0, y: 0, w: 50, h: 100 }, 200, 400);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    expect(r.sw).toBe(200);
    expect(r.sh).toBe(400);
  });

  it('does not divide by zero on an empty source', () => {
    const r = coverRect({ x: 0, y: 0, w: 10, h: 10 }, 0, 0);
    expect(Number.isFinite(r.sw)).toBe(true);
  });
});

describe('containRect', () => {
  it('preserves the source aspect ratio', () => {
    const r = containRect({ x: 0, y: 0, w: 100, h: 100 }, 200, 100);
    expect(r.w / r.h).toBeCloseTo(2);
    expect(r.w).toBeLessThanOrEqual(100);
    expect(r.h).toBeLessThanOrEqual(100);
  });
});

describe('FRAME_COLORS', () => {
  it('defines three body stops and parseable hex for every finish', () => {
    for (const [name, paint] of Object.entries(FRAME_COLORS)) {
      expect(paint.body, name).toHaveLength(3);
      for (const hex of [...paint.body, paint.edge, paint.highlight]) {
        // A typo'd hex silently parses as black and ruins the frame, so assert
        // that every value survives a parse/serialise round trip.
        expect(toHex(parseHex(hex)), `${name}:${hex}`).toBe(hex.toLowerCase());
      }
    }
  });
});
