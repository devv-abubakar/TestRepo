import { describe, expect, it } from 'vitest';
import { findFuzzy, matchHighlights } from '../../src/services/pdf/match';
import type { AiHighlight, DocumentText, HighlightSettings } from '../../src/types';
import { makePage } from './helpers';

const SETTINGS: HighlightSettings = {
  color: '#FFF176',
  opacity: 0.38,
  minImportance: 'medium',
  maxPerPage: 6,
  minConfidence: 0.9,
};

const DEFINITION = 'Inflation is a sustained increase in the general price level of an economy.';
const CONCEPT = 'Demand pull inflation occurs when aggregate demand exceeds aggregate supply.';

function doc(...pages: string[][]): DocumentText {
  const built = pages.map((lines, index) => makePage(index, lines));
  return {
    pages: built,
    usedOcr: false,
    totalChars: built.reduce((sum, page) => sum + page.normalized.length, 0),
  };
}

function highlight(text: string, importance: AiHighlight['importance'] = 'high'): AiHighlight {
  return { text, importance, reason: 'Key definition' };
}

describe('findFuzzy', () => {
  const haystack = 'the law of diminishing marginal utility states that satisfaction falls';

  it('locates a quote that differs only in spacing', () => {
    const hit = findFuzzy(haystack, 'law of  diminishing marginal utility', 0.9);
    expect(hit).not.toBeNull();
    expect(hit!.confidence).toBeGreaterThan(0.9);
    expect(haystack.slice(hit!.start, hit!.end)).toContain('diminishing marginal utility');
  });

  it('returns null for text that is not in the page', () => {
    expect(findFuzzy(haystack, 'the quantity theory of money is unrelated here', 0.9)).toBeNull();
  });
});

describe('matchHighlights', () => {
  it('matches an exact quote at full confidence', () => {
    const report = matchHighlights(doc([DEFINITION]), [highlight(DEFINITION)], SETTINGS);
    expect(report.acceptedSpans).toBe(1);
    expect(report.matched[0]?.confidence).toBe(1);
    expect(report.matched[0]?.rects.length).toBeGreaterThan(0);
    expect(report.failures).toHaveLength(0);
  });

  it('tolerates extra whitespace, case and smart punctuation', () => {
    const report = matchHighlights(
      doc([DEFINITION]),
      [highlight('INFLATION  is a sustained increase in the general   price level')],
      SETTINGS,
    );
    expect(report.acceptedSpans).toBe(1);
  });

  it('rejects text the model invented rather than copied', () => {
    const report = matchHighlights(
      doc([DEFINITION]),
      [highlight('Inflation is caused solely by printing too much paper currency.')],
      SETTINGS,
    );
    expect(report.acceptedSpans).toBe(0);
    expect(report.matched).toHaveLength(0);
    expect(report.failures[0]?.reason).toContain('not found');
  });

  it('refuses quotes too short to identify safely', () => {
    const report = matchHighlights(doc([DEFINITION]), [highlight('price')], SETTINGS);
    expect(report.acceptedSpans).toBe(0);
    expect(report.failures[0]?.reason).toContain('too short');
  });

  it('honours the minimum importance setting', () => {
    const report = matchHighlights(
      doc([DEFINITION]),
      [highlight(DEFINITION, 'low')],
      { ...SETTINGS, minImportance: 'high' },
    );
    expect(report.matched).toHaveLength(0);
  });

  it('drops a duplicate span that resolves to the same range', () => {
    const report = matchHighlights(
      doc([DEFINITION]),
      [highlight(DEFINITION), highlight(DEFINITION)],
      SETTINGS,
    );
    expect(report.acceptedSpans).toBe(1);
    expect(report.failures[0]?.reason).toContain('duplicate');
  });

  it('enforces the per-page highlight cap', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `Principle number ${i} explains a distinct idea.`);
    const report = matchHighlights(
      doc(lines),
      lines.map((line) => highlight(line)),
      { ...SETTINGS, maxPerPage: 3 },
    );
    expect(report.acceptedSpans).toBe(3);
    expect(report.failures.some((f) => f.reason.includes('per-page'))).toBe(true);
  });

  it('refuses to highlight more than roughly a third of a dense page', () => {
    const lines = Array.from(
      { length: 30 },
      (_, i) => `Paragraph ${i} explains one distinct idea in a full sentence of body text.`,
    );
    const report = matchHighlights(
      doc(lines),
      lines.map((line) => highlight(line)),
      { ...SETTINGS, maxPerPage: 0 },
    );
    expect(report.acceptedSpans).toBeGreaterThan(0);
    expect(report.acceptedSpans).toBeLessThan(lines.length / 2);
    expect(report.failures.some((f) => f.reason.includes('coverage ceiling'))).toBe(true);
  });

  it('always allows at least one highlight on a sparse page', () => {
    const report = matchHighlights(
      doc(['Opportunity cost is the value of the next best alternative forgone.']),
      [highlight('Opportunity cost is the value of the next best alternative forgone.')],
      SETTINGS,
    );
    expect(report.acceptedSpans).toBe(1);
  });

  it('finds a quote on any page of the document', () => {
    const report = matchHighlights(doc(['cover page'], [DEFINITION], [CONCEPT]), [highlight(CONCEPT)], SETTINGS);
    expect(report.matched[0]?.pageIndex).toBe(2);
  });

  it('falls back to sentence matching when a quote straddles a page break', () => {
    const report = matchHighlights(
      doc([DEFINITION], [CONCEPT]),
      [highlight(`${DEFINITION} ${CONCEPT}`)],
      SETTINGS,
    );
    expect(report.acceptedSpans).toBe(1);
    expect(report.matched).toHaveLength(2);
    expect(new Set(report.matched.map((m) => m.pageIndex))).toEqual(new Set([0, 1]));
    expect(new Set(report.matched.map((m) => m.groupId)).size).toBe(1);
  });

  it('never returns a match below the confidence floor', () => {
    const report = matchHighlights(
      doc([DEFINITION]),
      [highlight('Inflation is a sustained decrease in the special price levels of a country.')],
      { ...SETTINGS, minConfidence: 0.97 },
    );
    expect(report.matched).toHaveLength(0);
    expect(report.failures).toHaveLength(1);
  });

  it('snaps a match outwards so it never starts mid-word', () => {
    const report = matchHighlights(doc([DEFINITION]), [highlight(DEFINITION.slice(3, -5))], SETTINGS);
    const matched = report.matched[0]?.matchedText ?? '';
    expect(matched.startsWith('flation')).toBe(false);
  });
});
