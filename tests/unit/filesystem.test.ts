import { describe, expect, it } from 'vitest';
import { outputNameFor } from '../../src/services/filesystem';
import { DEFAULT_SUFFIX } from '../../src/constants';

describe('outputNameFor', () => {
  it('appends the suffix before the extension', () => {
    expect(outputNameFor('Handout 01.pdf', DEFAULT_SUFFIX)).toBe('Handout 01_AI_Highlighted.pdf');
  });

  it('is case-insensitive about the original extension', () => {
    expect(outputNameFor('Lecture.PDF', DEFAULT_SUFFIX)).toBe('Lecture_AI_Highlighted.pdf');
  });

  it('preserves a nested path', () => {
    expect(outputNameFor('week1/Handout 02.pdf', DEFAULT_SUFFIX)).toBe(
      'week1/Handout 02_AI_Highlighted.pdf',
    );
  });

  it('honours a custom suffix', () => {
    expect(outputNameFor('Handout.pdf', '_marked')).toBe('Handout_marked.pdf');
  });
});
