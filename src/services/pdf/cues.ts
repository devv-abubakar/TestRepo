/**
 * Rule-based safety net.
 *
 * A language model asked to be selective will leave definitions behind, and
 * no amount of prompting makes that impossible. These patterns are the things
 * that are examinable almost by construction — "X is defined as …", a
 * formula, "there are four types of …" — and the sentences carrying them are
 * added as candidates regardless of what the model returned.
 *
 * Nothing here invents text: a candidate is a sentence taken verbatim out of
 * the page's own extracted text, so it goes through exactly the same matching
 * and verification as a model-supplied span.
 */
import type { AiHighlight, DocumentText, Importance, PageText } from '../../types';
import { splitSentences, tokenize } from '../../utils/text';

interface Cue {
  label: string;
  importance: Importance;
  pattern: RegExp;
}

/** Patterns run against folded (lowercased, single-spaced) sentences. */
const CUES: readonly Cue[] = [
  // A term being given a meaning: the single highest-value pattern here.
  {
    label: 'Definition',
    importance: 'high',
    pattern:
      /\b(is|are|was|were|can be|may be)\s+(defined|described|termed)\s+as\b|\bis\s+called\b|\bare\s+called\b|\bis\s+known\s+as\b|\bare\s+known\s+as\b|\brefers\s+to\b|\brefer\s+to\s+the\b|\bstands\s+for\b|\bis\s+the\s+(process|ability|study|measure|degree|state|amount|rate|term)\s+of\b|\bby\s+definition\b|\bdefinition\s+of\b/,
  },
  {
    label: 'Formula or rule',
    importance: 'high',
    pattern:
      /\bformula\b|\bequation\b|\bis\s+given\s+by\b|\bis\s+calculated\s+as\b|\bis\s+computed\s+as\b|\bequals\b|\btheorem\b|\blaw\s+of\b|\bprinciple\s+of\b|\brule\s+states\b|\bstates\s+that\b|[a-z0-9)\]]\s*=\s*[a-z0-9(]/,
  },
  {
    label: 'Classification',
    importance: 'high',
    pattern:
      /\btypes\s+of\b|\bkinds\s+of\b|\bforms\s+of\b|\bcategories\b|\bclassified\s+(in)?to\b|\bclassification\b|\bdivided\s+into\b|\bconsists\s+of\b|\bcomprises\b|\bcomposed\s+of\b|\bcomponents\s+of\b|\belements\s+of\b/,
  },
  {
    label: 'Characteristics',
    importance: 'medium',
    pattern:
      /\bcharacteristics\s+of\b|\bfeatures\s+of\b|\bfunctions\s+of\b|\bproperties\s+of\b|\badvantages\b|\bdisadvantages\b|\bbenefits\s+of\b|\blimitations\s+of\b|\bobjectives\s+of\b|\bimportance\s+of\b|\bpurpose\s+of\b/,
  },
  {
    label: 'Process or steps',
    importance: 'medium',
    pattern:
      /\bsteps\s+(are|in|of|involved)\b|\bstages\s+of\b|\bphases\s+of\b|\bprocedure\s+(is|for)\b|\bthe\s+following\s+(are|steps|stages|types|points)\b|\bfirst\s+step\b|\bprocess\s+of\b/,
  },
  {
    label: 'Enumeration',
    importance: 'medium',
    pattern:
      /\bthere\s+are\s+(two|three|four|five|six|seven|eight|nine|ten|\d+)\b|\b(two|three|four|five|six|seven|eight|nine|ten)\s+(main|major|basic|important|types|kinds|categories|methods|factors|principles|stages|steps)\b/,
  },
  {
    label: 'Distinction',
    importance: 'medium',
    pattern:
      /\bdifference\s+between\b|\bdiffers\s+from\b|\bas\s+opposed\s+to\b|\bin\s+contrast\s+to\b|\bwhereas\b|\bunlike\b/,
  },
];

/** Boilerplate that matches a cue by accident and is never exam material. */
const NOISE =
  /virtual\s+university|vubookshoppk|whatsapp|copyright|all\s+rights\s+reserved|^lecture\s+no|^page\s+\d|handout|^\d+$|table\s+of\s+contents|^topic\s+\d/;

const MIN_SENTENCE_CHARS = 28;
const MAX_SENTENCE_CHARS = 420;
const MIN_TOKENS = 6;
/** Per-page ceiling so a list-heavy page cannot swamp the budget. */
const MAX_PER_PAGE = 14;

function classify(sentence: string): Cue | null {
  for (const cue of CUES) {
    if (cue.pattern.test(sentence)) return cue;
  }
  return null;
}

/** Candidates from one page, in reading order. */
function sweepPage(page: PageText): AiHighlight[] {
  const found: AiHighlight[] = [];
  for (const raw of splitSentences(page.normalized)) {
    if (found.length >= MAX_PER_PAGE) break;
    const sentence = raw.trim();
    if (sentence.length < MIN_SENTENCE_CHARS || sentence.length > MAX_SENTENCE_CHARS) continue;
    if (tokenize(sentence).length < MIN_TOKENS) continue;
    if (NOISE.test(sentence)) continue;

    const cue = classify(sentence);
    if (!cue) continue;
    found.push({ text: sentence, importance: cue.importance, reason: `${cue.label} (rule sweep)` });
  }
  return found;
}

/**
 * Sentences from the whole document that carry an examinable cue. The caller
 * merges these with the model's spans; duplicates are collapsed downstream.
 */
export function sweepForCues(text: DocumentText): AiHighlight[] {
  const out: AiHighlight[] = [];
  for (const page of text.pages) out.push(...sweepPage(page));
  return out;
}
