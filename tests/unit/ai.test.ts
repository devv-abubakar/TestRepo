import { describe, expect, it } from 'vitest';
import { parseAiResponse } from '../../src/services/ai';
import { buildChunks, buildUserMessage, CHUNK_CHAR_BUDGET } from '../../src/services/ai/prompt';
import { AiError } from '../../src/types';
import { makePage } from './helpers';

describe('parseAiResponse', () => {
  it('parses a clean response', () => {
    const parsed = parseAiResponse('{"highlights":[{"text":"A span","importance":"high","reason":"Definition"}]}');
    expect(parsed.highlights).toHaveLength(1);
    expect(parsed.highlights[0]?.importance).toBe('high');
  });

  it('tolerates code fences and surrounding chatter', () => {
    const parsed = parseAiResponse('Sure!\n```json\n{"highlights":[{"text":"x","importance":"low","reason":""}]}\n```');
    expect(parsed.highlights).toHaveLength(1);
  });

  it('drops entries with a missing or unknown importance', () => {
    const parsed = parseAiResponse(
      '{"highlights":[{"text":"keep","importance":"medium"},{"text":"drop","importance":"critical"},{"text":"drop2"}]}',
    );
    expect(parsed.highlights.map((h) => h.text)).toEqual(['keep']);
  });

  it('drops entries with empty text rather than guessing', () => {
    const parsed = parseAiResponse('{"highlights":[{"text":"   ","importance":"high"}]}');
    expect(parsed.highlights).toHaveLength(0);
  });

  it('throws a retryable error for non-JSON replies', () => {
    expect(() => parseAiResponse('I cannot do that.')).toThrowError(AiError);
    try {
      parseAiResponse('I cannot do that.');
    } catch (error) {
      expect((error as AiError).kind).toBe('invalid-response');
      expect((error as AiError).retryable).toBe(true);
    }
  });

  it('throws when the highlights array is missing', () => {
    expect(() => parseAiResponse('{"results":[]}')).toThrowError(/highlights/);
  });

  it('accepts an explicitly empty result', () => {
    expect(parseAiResponse('{"highlights":[]}').highlights).toEqual([]);
  });
});

describe('buildChunks', () => {
  it('keeps a short document in a single chunk', () => {
    const chunks = buildChunks([makePage(0, ['short page one']), makePage(1, ['short page two'])]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.pageIndices).toEqual([0, 1]);
  });

  it('splits on page boundaries once the budget is exceeded', () => {
    const long = 'word '.repeat(2000).trim();
    const pages = [0, 1, 2, 3].map((index) => makePage(index, [long]));
    const chunks = buildChunks(pages);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.pageIndices.length).toBeGreaterThan(0);
      // A chunk may exceed the budget only when a single page does.
      if (chunk.pageIndices.length > 1) expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_CHAR_BUDGET);
    }
    const covered = chunks.flatMap((chunk) => chunk.pageIndices);
    expect(covered).toEqual([0, 1, 2, 3]);
  });

  it('skips blank pages and tags every chunk with page numbers', () => {
    const chunks = buildChunks([makePage(0, []), makePage(1, ['real content on page two'])]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('[page 2]');
  });

  it('scales the highlight ceiling with page count but caps it', () => {
    const one = buildChunks([makePage(0, ['a page of content'])]);
    expect(one[0]?.maxHighlights).toBeGreaterThanOrEqual(2);
    const many = buildChunks(Array.from({ length: 30 }, (_, i) => makePage(i, ['content here'])));
    expect(many[0]?.maxHighlights).toBeLessThanOrEqual(24);
  });
});

describe('buildUserMessage', () => {
  it('states the course, handout and highlight ceiling', () => {
    const message = buildUserMessage({
      content: '[page 1]\nbody',
      courseCode: 'CS101',
      handoutName: 'Handout 01.pdf',
      maxHighlights: 6,
    });
    expect(message).toContain('CS101');
    expect(message).toContain('Handout 01.pdf');
    expect(message).toContain('at most 6 highlights');
    expect(message).toContain('body');
  });
});
