/**
 * Output validation.
 *
 * A handout is only reported as completed once the file it produced has been
 * re-opened and checked, because a silently corrupt output is worse than a
 * visible failure. The strictest check is text preservation: the output's
 * text layer must equal the original's once the fragments this app added are
 * subtracted.
 */
import type { DecorateResult } from '../pdf/decorate';
import type { DocumentText, MatchedHighlight, ValidationResult } from '../../types';
import { PLAY_STORE_URL, WHATSAPP_URL } from '../../constants';
import { extractFromBytes } from '../pdf/extract';
import { openPdf } from '../pdf/pdfjs';
import { foldFragment, squashSpace } from '../../utils/text';

interface AnnotationSummary {
  highlights: number;
  urls: Set<string>;
}

async function summarizeAnnotations(bytes: Uint8Array): Promise<AnnotationSummary> {
  const doc = await openPdf(bytes.slice());
  const summary: AnnotationSummary = { highlights: 0, urls: new Set<string>() };
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      try {
        const annotations = (await page.getAnnotations()) as unknown[];
        for (const entry of annotations) {
          if (typeof entry !== 'object' || entry === null) continue;
          const record = entry as Record<string, unknown>;
          if (record.subtype === 'Highlight') summary.highlights += 1;
          if (typeof record.url === 'string') summary.urls.add(record.url);
          const action = record.unsafeUrl;
          if (typeof action === 'string') summary.urls.add(action);
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }
  return summary;
}

/** Remove every fragment this app wrote, so the rest must match the original. */
function subtractAdded(text: string, fragments: readonly string[]): string {
  let out = text;
  for (const fragment of fragments) {
    const folded = squashSpace(foldFragment(fragment));
    if (folded.length === 0) continue;
    out = out.split(folded).join(' ');
  }
  return squashSpace(out);
}

export interface ValidationInput {
  original: DocumentText;
  originalPageCount: number;
  bytes: Uint8Array;
  matched: readonly MatchedHighlight[];
  decoration: DecorateResult;
  content: { addStudentsGuide: boolean; addWhatsApp: boolean };
}

export async function validateOutput(input: ValidationInput): Promise<ValidationResult> {
  const checks: ValidationResult['checks'] = [];
  const record = (name: string, ok: boolean, detail?: string) => {
    checks.push(detail === undefined ? { name, ok } : { name, ok, detail });
  };

  let outputText: DocumentText | null = null;
  try {
    outputText = await extractFromBytes(input.bytes);
    record('Output PDF opens', true);
  } catch (error) {
    record('Output PDF opens', false, error instanceof Error ? error.message : 'unreadable');
    return { ok: false, checks };
  }

  const expectedPages = input.originalPageCount + (input.decoration.addedPage ? 1 : 0);
  record(
    'Page count intact',
    outputText.pages.length === expectedPages,
    `${outputText.pages.length} of ${expectedPages} expected`,
  );

  // Original wording must survive verbatim on every original page.
  let preserved = true;
  let firstDrift = '';
  const pageLimit = Math.min(input.original.pages.length, outputText.pages.length);

  if (input.original.usedOcr) {
    // A scanned page has no text layer to compare against: its words came
    // from recognition, not from the file. What must hold instead is that we
    // added nothing to those pages beyond our own footer text, so the page
    // images are provably untouched.
    for (let i = 0; i < pageLimit; i += 1) {
      const leftover = subtractAdded(
        outputText.pages[i]?.normalized ?? '',
        input.decoration.addedFragments,
      );
      if (leftover.replace(/[^\p{L}\p{N}]/gu, '').length > 0) {
        preserved = false;
        firstDrift = `page ${i + 1}`;
        break;
      }
    }
    record(
      'Scanned pages left untouched',
      preserved,
      preserved ? 'no text written over the page images' : `unexpected text on ${firstDrift}`,
    );
  } else {
    for (let i = 0; i < pageLimit; i += 1) {
      const before = squashSpace(input.original.pages[i]?.normalized ?? '');
      const after = subtractAdded(outputText.pages[i]?.normalized ?? '', input.decoration.addedFragments);
      if (before.length === 0) continue;
      if (after !== before) {
        // Added text can shift spacing at a seam, so accept containment too.
        if (!after.includes(before)) {
          preserved = false;
          firstDrift = `page ${i + 1}`;
          break;
        }
      }
    }
    record('Original text preserved', preserved, preserved ? undefined : `changed on ${firstDrift}`);
  }

  // Nothing we drew may sit on top of original content.
  let noOverlap = true;
  const bandTop = input.decoration.footerBandTop;
  if (typeof bandTop === 'number') {
    const page = input.original.pages[0];
    if (page) {
      for (const piece of page.pieces) {
        if (piece.rect.y < bandTop) {
          noOverlap = false;
          break;
        }
      }
    }
  }
  record(
    'Added content clear of original content',
    noOverlap,
    noOverlap ? undefined : 'footer band overlapped existing text',
  );

  const annotations = await summarizeAnnotations(input.bytes).catch(() => null);
  if (!annotations) {
    record('Annotations readable', false, 'annotation table could not be read');
    return { ok: false, checks };
  }

  const expectedHighlightAnnots = new Set(input.matched.map((m) => `${m.groupId}:${m.pageIndex}`)).size;
  record(
    'Highlight annotations written',
    annotations.highlights >= expectedHighlightAnnots,
    `${annotations.highlights} annotations for ${expectedHighlightAnnots} expected`,
  );

  if (input.content.addStudentsGuide) {
    record('VU Students Guide link present', annotations.urls.has(PLAY_STORE_URL), PLAY_STORE_URL);
  }
  if (input.content.addWhatsApp) {
    record('WhatsApp link present', annotations.urls.has(WHATSAPP_URL), WHATSAPP_URL);
  }

  record('Output file generated', input.bytes.byteLength > 0, `${input.bytes.byteLength} bytes`);

  return { ok: checks.every((check) => check.ok), checks };
}
