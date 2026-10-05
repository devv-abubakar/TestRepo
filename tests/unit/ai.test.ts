import { describe, expect, it } from 'vitest';
import { parseAiResponse } from '../../src/services/ai';
import {
  buildChunks,
  buildUserMessage,
  CHUNK_CHAR_BUDGET,
  passPlan,
  systemPrompt,
} from '../../src/services/ai/prompt';
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
    expect(one[0]?.maxHighlights).toBeGreaterThanOrEqual(3);
    const many = buildChunks(Array.from({ length: 30 }, (_, i) => makePage(i, ['content here'])));
    expect(many[0]?.maxHighlights).toBeLessThanOrEqual(60);
  });

  it('asks for more highlights in the higher coverage modes', () => {
    const pages = Array.from({ length: 3 }, (_, i) => makePage(i, ['a page of real content here']));
    const selective = buildChunks(pages, 'selective')[0]?.maxHighlights ?? 0;
    const balanced = buildChunks(pages, 'balanced')[0]?.maxHighlights ?? 0;
    const complete = buildChunks(pages, 'complete')[0]?.maxHighlights ?? 0;
    expect(selective).toBeLessThan(balanced);
    expect(balanced).toBeLessThan(complete);
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

describe('passPlan', () => {
  it('runs one pass in selective mode', () => {
    expect(passPlan('selective').map((pass) => pass.kind)).toEqual(['primary']);
  });

  it('adds a gap sweep in balanced mode', () => {
    expect(passPlan('balanced').map((pass) => pass.kind)).toEqual(['primary', 'gap']);
  });

  it('adds a structured definition sweep in complete mode', () => {
    expect(passPlan('complete').map((pass) => pass.kind)).toEqual(['primary', 'gap', 'structured']);
  });
});

describe('systemPrompt', () => {
  it('tells the model to be sparing in selective mode', () => {
    expect(systemPrompt('selective')).toMatch(/MINIMUM amount of highlighting/);
  });

  it('tells the model to aim for completeness in complete mode', () => {
    const prompt = systemPrompt('complete');
    expect(prompt).toMatch(/completeness, not brevity/);
    expect(prompt).toMatch(/EVERY definition/);
    expect(prompt).toMatch(/When in doubt, INCLUDE it/);
  });

  it('always demands verbatim spans and a JSON-only reply', () => {
    for (const mode of ['selective', 'balanced', 'complete'] as const) {
      expect(systemPrompt(mode)).toMatch(/character-for-character/);
      expect(systemPrompt(mode)).toMatch(/Respond with JSON only/);
    }
  });
});

describe('buildUserMessage with an exclusion list', () => {
  it('lists what has already been selected so a sweep does not repeat it', () => {
    const message = buildUserMessage(
      { content: 'body', courseCode: 'CS101', handoutName: 'H.pdf', maxHighlights: 5 },
      ['first already selected span', 'second already selected span'],
    );
    expect(message).toContain('ALREADY SELECTED');
    expect(message).toContain('1. first already selected span');
    expect(message).toContain('2. second already selected span');
  });

  it('summarises a very long exclusion list instead of sending all of it', () => {
    const many = Array.from({ length: 80 }, (_, i) => `span number ${i}`);
    const message = buildUserMessage(
      { content: 'body', courseCode: 'CS101', handoutName: 'H.pdf', maxHighlights: 5 },
      many,
    );
    expect(message).toContain('and 20 more');
    expect(message).not.toContain('span number 79');
  });

  it('omits the section entirely for a first pass', () => {
    const message = buildUserMessage({
      content: 'body',
      courseCode: 'CS101',
      handoutName: 'H.pdf',
      maxHighlights: 5,
    });
    expect(message).not.toContain('ALREADY SELECTED');
  });
});
