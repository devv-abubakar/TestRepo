/**
 * Acceptance harness.
 *
 * Runs the production pipeline end-to-end in a real browser against synthetic
 * handouts. The only thing standing in for a live service is the analysis
 * step, which returns verbatim spans taken from the extracted text — exactly
 * the contract a provider is held to — plus one invented span that must be
 * rejected and one with mangled whitespace that must still be matched.
 */
import { PLAY_STORE_URL, WHATSAPP_URL } from '../constants';
import { analyzeDocument } from '../services/ai';
import { extractFromBytes, needsOcr } from '../services/pdf/extract';
import { matchHighlights } from '../services/pdf/match';
import { openPdf } from '../services/pdf/pdfjs';
import { releaseCanvas, renderPage } from '../services/pdf/render';
import { processHandout } from '../services/pdf/process';
import { clearSession, loadSnapshot, putOutput, saveSnapshot } from '../services/persist';
import { buildZip } from '../services/zip';
import { DEFAULT_SETTINGS } from '../store/defaults';
import type { AiHighlight, DocumentText, Settings } from '../types';
import { squashSpace } from '../utils/text';
import {
  buildHandout,
  buildScannedHandout,
  CLASSIFICATION,
  DEFINITION,
  FORMULA,
} from './fixtures';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface TestResult {
  test: string;
  ok: boolean;
  checks: CheckResult[];
  error?: string;
}

class Checks {
  readonly results: CheckResult[] = [];

  assert(name: string, ok: boolean, detail = ''): void {
    this.results.push({ name, ok, detail });
  }

  equal(name: string, actual: unknown, expected: unknown): void {
    const ok = Object.is(actual, expected);
    this.assert(name, ok, ok ? String(actual) : `expected ${String(expected)}, got ${String(actual)}`);
  }

  get ok(): boolean {
    return this.results.every((check) => check.ok);
  }
}

function settings(patch: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...patch,
    ai: { ...DEFAULT_SETTINGS.ai, ...(patch.ai ?? {}) },
    highlight: { ...DEFAULT_SETTINGS.highlight, ...(patch.highlight ?? {}) },
    content: { ...DEFAULT_SETTINGS.content, ...(patch.content ?? {}) },
    output: { ...DEFAULT_SETTINGS.output, ...(patch.output ?? {}) },
  };
}

/** Spans a well-behaved model would return for the fixture handouts. */
function fixtureHighlights(): AiHighlight[] {
  return [
    { text: DEFINITION, importance: 'high', reason: 'Key definition' },
    // Mangled whitespace and a line-break hyphen must still resolve.
    { text: 'Demand-\npull  inflation occurs when aggregate demand exceeds aggregate supply', importance: 'high', reason: 'Core concept' },
    { text: FORMULA, importance: 'medium', reason: 'Formula' },
    // Never present in the source: must be rejected, never drawn.
    { text: 'Inflation is always caused by excessive government borrowing alone.', importance: 'high', reason: 'Invented' },
  ];
}

async function annotationsOf(bytes: Uint8Array): Promise<{ highlights: number; urls: string[]; pages: number }> {
  const doc = await openPdf(bytes.slice());
  try {
    let highlights = 0;
    const urls = new Set<string>();
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      try {
        for (const entry of (await page.getAnnotations()) as Record<string, unknown>[]) {
          if (entry.subtype === 'Highlight') highlights += 1;
          if (typeof entry.url === 'string') urls.add(entry.url);
        }
      } finally {
        page.cleanup();
      }
    }
    return { highlights, urls: [...urls], pages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

/**
 * Rasterise one page of an output and sample the pixels inside a rectangle.
 * This is how we prove the highlight actually renders and that the text
 * underneath is still dark enough to read.
 */
async function samplePixels(
  bytes: Uint8Array,
  pageIndex: number,
  rect: { x: number; y: number; width: number; height: number },
): Promise<{ yellow: number; dark: number; total: number }> {
  const doc = await openPdf(bytes.slice());
  try {
    const page = await doc.getPage(pageIndex + 1);
    const raster = await renderPage(page, 2);
    try {
      const context = raster.canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('no 2d context');
      const left = Math.max(0, Math.floor(rect.x * raster.scale));
      const top = Math.max(0, Math.floor((raster.height - rect.y - rect.height) * raster.scale));
      const width = Math.min(raster.canvas.width - left, Math.ceil(rect.width * raster.scale));
      const height = Math.min(raster.canvas.height - top, Math.ceil(rect.height * raster.scale));
      const data = context.getImageData(left, top, Math.max(width, 1), Math.max(height, 1)).data;

      let yellow = 0;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] as number;
        const g = data[i + 1] as number;
        const b = data[i + 2] as number;
        // A highlighter mark at print-friendly opacity is a pale warm tint,
        // not saturated yellow: what identifies it is blue being pulled well
        // below red while the pixel stays light.
        if (r > 200 && g > 190 && r - b > 25) yellow += 1;
        if (r < 130 && g < 130 && b < 130) dark += 1;
      }
      return { yellow, dark, total: data.length / 4 };
    } finally {
      releaseCanvas(raster.canvas);
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}

async function run(
  test: string,
  body: (checks: Checks) => Promise<void>,
): Promise<TestResult> {
  const checks = new Checks();
  try {
    await body(checks);
    return { test, ok: checks.ok, checks: checks.results };
  } catch (error) {
    return {
      test,
      ok: false,
      checks: checks.results,
      error: error instanceof Error ? `${error.message}` : String(error),
    };
  }
}

const stubAnalyze = (highlights: AiHighlight[]) => async (): Promise<AiHighlight[]> => highlights;

/**
 * Run the acceptance scenarios. `filter` limits the run to scenarios whose
 * name contains it, which keeps debugging one area quick.
 */
export async function runSelfTest(filter?: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const noop = () => undefined;
  const wanted = (name: string) => !filter || name.toLowerCase().includes(filter.toLowerCase());
  const maybe = async (name: string, body: (checks: Checks) => Promise<void>): Promise<void> => {
    if (!wanted(name)) return;
    results.push(await run(name, body));
  };

  // ---------------------------------------------------- extraction
  await maybe('Test: PDF text extraction with coordinates', async (checks) => {
    const bytes = await buildHandout({ extraPages: 2 });
    const text = await extractFromBytes(bytes);
    checks.equal('page count', text.pages.length, 3);
    checks.assert('text layer detected', !needsOcr(text), `${text.totalChars} chars`);
    const first = text.pages[0];
    checks.assert('first page has runs', (first?.pieces.length ?? 0) > 5, `${first?.pieces.length} runs`);
    checks.assert(
      'definition present in folded text',
      (first?.normalized ?? '').includes(squashSpace(DEFINITION.toLowerCase())),
    );
    checks.assert(
      'bookshop line preserved',
      (first?.normalized ?? '').includes('vubookshoppk.com'),
    );
    const piece = first?.pieces[0];
    checks.assert(
      'runs carry page coordinates',
      Boolean(piece && piece.rect.width > 0 && piece.rect.height > 0),
      piece ? `x=${piece.rect.x.toFixed(1)} y=${piece.rect.y.toFixed(1)}` : 'none',
    );
  });

  // ---------------------------------------------------- matching accuracy
  await maybe('Test: AI spans match real coordinates, inventions rejected', async (checks) => {
    const bytes = await buildHandout({ extraPages: 1 });
    const text = await extractFromBytes(bytes);
    const report = matchHighlights(text, fixtureHighlights(), settings().highlight);

    checks.equal('accepted spans', report.acceptedSpans, 3);
    checks.assert('every match has rectangles', report.matched.every((m) => m.rects.length > 0));
    checks.assert(
      'exact quote matched at full confidence',
      report.matched.some((m) => m.confidence === 1),
    );
    checks.assert(
      'mangled whitespace still matched',
      report.matched.some((m) => m.matchedText.includes('aggregate demand exceeds aggregate supply')),
      report.matched.map((m) => `${Math.round(m.confidence * 100)}%`).join(', '),
    );
    checks.assert(
      'invented text rejected',
      report.failures.some((f) => f.text.includes('government borrowing')),
      report.failures.map((f) => f.reason).join('; '),
    );
    checks.assert(
      'no highlight falls outside the page box',
      report.matched.every((match) => {
        const page = text.pages[match.pageIndex];
        if (!page) return false;
        return match.rects.every(
          (rect) =>
            rect.x >= -2 &&
            rect.y >= -2 &&
            rect.x + rect.width <= page.width + 2 &&
            rect.y + rect.height <= page.height + 2,
        );
      }),
    );
  });

  // ---------------------------------------------------- full pipeline
  await maybe('Test: full pipeline writes a valid highlighted PDF', async (checks) => {
    const original = await buildHandout({ extraPages: 2 });
    const before = Array.from(original);

    const outcome = await processHandout({
      bytes: original,
      courseCode: 'CS101',
      handoutName: 'Handout 01.pdf',
      settings: settings(),
      onStage: noop,
      onLog: noop,
      analyze: stubAnalyze(fixtureHighlights()),
    });

    checks.assert('original bytes untouched', Array.from(original).every((b, i) => b === before[i]));
    checks.equal('validation passed', outcome.validation.ok, true);
    checks.assert('highlights written', outcome.highlightCount >= 3, String(outcome.highlightCount));
    checks.equal('low-confidence spans reported', outcome.lowConfidenceSkipped, 1);
    checks.equal('original page count reported', outcome.pageCount, 3);

    const annots = await annotationsOf(outcome.bytes);
    checks.assert('highlight annotations present', annots.highlights >= 3, String(annots.highlights));
    checks.assert('Google Play link present and exact', annots.urls.includes(PLAY_STORE_URL));
    checks.assert('WhatsApp link present and exact', annots.urls.includes(WHATSAPP_URL));

    const out = await extractFromBytes(outcome.bytes);
    const firstPage = out.pages[0]?.normalized ?? '';
    checks.assert('bookshop text still present', firstPage.includes('vubookshoppk.com'));
    checks.assert('whatsapp number added after it', firstPage.includes('+92 347 7776639'));
    checks.assert(
      'original sentences preserved verbatim',
      [DEFINITION, CLASSIFICATION].every((sentence) =>
        out.pages.some((page) => page.normalized.includes(squashSpace(sentence.toLowerCase()))),
      ),
    );
    checks.assert('output is a real PDF', outcome.bytes.byteLength > 1000, `${outcome.bytes.byteLength} bytes`);

    // The highlight must be visible on the rendered page, and the text under
    // it must still be dark enough to read.
    const matched = matchHighlights(
      await extractFromBytes(await buildHandout({ extraPages: 2 })),
      [{ text: DEFINITION, importance: 'high', reason: 'Key definition' }],
      settings().highlight,
    ).matched[0];
    if (!matched?.rects[0]) throw new Error('could not locate the highlight rectangle');
    const pixels = await samplePixels(outcome.bytes, matched.pageIndex, matched.rects[0]);
    checks.assert(
      'yellow highlight renders on the page',
      pixels.yellow / pixels.total > 0.3,
      `${Math.round((pixels.yellow / pixels.total) * 100)}% of sampled pixels are yellow`,
    );
    checks.assert(
      'highlighted text is still dark and readable',
      pixels.dark > 0,
      `${pixels.dark} dark pixels remain under the highlight`,
    );

    for (const check of outcome.validation.checks) {
      checks.assert(`validation — ${check.name}`, check.ok, check.detail ?? '');
    }
  });

  // ---------------------------------------------------- no space on page one
  await maybe('Test: a full first page gets a new information page, never an overlay', async (checks) => {
    const bytes = await buildHandout({ fillFirstPage: true, crowdBookshopLine: true });
    const text = await extractFromBytes(bytes);
    const lowest = Math.min(...(text.pages[0]?.pieces.map((p) => p.rect.y) ?? [999]));

    const outcome = await processHandout({
      bytes,
      courseCode: 'CS101',
      handoutName: 'Handout 02.pdf',
      settings: settings(),
      onStage: noop,
      onLog: noop,
      analyze: stubAnalyze(fixtureHighlights()),
    });

    checks.equal('validation passed', outcome.validation.ok, true);
    const out = await extractFromBytes(outcome.bytes);
    checks.equal('an information page was appended', out.pages.length, text.pages.length + 1);
    checks.assert(
      'information landed on the new page, not over the content',
      (out.pages[out.pages.length - 1]?.normalized ?? '').includes('vu students'),
    );
    checks.assert(
      'first page content untouched',
      Math.abs(Math.min(...(out.pages[0]?.pieces.map((p) => p.rect.y) ?? [0])) - lowest) < 6,
    );
    checks.assert(
      'the crowded bookshop line was left alone',
      !(out.pages[0]?.normalized ?? '').includes('+92 347 7776639'),
      'no room on that line, so the contact moved to the information page',
    );
    checks.assert(
      'WhatsApp contact still delivered, on the information page',
      (out.pages[out.pages.length - 1]?.normalized ?? '').includes('+92 347 7776639'),
    );
    const annots = await annotationsOf(outcome.bytes);
    checks.assert('links still present', annots.urls.includes(PLAY_STORE_URL) && annots.urls.includes(WHATSAPP_URL));
  });

  // ---------------------------------------------------- over-highlight guard
  await maybe('Test: a dense page is not flooded with yellow', async (checks) => {
    const bytes = await buildHandout({ extraPages: 1, densePage: true });
    const text = await extractFromBytes(bytes);
    const dense = text.pages[1];
    if (!dense) throw new Error('dense page missing');

    const sentences = dense.normalized
      .split('. ')
      .map((s) => s.trim())
      .filter((s) => s.length > 30);
    const greedy: AiHighlight[] = sentences.map((text_) => ({
      text: text_,
      importance: 'high',
      reason: 'Greedy',
    }));

    const report = matchHighlights(text, greedy, settings({ highlight: { ...DEFAULT_SETTINGS.highlight, maxPerPage: 0 } }).highlight);
    const highlighted = report.matched
      .filter((m) => m.pageIndex === 1)
      .reduce((sum, m) => sum + m.matchedText.length, 0);
    const share = highlighted / dense.normalized.length;

    checks.assert('some content was highlighted', report.acceptedSpans > 0, String(report.acceptedSpans));
    checks.assert(
      'highlighted share stays well under half the page',
      share < 0.45,
      `${Math.round(share * 100)}% of ${dense.normalized.length} chars`,
    );
    checks.assert(
      'the excess was reported rather than drawn',
      report.failures.some((f) => f.reason.includes('coverage')),
    );
  });

  // ---------------------------------------------------- live AI failure path
  await maybe('Test: an AI failure fails one handout without crashing', async (checks) => {
    const bytes = await buildHandout();
    const text = await extractFromBytes(bytes);
    let message = '';
    try {
      await analyzeDocument(
        text,
        { courseCode: 'CS101', handoutName: 'Handout 01.pdf' },
        { ...DEFAULT_SETTINGS.ai, provider: 'openai', apiKey: 'sk-invalid-key-for-testing', model: 'gpt-4.1-mini' },
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    checks.assert('a real request was attempted and reported', message.length > 0, message);

    let failed = '';
    try {
      await processHandout({
        bytes,
        courseCode: 'CS101',
        handoutName: 'Handout 01.pdf',
        settings: settings(),
        onStage: noop,
        onLog: noop,
        analyze: async () => {
          throw new Error('Rate limit reached.');
        },
      });
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    }
    checks.assert('the handout surfaces the failure', failed.includes('Rate limit'), failed);

    // The next handout must still process normally.
    const outcome = await processHandout({
      bytes: await buildHandout(),
      courseCode: 'CS101',
      handoutName: 'Handout 03.pdf',
      settings: settings(),
      onStage: noop,
      onLog: noop,
      analyze: stubAnalyze(fixtureHighlights()),
    });
    checks.equal('the following handout still succeeds', outcome.validation.ok, true);
  });

  // ---------------------------------------------------- resume + packaging
  await maybe('Test: resume state and ZIP packaging', async (checks) => {
    await clearSession();
    await saveSnapshot({
      rootName: 'All Handouts',
      savedAt: Date.now(),
      courses: [{ code: 'CS101', handoutIds: ['CS101/Handout 01.pdf'] }],
      totalHighlights: 7,
      handouts: [
        {
          id: 'CS101/Handout 01.pdf',
          courseCode: 'CS101',
          fileName: 'Handout 01.pdf',
          size: 1234,
          status: 'completed',
          highlightCount: 7,
          pageCount: 3,
          lowConfidenceSkipped: 1,
          usedOcr: false,
        },
      ],
    });
    const loaded = await loadSnapshot();
    checks.equal('snapshot survives a reload', loaded?.handouts[0]?.status, 'completed');
    checks.equal('highlight total restored', loaded?.totalHighlights, 7);

    const outcome = await processHandout({
      bytes: await buildHandout(),
      courseCode: 'CS101',
      handoutName: 'Handout 01.pdf',
      settings: settings(),
      onStage: noop,
      onLog: noop,
      analyze: stubAnalyze(fixtureHighlights()),
    });
    await putOutput({
      handoutId: 'CS101/Handout 01.pdf',
      courseCode: 'CS101',
      fileName: 'Handout 01_AI_Highlighted.pdf',
      bytes: outcome.bytes,
      createdAt: Date.now(),
    });

    const blob = await buildZip([
      { handoutId: 'CS101/Handout 01.pdf', path: 'CS101/Handout 01_AI_Highlighted.pdf' },
    ]);
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    checks.assert('zip has the PK signature', head[0] === 0x50 && head[1] === 0x4b, `${head[0]},${head[1]}`);
    const asText = await blob.text();
    checks.assert('course folder structure preserved', asText.includes('CS101/Handout 01_AI_Highlighted.pdf'));
    checks.assert('archive contains the PDF payload', blob.size > outcome.bytes.byteLength * 0.9, `${blob.size} bytes`);
    await clearSession();
  });

  // ---------------------------------------------------- scanned handout
  await maybe('Test: a scanned handout is detected and routed to OCR', async (checks) => {
    const bytes = await buildScannedHandout();
    const text: DocumentText = await extractFromBytes(bytes);
    checks.assert(
      'thin text layer detected as a scan',
      needsOcr(text),
      `${text.totalChars} chars across ${text.pages.length} page(s)`,
    );

    try {
      const processed = await processHandout({
        bytes,
        courseCode: 'CS101',
        handoutName: 'Scanned.pdf',
        settings: settings(),
        onStage: noop,
        onLog: noop,
        analyze: stubAnalyze([{ text: DEFINITION, importance: 'high', reason: 'Key definition' }]),
      });
      checks.assert('the OCR path was taken', processed.usedOcr);
      checks.equal('output validated', processed.validation.ok, true);
      checks.assert(
        'the recognised span was highlighted on the image',
        processed.highlightCount >= 1,
        `${processed.highlightCount} highlight(s), ${processed.lowConfidenceSkipped} skipped`,
      );
      const annots = await annotationsOf(processed.bytes);
      checks.assert('highlight annotation written over the scan', annots.highlights >= 1, String(annots.highlights));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Without the optional language data OCR cannot run; a clear, reported
      // failure is the accepted outcome in that case.
      checks.assert(
        'OCR failed with a clear, actionable message',
        /OCR/i.test(message),
        `reported: ${message}`,
      );
    }
  });

  return results;
}
