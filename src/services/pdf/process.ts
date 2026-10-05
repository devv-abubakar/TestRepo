/**
 * The single-handout pipeline.
 *
 * Read → extract (OCR if needed) → analyse → match → highlight → annotate →
 * validate → bytes out. Each stage reports progress and every buffer is
 * released before the next handout starts, which is what keeps a
 * 300-document batch inside the browser's memory budget.
 */
import { PDFDocument } from 'pdf-lib';
import type {
  AiHighlight,
  CoverageReport,
  DocumentText,
  LogLevel,
  MatchedHighlight,
  PageText,
  ProcessOutcome,
  ProcessingProgress,
  Settings,
} from '../../types';
import { APP_NAME } from '../../constants';
import { analyzeDocument, passLabel, type KeyPool } from '../ai';
import { sweepForCues } from './cues';
import { ocrDocument } from '../ocr';
import { validateOutput } from '../validation';
import { addHighlightAnnotation, parseColor } from './annotations';
import { decorate } from './decorate';
import { extractDocumentText, needsOcr } from './extract';
import { openPdf } from './pdfjs';

/** Fields of the live progress record this pipeline is allowed to update. */
export type ProgressPatch = Partial<
  Pick<ProcessingProgress, 'stage' | 'page' | 'pageCount' | 'chunksDone' | 'chunksTotal' | 'detail'>
>;

export interface ProcessInput {
  bytes: Uint8Array;
  courseCode: string;
  handoutName: string;
  settings: Settings;
  /** Shared key pool, so rate limits are respected across all handouts. */
  pool: KeyPool;
  signal?: AbortSignal;
  onProgress: (patch: ProgressPatch) => void;
  onLog: (level: LogLevel, message: string, keyLabel?: string) => void;
  /**
   * Seam for driving the pipeline without a live provider. Production code
   * leaves this unset and the configured AI provider is used.
   */
  analyze?: (text: DocumentText, meta: { courseCode: string; handoutName: string }) => Promise<AiHighlight[]>;
}

/** A page with less text than this is a cover or divider, not a gap. */
const MIN_PAGE_TEXT_FOR_GAP = 220;

/** What was marked, and — more importantly — what was not. */
function buildCoverage(
  pages: readonly PageText[],
  matched: readonly MatchedHighlight[],
  extras: { unmatchedSpans: number; ruleBasedAdded: number; aiRequests: number },
): CoverageReport {
  const perPageChars = new Array<number>(pages.length).fill(0);
  for (const match of matched) {
    if (match.pageIndex < perPageChars.length) {
      perPageChars[match.pageIndex] = (perPageChars[match.pageIndex] ?? 0) + match.matchedText.length;
    }
  }

  const perPageShare: number[] = [];
  const pagesWithoutHighlights: number[] = [];
  let totalChars = 0;
  let totalHighlighted = 0;

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const chars = page?.normalized.length ?? 0;
    const highlighted = perPageChars[i] ?? 0;
    totalChars += chars;
    totalHighlighted += highlighted;
    perPageShare.push(chars > 0 ? highlighted / chars : 0);
    if (chars >= MIN_PAGE_TEXT_FOR_GAP && highlighted === 0) pagesWithoutHighlights.push(i + 1);
  }

  return {
    share: totalChars > 0 ? totalHighlighted / totalChars : 0,
    pagesWithoutHighlights,
    perPageShare,
    ...extras,
  };
}

function throwIfStopped(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Processing was stopped before this handout finished.');
}

/** Group matched spans so one AI highlight becomes one annotation per page. */
function groupByAnnotation(matched: readonly MatchedHighlight[]): MatchedHighlight[][] {
  const groups = new Map<string, MatchedHighlight[]>();
  for (const match of matched) {
    const key = `${match.groupId}:${match.pageIndex}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(match);
    else groups.set(key, [match]);
  }
  return [...groups.values()];
}

export async function processHandout(input: ProcessInput): Promise<ProcessOutcome> {
  const { settings, signal } = input;
  // pdf.js takes ownership of any buffer handed to it, so every consumer
  // below gets its own copy of the original bytes.
  const master = input.bytes;

  input.onProgress({ stage: 'extracting', page: 0, pageCount: 0, detail: 'Reading the file' });
  const source = await openPdf(master.slice());
  try {
    const pageCount = source.numPages;
    input.onProgress({ pageCount });
    let text = await extractDocumentText(source, (page) =>
      input.onProgress({ stage: 'extracting', page, detail: `Extracting text — page ${page} of ${pageCount}` }),
    );
    throwIfStopped(signal);

    if (needsOcr(text)) {
      input.onLog('warn', 'No usable text layer found — running OCR.');
      text = await ocrDocument(source, (page) =>
        input.onProgress({ stage: 'ocr', page, detail: `OCR — page ${page} of ${pageCount}` }),
      );
      input.onLog('info', `OCR recovered ${text.totalChars.toLocaleString()} characters.`);
    }
    throwIfStopped(signal);

    const meta = { courseCode: input.courseCode, handoutName: input.handoutName };
    let chunksDone = 0;
    input.onProgress({ stage: 'analyzing', chunksDone: 0, chunksTotal: 0, detail: 'Analyzing important content' });

    let aiRequests = 0;
    const aiHighlights = input.analyze
      ? await input.analyze(text, meta)
      : await analyzeDocument(text, { ...meta, coverage: settings.highlight.coverage }, settings.ai, input.pool, {
          signal,
          onChunkStart: ({ index, total, pages, keyLabel, pass, passIndex, passTotal }) => {
            const span = pages.length > 1 ? `pages ${pages[0]}-${pages[pages.length - 1]}` : `page ${pages[0]}`;
            input.onProgress({
              stage: 'analyzing',
              chunksTotal: total * passTotal,
              chunksDone,
              page: pages[0] ?? 0,
              detail:
                `Analyzing ${span} — ${passLabel(pass)} ${passIndex}/${passTotal} ` +
                `(part ${index}/${total}) via ${keyLabel}`,
            });
            input.onLog('info', `${span}: ${passLabel(pass)} started (part ${index}/${total})`, keyLabel);
          },
          onChunkDone: ({ index, total, pages, keyLabel, highlights, ms, pass, passTotal }) => {
            chunksDone += 1;
            const span = pages.length > 1 ? `pages ${pages[0]}-${pages[pages.length - 1]}` : `page ${pages[0]}`;
            input.onProgress({ chunksDone, chunksTotal: total * passTotal });
            input.onLog(
              'success',
              `${span}: ${passLabel(pass)} found ${highlights} candidate(s) in ${(ms / 1000).toFixed(1)}s ` +
                `(part ${index}/${total})`,
              keyLabel,
            );
          },
          onRetry: ({ index, attempt, reason }) =>
            input.onLog('warn', `part ${index}: reply was not valid JSON (attempt ${attempt}) — ${reason}`),
        });
    throwIfStopped(signal);

    let candidates: AiHighlight[];
    if (Array.isArray(aiHighlights)) {
      candidates = aiHighlights;
    } else {
      candidates = aiHighlights.highlights;
      aiRequests = aiHighlights.requests;
    }

    // The rule-based sweep goes last so a model-supplied span wins any tie
    // for the per-page budget; its job is to fill gaps, not to take over.
    let ruleBasedAdded = 0;
    if (settings.highlight.ruleBasedSweep) {
      const cues = sweepForCues(text);
      const known = new Set(candidates.map((entry) => entry.text.trim().toLowerCase()));
      const fresh = cues.filter((entry) => !known.has(entry.text.trim().toLowerCase()));
      ruleBasedAdded = fresh.length;
      candidates = [...candidates, ...fresh];
      if (fresh.length > 0) {
        input.onLog(
          'info',
          `rule sweep added ${fresh.length} definition/formula/classification candidate(s) the model did not return.`,
        );
      }
    }

    input.onProgress({ stage: 'matching', detail: 'Matching text to page coordinates' });
    const { matchHighlights } = await import('./match');
    const report = matchHighlights(text, candidates, settings.highlight);
    for (const failure of report.failures) {
      input.onLog(
        'warn',
        `Skipped a highlight (${failure.reason}, confidence ` +
          `${Math.round(failure.bestConfidence * 100)}%): "${failure.text.slice(0, 80)}"`,
      );
    }
    throwIfStopped(signal);

    input.onProgress({ stage: 'highlighting', detail: 'Applying yellow highlights' });
    const out = await PDFDocument.load(master.slice(), { updateMetadata: false });
    const pages = out.getPages();
    const color = parseColor(settings.highlight.color);
    let written = 0;

    for (const group of groupByAnnotation(report.matched)) {
      const first = group[0];
      if (!first) continue;
      const page = pages[first.pageIndex];
      if (!page) continue;
      const rects = group.flatMap((match) => match.rects);
      const quads = addHighlightAnnotation(page, rects, {
        color,
        opacity: settings.highlight.opacity,
        title: APP_NAME,
        contents: first.reason || 'Exam-relevant content',
      });
      if (quads > 0) written += 1;
    }

    input.onProgress({ stage: 'annotating', detail: 'Adding student information and links' });
    const decoration = await decorate(out, source, text, settings.content);
    if (decoration.footerPlacement === 'new-page') {
      input.onLog('info', 'First page had no safe blank area — added a final information page.');
    }
    if (decoration.whatsappPlacement === 'block') {
      input.onLog(
        'info',
        'No clear space after the bookshop line — WhatsApp contact placed in the information block.',
      );
    }

    input.onProgress({ stage: 'saving', detail: 'Saving the highlighted PDF' });
    out.setProducer(APP_NAME);
    const bytes = await out.save({ useObjectStreams: false });

    input.onProgress({ stage: 'validating', detail: 'Validating the output PDF' });
    const validation = await validateOutput({
      original: text,
      originalPageCount: pageCount,
      bytes,
      matched: report.matched,
      decoration,
      content: {
        addStudentsGuide: settings.content.addStudentsGuide,
        addWhatsApp: settings.content.addWhatsApp,
      },
    });

    if (!validation.ok) {
      const failed = validation.checks.filter((check) => !check.ok);
      throw new Error(
        `Output validation failed: ${failed
          .map((check) => `${check.name}${check.detail ? ` (${check.detail})` : ''}`)
          .join('; ')}`,
      );
    }

    const coverage = buildCoverage(text.pages, report.matched, {
      unmatchedSpans: report.failures.length,
      ruleBasedAdded,
      aiRequests,
    });

    if (coverage.pagesWithoutHighlights.length > 0) {
      input.onLog(
        'warn',
        `no highlight landed on page(s) ${coverage.pagesWithoutHighlights.join(', ')} — ` +
          'review those pages yourself, or raise the coverage mode.',
      );
    }
    input.onLog(
      'info',
      `coverage: ${(coverage.share * 100).toFixed(1)}% of the text highlighted across ` +
        `${pageCount} page(s), ${aiRequests} AI request(s) spent.`,
    );

    input.onProgress({ stage: 'done', detail: 'Finished' });
    return {
      highlightCount: written,
      lowConfidenceSkipped: report.failures.length,
      pageCount,
      usedOcr: text.usedOcr,
      bytes,
      validation,
      coverage,
    };
  } finally {
    await source.destroy().catch(() => undefined);
  }
}
