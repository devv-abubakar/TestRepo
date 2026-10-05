import { describe, expect, it } from 'vitest';
import { sweepForCues } from '../../src/services/pdf/cues';
import type { DocumentText } from '../../src/types';
import { makePage } from './helpers';

function doc(...pages: string[][]): DocumentText {
  const built = pages.map((lines, index) => makePage(index, lines));
  return {
    pages: built,
    usedOcr: false,
    totalChars: built.reduce((sum, page) => sum + page.normalized.length, 0),
  };
}

function texts(document: DocumentText): string[] {
  return sweepForCues(document).map((entry) => entry.text);
}

describe('sweepForCues', () => {
  it('catches a definition the model might skip', () => {
    const found = sweepForCues(
      doc(['Inflation is defined as a sustained increase in the general price level of an economy.']),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.importance).toBe('high');
    expect(found[0]?.reason).toContain('Definition');
    expect(found[0]?.text).toContain('sustained increase in the general price level');
  });

  it('catches the common definition phrasings', () => {
    const phrasings = [
      'Opportunity cost refers to the value of the next best alternative that is forgone.',
      'A ledger is called the book of final entry in the accounting cycle of a business.',
      'Elasticity is known as the responsiveness of quantity demanded to a change in price.',
      'Depreciation can be described as the systematic allocation of the cost of an asset.',
    ];
    for (const sentence of phrasings) {
      expect(texts(doc([sentence])), sentence).toHaveLength(1);
    }
  });

  it('catches formulas, rules and laws', () => {
    expect(texts(doc(['The formula for simple interest is principal multiplied by rate and time.']))).toHaveLength(1);
    expect(texts(doc(['Net profit is given by total revenue minus total expenses for the period.']))).toHaveLength(1);
    expect(texts(doc(['The law of demand states that quantity demanded falls as the price rises.']))).toHaveLength(1);
  });

  it('catches classifications and enumerations', () => {
    expect(texts(doc(['There are four main types of market structure in modern economics today.']))).toHaveLength(1);
    expect(texts(doc(['The accounting cycle consists of journalising, posting and preparing statements.']))).toHaveLength(1);
    expect(texts(doc(['Working capital is classified into permanent and temporary working capital.']))).toHaveLength(1);
  });

  it('catches processes, characteristics and distinctions', () => {
    expect(texts(doc(['The steps involved in the process are planning, organising and controlling.']))).toHaveLength(1);
    expect(texts(doc(['The main characteristics of perfect competition include many buyers and sellers.']))).toHaveLength(1);
    expect(texts(doc(['The difference between a debit and a credit lies in the side of the account.']))).toHaveLength(1);
  });

  it('returns the sentence exactly as it appears in the page text', () => {
    const document = doc(['Inflation is defined as a sustained increase in the general price level.']);
    const found = sweepForCues(document)[0];
    expect(found).toBeDefined();
    // Verbatim by construction: the candidate is a slice of the page's own text.
    expect(document.pages[0]?.normalized).toContain(found!.text);
  });

  it('leaves ordinary narrative alone', () => {
    expect(
      texts(
        doc([
          'Welcome to this lecture and we hope you enjoy studying the material this week.',
          'Please make sure that you have read the previous notes before you continue reading.',
          'That concludes the main discussion for this section of the handout you are reading.',
        ]),
      ),
    ).toEqual([]);
  });

  it('ignores boilerplate that happens to match a cue', () => {
    expect(
      texts(
        doc([
          'Get all Virtual University books in high-quality hard copy and visit vubookshoppk.com.',
          'This handout is copyright of the university and all rights reserved by the authors.',
        ]),
      ),
    ).toEqual([]);
  });

  it('ignores fragments too short to be a real statement', () => {
    expect(texts(doc(['Inflation is called this.']))).toEqual([]);
  });

  it('caps what a single list-heavy page can contribute', () => {
    const lines = Array.from(
      { length: 40 },
      (_, i) => `Item ${i} is defined as one distinct element of the overall classification scheme.`,
    );
    expect(sweepForCues(doc(lines)).length).toBeLessThanOrEqual(14);
  });

  it('sweeps every page of the document', () => {
    const found = sweepForCues(
      doc(
        ['Inflation is defined as a sustained increase in the general price level of an economy.'],
        ['The law of demand states that quantity demanded falls as the price of a good rises.'],
      ),
    );
    expect(found).toHaveLength(2);
  });
});
