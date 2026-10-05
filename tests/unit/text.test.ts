import { describe, expect, it } from 'vitest';
import {
  boundedLevenshtein,
  foldFragment,
  normalizeQuote,
  similarity,
  splitSentences,
  tokenize,
} from '../../src/utils/text';

describe('foldFragment', () => {
  it('folds ligatures, smart quotes and dashes to their ASCII forms', () => {
    expect(foldFragment('ﬁrst')).toBe('first');
    expect(foldFragment('“Data” – info')).toBe('"data" - info');
    expect(foldFragment("it’s")).toBe("it's");
  });

  it('removes zero-width characters and collapses runs of spaces', () => {
    expect(foldFragment('soft­hyphen')).toBe('softhyphen');
    expect(foldFragment('a    b\n\nc')).toBe('a b c');
  });

  it('keeps leading and trailing spaces so fragments can be stitched', () => {
    expect(foldFragment(' mid ')).toBe(' mid ');
  });
});

describe('normalizeQuote', () => {
  it('rejoins a word split across lines by a hyphen', () => {
    expect(normalizeQuote('normali-\nsation of text')).toBe('normalisation of text');
  });

  it('keeps a genuine hyphen that is not at a line break', () => {
    expect(normalizeQuote('cost-benefit analysis')).toBe('cost-benefit analysis');
  });

  it('trims and single-spaces the whole quote', () => {
    expect(normalizeQuote('  Two   words\t here \n')).toBe('two words here');
  });
});

describe('splitSentences', () => {
  it('splits on sentence boundaries followed by a capital', () => {
    expect(splitSentences('One thing. Two things! Three?')).toEqual([
      'One thing.',
      'Two things!',
      'Three?',
    ]);
  });

  it('splits folded lowercase text too, since matching runs on folded text', () => {
    expect(splitSentences('first idea here. second idea here.')).toEqual([
      'first idea here.',
      'second idea here.',
    ]);
  });

  it('returns the input unchanged when there is no boundary', () => {
    expect(splitSentences('a single clause')).toEqual(['a single clause']);
  });
});

describe('boundedLevenshtein', () => {
  it('measures edit distance', () => {
    expect(boundedLevenshtein('kitten', 'sitting', 10)).toBe(3);
    expect(boundedLevenshtein('same', 'same', 2)).toBe(0);
  });

  it('abandons once the bound is exceeded', () => {
    expect(boundedLevenshtein('abcdefgh', 'zzzzzzzz', 2)).toBe(3);
  });
});

describe('similarity', () => {
  it('scores identical strings as 1', () => {
    expect(similarity('exact text', 'exact text')).toBe(1);
  });

  it('scores a near match high and an unrelated string at 0', () => {
    expect(similarity('exam-relevant definition', 'exam relevant definition')).toBeGreaterThan(0.9);
    expect(similarity('definition of inflation', 'completely other words!!')).toBe(0);
  });
});

describe('tokenize', () => {
  it('splits on non-alphanumerics', () => {
    expect(tokenize('Supply-and (demand): 2 laws')).toEqual([
      'Supply',
      'and',
      'demand',
      '2',
      'laws',
    ]);
  });
});
