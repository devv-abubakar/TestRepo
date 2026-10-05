/**
 * Locating AI-returned quotes inside the extracted page text.
 *
 * The model is instructed to return verbatim spans, so an exact substring
 * search on the folded text handles the common case. Everything else here
 * exists to absorb PDF extraction artefacts without ever drifting onto text
 * the model did not actually choose: every candidate is scored, and anything
 * under the confidence floor is reported instead of drawn.
 */
import type {
  AiHighlight,
  DocumentText,
  HighlightSettings,
  Importance,
  MatchFailure,
  MatchedHighlight,
  PageText,
} from '../../types';
import { normalizeQuote, similarity, splitSentences, tokenize } from '../../utils/text';
import { rangeToRects } from './geometry';

/** Shorter quotes are ambiguous enough that a match cannot be trusted. */
const MIN_QUOTE_CHARS = 14;
/** A sentence pulled out of a longer quote may be a little shorter. */
const MIN_SENTENCE_CHARS = 10;
/**
 * Absolute allowance so the ceiling cannot starve a sparse page. A title
 * slide or a page holding one definition has few characters, and a third of
 * almost nothing would reject the one span that page actually needs.
 */
const MIN_COVERAGE_CHARS = 240;
/** Two spans resolving to nearly the same range are treated as one. */
const DUPLICATE_OVERLAP = 0.7;
/**
 * How far the confidence floor may be relaxed for a second attempt, and how
 * much of the quote's wording the relaxed match must still account for.
 *
 * Lowering the floor alone would start highlighting the wrong sentence. Pairing
 * it with a token check does not: a match that contains almost every word of
 * the quote is the right passage even when PDF extraction mangled the spacing
 * or dropped a character.
 */
const RELAXED_FLOOR_DROP = 0.1;
const RELAXED_FLOOR_MIN = 0.74;
const RELAXED_TOKEN_COVERAGE = 0.9;

const IMPORTANCE_RANK: Record<Importance, number> = { low: 0, medium: 1, high: 2 };

interface Span {
  start: number;
  end: number;
}

interface PageMatch extends Span {
  pageIndex: number;
  confidence: number;
}

/** Grow a range outwards so it never starts or ends mid-word. */
function snapToWords(haystack: string, span: Span): Span {
  let { start, end } = span;
  while (start > 0 && /[\p{L}\p{N}]/u.test(haystack[start - 1] as string) && /[\p{L}\p{N}]/u.test(haystack[start] as string)) {
    start -= 1;
  }
  while (
    end < haystack.length &&
    /[\p{L}\p{N}]/u.test(haystack[end] as string) &&
    /[\p{L}\p{N}]/u.test(haystack[end - 1] as string)
  ) {
    end += 1;
  }
  return { start, end };
}

/** Distinct anchor tokens, longest first — rare words localize a quote fast. */
function anchorsOf(needle: string): string[] {
  const seen = new Set<string>();
  const tokens = tokenize(needle)
    .filter((t) => t.length >= 4)
    .sort((a, b) => b.length - a.length);
  const out: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length === 4) break;
  }
  return out;
}

function occurrences(haystack: string, token: string, limit: number): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(token, from);
    if (at < 0 || out.length >= limit) break;
    out.push(at);
    from = at + token.length;
  }
  return out;
}

/**
 * Best approximate location of `needle` in `haystack`, or null when nothing
 * clears `floor`. Candidate starts come from anchor tokens, then a short
 * local refinement walks the window edges to the best score.
 */
export function findFuzzy(haystack: string, needle: string, floor: number): (Span & { confidence: number }) | null {
  if (needle.length === 0 || haystack.length === 0) return null;

  const candidates = new Set<number>();
  for (const anchor of anchorsOf(needle)) {
    const offset = needle.indexOf(anchor);
    for (const at of occurrences(haystack, anchor, 24)) {
      candidates.add(Math.max(0, at - offset));
    }
  }
  if (candidates.size === 0) return null;

  let best: (Span & { confidence: number }) | null = null;
  const lengths = [
    Math.round(needle.length * 0.88),
    needle.length,
    Math.round(needle.length * 1.14),
  ];

  const score = (start: number, length: number) => {
    if (start < 0 || length <= 0 || start >= haystack.length) return;
    const end = Math.min(haystack.length, start + length);
    const confidence = similarity(haystack.slice(start, end), needle, floor);
    if (confidence >= floor && (best === null || confidence > best.confidence)) {
      best = { start, end, confidence };
    }
  };

  for (const start of candidates) {
    for (const length of lengths) score(start, length);
  }
  if (best === null) return null;

  // Refine around the winner: small shifts recover a dropped leading word.
  const anchorBest = best as Span & { confidence: number };
  for (let shift = -10; shift <= 10; shift += 2) {
    for (let stretch = -12; stretch <= 12; stretch += 4) {
      score(anchorBest.start + shift, anchorBest.end - anchorBest.start + stretch);
    }
  }
  return best;
}

/**
 * Exact first, fuzzy second, and finally a relaxed attempt that has to prove
 * itself on word coverage. Each step is strictly more permissive, so the
 * cheapest and safest answer always wins.
 */
function locate(doc: DocumentText, needle: string, floor: number): PageMatch | null {
  for (const page of doc.pages) {
    const at = page.normalized.indexOf(needle);
    if (at >= 0) {
      return { pageIndex: page.pageIndex, start: at, end: at + needle.length, confidence: 1 };
    }
  }

  const search = (threshold: number): PageMatch | null => {
    let best: PageMatch | null = null;
    for (const page of doc.pages) {
      const hit = findFuzzy(page.normalized, needle, threshold);
      if (hit && (best === null || hit.confidence > best.confidence)) {
        best = { pageIndex: page.pageIndex, start: hit.start, end: hit.end, confidence: hit.confidence };
      }
    }
    return best;
  };

  const strict = search(floor);
  if (strict) return strict;

  const relaxedFloor = Math.max(RELAXED_FLOOR_MIN, floor - RELAXED_FLOOR_DROP);
  if (relaxedFloor >= floor) return null;
  const relaxed = search(relaxedFloor);
  if (!relaxed) return null;

  const page = doc.pages.find((entry) => entry.pageIndex === relaxed.pageIndex);
  if (!page) return null;
  const matched = page.normalized.slice(relaxed.start, relaxed.end);
  return tokenCoverage(needle, matched) >= RELAXED_TOKEN_COVERAGE ? relaxed : null;
}

/** Share of the needle's meaningful tokens that appear in the match. */
function tokenCoverage(needle: string, matched: string): number {
  const wanted = tokenize(needle).filter((token) => token.length >= 3);
  if (wanted.length === 0) return 0;
  const have = new Set(tokenize(matched));
  let hits = 0;
  for (const token of wanted) {
    if (have.has(token)) hits += 1;
  }
  return hits / wanted.length;
}

function overlapRatio(a: Span, b: Span): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  if (end <= start) return 0;
  return (end - start) / Math.min(a.end - a.start, b.end - b.start);
}

export interface MatchReport {
  matched: MatchedHighlight[];
  failures: MatchFailure[];
  /** AI spans that produced at least one drawable rectangle. */
  acceptedSpans: number;
}

interface PageBudget {
  claimed: Span[];
  chars: number;
  count: number;
}

/**
 * Resolve every AI highlight to page rectangles, enforcing the confidence
 * floor, the per-page caps and the page coverage ceiling that keep the
 * output from turning into a wall of yellow.
 */
export function matchHighlights(
  doc: DocumentText,
  highlights: readonly AiHighlight[],
  settings: HighlightSettings,
): MatchReport {
  const matched: MatchedHighlight[] = [];
  const failures: MatchFailure[] = [];
  const budgets = new Map<number, PageBudget>();
  const pageByIndex = new Map<number, PageText>();
  for (const page of doc.pages) pageByIndex.set(page.pageIndex, page);

  const floor = Math.min(Math.max(settings.minConfidence, 0.6), 0.99);
  const minRank = IMPORTANCE_RANK[settings.minImportance];

  // Most important first, so the per-page budget is spent on the best spans.
  const ordered = [...highlights]
    .map((highlight, index) => ({ highlight, index }))
    .sort((a, b) => {
      const rank = IMPORTANCE_RANK[b.highlight.importance] - IMPORTANCE_RANK[a.highlight.importance];
      return rank !== 0 ? rank : a.index - b.index;
    });

  let groupId = 0;

  const budgetFor = (pageIndex: number): PageBudget => {
    const existing = budgets.get(pageIndex);
    if (existing) return existing;
    const fresh: PageBudget = { claimed: [], chars: 0, count: 0 };
    budgets.set(pageIndex, fresh);
    return fresh;
  };

  /** Try to claim one located span; returns the drawable match or a reason. */
  const claim = (
    hit: PageMatch,
    source: AiHighlight,
    group: number,
  ): MatchedHighlight | string => {
    const page = pageByIndex.get(hit.pageIndex);
    if (!page) return 'page missing';

    const span = snapToWords(page.normalized, hit);
    const budget = budgetFor(hit.pageIndex);

    for (const claimed of budget.claimed) {
      if (overlapRatio(span, claimed) >= DUPLICATE_OVERLAP) return 'duplicate of an earlier highlight';
    }
    if (settings.maxPerPage > 0 && budget.count >= settings.maxPerPage) {
      return `per-page highlight cap (${settings.maxPerPage}) reached`;
    }
    const length = span.end - span.start;
    const ceiling = Math.min(Math.max(settings.pageCoverageCeiling, 0.1), 0.95);
    const allowance = Math.max(page.normalized.length * ceiling, MIN_COVERAGE_CHARS);
    // The first span on a page always gets through; the ceiling governs the rest.
    if (budget.count > 0 && budget.chars + length > allowance) {
      return 'page coverage ceiling reached — kept the output from over-highlighting';
    }

    const rects = rangeToRects(page, span.start, span.end);
    if (rects.length === 0) return 'no drawable coordinates';

    budget.claimed.push(span);
    budget.chars += length;
    budget.count += 1;

    return {
      groupId: group,
      pageIndex: hit.pageIndex,
      rects,
      confidence: hit.confidence,
      importance: source.importance,
      reason: source.reason,
      matchedText: page.normalized.slice(span.start, span.end),
    };
  };

  for (const { highlight } of ordered) {
    if (IMPORTANCE_RANK[highlight.importance] < minRank) continue;

    const needle = normalizeQuote(highlight.text);
    if (needle.length < MIN_QUOTE_CHARS) {
      failures.push({ text: highlight.text, reason: 'quote too short to match safely', bestConfidence: 0 });
      continue;
    }

    const group = groupId;
    const hit = locate(doc, needle, floor);
    if (hit) {
      const result = claim(hit, highlight, group);
      if (typeof result !== 'string') {
        matched.push(result);
        groupId += 1;
        continue;
      }
      // A rejected whole-quote match still gets the sentence fallback below
      // only when the reason was geometric, not a budget decision.
      if (result !== 'no drawable coordinates' && result !== 'page missing') {
        failures.push({ text: highlight.text, reason: result, bestConfidence: hit.confidence });
        continue;
      }
    }

    // A quote can straddle a page or column break, where no single page holds
    // it. Matching sentence by sentence keeps every span verbatim.
    const sentences = splitSentences(needle).filter((s) => s.length >= MIN_SENTENCE_CHARS);
    if (sentences.length < 2) {
      failures.push({
        text: highlight.text,
        reason: hit ? 'match below confidence floor' : 'text not found in the handout',
        bestConfidence: hit?.confidence ?? 0,
      });
      continue;
    }

    const parts: MatchedHighlight[] = [];
    let bestPart = 0;
    for (const sentence of sentences) {
      const sentenceHit = locate(doc, sentence, floor);
      if (!sentenceHit) continue;
      bestPart = Math.max(bestPart, sentenceHit.confidence);
      const result = claim(sentenceHit, highlight, group);
      if (typeof result !== 'string') parts.push(result);
    }

    if (parts.length === 0) {
      failures.push({
        text: highlight.text,
        reason: 'text not found in the handout',
        bestConfidence: Math.max(bestPart, hit?.confidence ?? 0),
      });
      continue;
    }
    matched.push(...parts);
    groupId += 1;
  }

  return { matched, failures, acceptedSpans: groupId };
}
