/**
 * The analysis prompts.
 *
 * Two things matter more than anything else: the model must return verbatim
 * spans (anything invented is rejected later and wastes a request), and its
 * selectivity has to match what the user asked for. A single selective pass
 * reads cleanly but demonstrably leaves definitions behind, so the higher
 * coverage modes add sweep passes whose only job is to find what the first
 * pass missed.
 */
import type { AiRequest, CoverageMode, PageText } from '../../types';

/** What one request to the model is trying to achieve. */
export type PassKind = 'primary' | 'gap' | 'structured';

export interface PassPlan {
  kind: PassKind;
  /** Multiplier applied to the chunk's highlight ceiling for this pass. */
  share: number;
}

/**
 * Which passes each coverage mode runs. More passes cost more requests, which
 * is what the API key pool exists to absorb.
 */
export function passPlan(mode: CoverageMode): PassPlan[] {
  if (mode === 'selective') return [{ kind: 'primary', share: 1 }];
  if (mode === 'balanced') {
    return [
      { kind: 'primary', share: 1 },
      { kind: 'gap', share: 0.6 },
    ];
  }
  return [
    { kind: 'primary', share: 1 },
    { kind: 'gap', share: 0.8 },
    { kind: 'structured', share: 0.8 },
  ];
}

const VERBATIM_RULES = `Verbatim rule (absolute):
- Every "text" value MUST be copied character-for-character from the supplied content.
- Never invent, paraphrase, summarise, translate, correct, re-order or re-punctuate the source text.
- Do not include the "[page N]" markers from the input in your output.
- A span that does not appear verbatim in the input is discarded by the application, so copying exactly is the only way your work counts.

Always exclude:
- page headers, footers, page numbers, lecture numbers and course logistics
- motivational or introductory filler that carries no examinable content
- sentences that merely repeat something you have already selected

Length rule:
- If a complete sentence is important, return the complete sentence.
- If two or three consecutive sentences explain one idea and splitting them would leave it incomplete, return that block as one selection.
- Never return a selection longer than about 70 words.`;

const RESPONSE_SHAPE = `Respond with JSON only, no prose and no code fences, in exactly this shape:
{"highlights":[{"text":"<exact span from the content>","importance":"high|medium|low","reason":"<short label, e.g. Key definition>"}]}

Return {"highlights":[]} if the content genuinely holds nothing left to select.`;

const WANTED = `What to select:
- definitions and key terminology, including the exact sentence that defines each term
- core concepts and principles
- rules, laws, theorems and formulas
- classifications, categories, types, components and their members
- processes, procedures and the steps within them
- comparisons, distinctions and contrasts
- cause-and-effect relationships
- characteristics, features, functions, advantages and disadvantages
- important facts, figures, dates and names that can carry marks
- academically important examples`;

const MODE_POSTURE: Record<CoverageMode, string> = {
  selective: `Selectivity (most important for this run):
- Maximum useful exam coverage with the MINIMUM amount of highlighting.
- A typical page should yield roughly 2 to 4 selections.
- Select only the single most important statement of each idea.`,

  balanced: `Selectivity (most important for this run):
- Cover everything a student must revise, without marking narrative text.
- A typical page should yield roughly 4 to 8 selections.
- When you are unsure whether a definition or rule is examinable, INCLUDE it. A missing definition costs a student marks; one extra selection costs nothing.`,

  complete: `Completeness (most important for this run):
- Your goal is completeness, not brevity. Assume the student will revise ONLY the passages you select and must still be able to answer any exam question from this content.
- Mark EVERY definition, EVERY rule, law and formula, EVERY classification and its members, EVERY step of each process, EVERY distinction, and every fact, figure or name that could carry marks.
- Do not skip something because it seems basic, or because a related point is already selected. Each distinct piece of examinable information needs its own selection.
- A typical page will yield 6 to 12 selections, and a dense page more.
- When in doubt, INCLUDE it. The only things you leave out are connective narrative, filler, logistics and literal repetition.`,
};

export function systemPrompt(mode: CoverageMode): string {
  return [
    'You are an examination analyst for Virtual University (VU) handouts.',
    '',
    'You analyse handout content and identify the passages a student should revise for examinations, quizzes, MCQs, short questions and long questions.',
    '',
    WANTED,
    '',
    MODE_POSTURE[mode],
    '',
    VERBATIM_RULES,
    '',
    RESPONSE_SHAPE,
  ].join('\n');
}

/**
 * The gap sweep. It is handed what has already been selected and asked only
 * for what is missing, which is what turns one model pass into usable recall.
 */
export function sweepSystemPrompt(mode: CoverageMode): string {
  const intensity =
    mode === 'complete'
      ? 'Assume the first pass missed several items. Find all of them. Be exhaustive.'
      : 'Assume the first pass missed a few items, usually definitions or formulas. Find them.';
  return [
    'You are an examination analyst for Virtual University (VU) handouts, performing a SECOND review.',
    '',
    'A first pass has already selected some passages from the content below. Your job is to find the examinable material it MISSED.',
    '',
    intensity,
    '',
    WANTED,
    '',
    'Rules for this pass:',
    '- Do NOT return anything already covered by the list of passages already selected.',
    '- Pay particular attention to definitions, formulas, classifications, lists of types or steps, and numeric facts, which first passes commonly overlook.',
    '- Return an empty list only if you are confident nothing examinable remains unselected.',
    '',
    VERBATIM_RULES,
    '',
    RESPONSE_SHAPE,
  ].join('\n');
}

/**
 * A structured sweep that asks for specific categories by name. Asking "find
 * every defined term" recovers material that an open-ended request does not.
 */
export function structuredSystemPrompt(): string {
  return [
    'You are an examination analyst for Virtual University (VU) handouts, performing a FINAL structured review.',
    '',
    'Work through the content below and return, as exact quotations:',
    '1. The sentence that defines each term that is defined anywhere in the content.',
    '2. The sentence stating each formula, equation, rule, law or principle.',
    '3. The sentence introducing each classification, list of types, components, steps, characteristics, functions, advantages or disadvantages — and the members of that list if they are written as sentences or labelled items.',
    '4. Each statement of a numeric fact, date, quantity, limit or named person that could be asked about.',
    '',
    'Be systematic: go through the content in order and do not stop early. Items already selected by earlier passes are listed below; do not repeat them.',
    '',
    'Mark items from categories 1, 2 and 3 as "high" importance.',
    '',
    VERBATIM_RULES,
    '',
    RESPONSE_SHAPE,
  ].join('\n');
}

/** Upper bound on characters handed to the model in a single request. */
export const CHUNK_CHAR_BUDGET = 12_000;
/** Never ask for more than this in one request, however long the chunk. */
const MAX_HIGHLIGHTS_PER_CHUNK = 60;

/** How many highlights a chunk may request per page it covers, by mode. */
const HIGHLIGHTS_PER_PAGE: Record<CoverageMode, number> = {
  selective: 3,
  balanced: 7,
  complete: 12,
};

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
export function buildChunks(pages: readonly PageText[], mode: CoverageMode = 'balanced'): Chunk[] {
  const chunks: Chunk[] = [];
  let pageIndices: number[] = [];
  let parts: string[] = [];
  let size = 0;
  const perPage = HIGHLIGHTS_PER_PAGE[mode];

  const flush = () => {
    if (parts.length === 0) return;
    chunks.push({
      pageIndices,
      content: parts.join('\n\n'),
      maxHighlights: Math.min(MAX_HIGHLIGHTS_PER_CHUNK, Math.max(3, pageIndices.length * perPage)),
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

/** Keep the exclusion list short enough not to crowd out the content. */
const EXCLUDE_PREVIEW_CHARS = 90;
const MAX_EXCLUDED = 60;

/** The user-turn payload for one pass over one chunk. */
export function buildUserMessage(request: AiRequest, alreadySelected: readonly string[] = []): string {
  const lines = [
    `Course: ${request.courseCode}`,
    `Handout: ${request.handoutName}`,
    `Return at most ${request.maxHighlights} highlights for this content.`,
  ];

  if (alreadySelected.length > 0) {
    lines.push(
      '',
      'ALREADY SELECTED (do not return these again):',
      ...alreadySelected
        .slice(0, MAX_EXCLUDED)
        .map((text, index) => `${index + 1}. ${text.slice(0, EXCLUDE_PREVIEW_CHARS)}`),
    );
    if (alreadySelected.length > MAX_EXCLUDED) {
      lines.push(`...and ${alreadySelected.length - MAX_EXCLUDED} more.`);
    }
  }

  lines.push('', 'HANDOUT CONTENT:', request.content);
  return lines.join('\n');
}
