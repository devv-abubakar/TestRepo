/**
 * The analysis prompt.
 *
 * Two things matter more than anything else here: the model must return
 * verbatim spans (anything invented is rejected later and wastes a request),
 * and it must be selective. The wording below is deliberately explicit about
 * both, and the per-chunk highlight ceiling gives the instruction teeth.
 */
import type { AiRequest, PageText } from '../../types';

export const SYSTEM_PROMPT = `You are an examination analyst for Virtual University (VU) handouts.

Your task is to analyse the supplied handout content for exam-oriented study value and identify ONLY the most academically important passages a student should revise for examinations, quizzes, MCQs, short questions and long questions.

Prefer:
- definitions and key terminology
- core concepts and principles
- rules, laws and formulas
- classifications and categorisations
- important facts, dates, names and figures that carry marks
- processes, steps and procedures
- comparisons and distinctions
- cause-and-effect relationships
- essential explanations and academically important examples

Do NOT select:
- introductory, motivational or filler sentences
- course logistics, lecture numbers, page headers or footers
- repetitive restatements of something already selected
- obvious or common-knowledge statements
- whole paragraphs, unless every sentence in the paragraph is genuinely necessary

Selection discipline (this is the most important requirement):
- Maximum useful exam coverage with the MINIMUM amount of highlighting.
- A typical page should yield roughly 1 to 4 selections, not more.
- If a complete sentence is important, return the complete sentence.
- If two or three consecutive sentences explain one concept and splitting them would leave the meaning incomplete, return that whole block as one selection.
- Never return a selection longer than about 60 words.

Verbatim rule (absolute):
- Every "text" value MUST be copied character-for-character from the supplied content.
- Never invent, paraphrase, summarise, translate, correct, re-order or re-punctuate the source text.
- Do not include the "[page N]" markers from the input in your output.
- If you are not certain a span appears verbatim in the input, omit it.

Respond with JSON only, no prose and no code fences, in exactly this shape:
{"highlights":[{"text":"<exact span from the content>","importance":"high|medium|low","reason":"<short label, e.g. Key definition>"}]}

Return {"highlights":[]} if the content genuinely holds nothing exam-relevant.`;

/** Upper bound on characters handed to the model in a single request. */
export const CHUNK_CHAR_BUDGET = 12_000;
/** How many highlights a chunk may request per page it covers. */
const HIGHLIGHTS_PER_PAGE = 3;
/** Never ask for more than this in one request, however long the chunk. */
const MAX_HIGHLIGHTS_PER_CHUNK = 24;

export interface Chunk {
  /** Zero-based page indices covered by this chunk. */
  pageIndices: number[];
  content: string;
  maxHighlights: number;
}

/**
 * Split a document into page-aligned chunks. Page-aligned matters: a chunk
 * that ends mid-page invites the model to quote across the cut, and such a
 * quote exists in neither chunk.
 */
export function buildChunks(pages: readonly PageText[]): Chunk[] {
  const chunks: Chunk[] = [];
  let pageIndices: number[] = [];
  let parts: string[] = [];
  let size = 0;

  const flush = () => {
    if (parts.length === 0) return;
    chunks.push({
      pageIndices,
      content: parts.join('\n\n'),
      maxHighlights: Math.min(
        MAX_HIGHLIGHTS_PER_CHUNK,
        Math.max(2, pageIndices.length * HIGHLIGHTS_PER_PAGE),
      ),
    });
    pageIndices = [];
    parts = [];
    size = 0;
  };

  for (const page of pages) {
    const body = page.raw.trim();
    if (body.length === 0) continue;
    const block = `[page ${page.pageIndex + 1}]\n${body}`;
    if (size > 0 && size + block.length > CHUNK_CHAR_BUDGET) flush();
    pageIndices.push(page.pageIndex);
    parts.push(block);
    size += block.length;
  }
  flush();
  return chunks;
}

/** The user-turn payload for one chunk. */
export function buildUserMessage(request: AiRequest): string {
  return [
    `Course: ${request.courseCode}`,
    `Handout: ${request.handoutName}`,
    `Return at most ${request.maxHighlights} highlights for this content.`,
    '',
    'HANDOUT CONTENT:',
    request.content,
  ].join('\n');
}
