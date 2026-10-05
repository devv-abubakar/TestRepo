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
  DocumentText,
  LogLevel,
  MatchedHighlight,
  ProcessOutcome,
  ProcessingProgress,
  Settings,
} from '../../types';
import { APP_NAME } from '../../constants';
import { analyzeDocument, type KeyPool } from '../ai';
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

    const aiHighlights = input.analyze
      ? await input.analyze(text, meta)
      : await analyzeDocument(text, meta, settings.ai, input.pool, {
          signal,
          onChunkStart: ({ index, total, pages, keyLabel }) => {
            const span = pages.length > 1 ? `pages ${pages[0]}-${pages[pages.length - 1]}` : `page ${pages[0]}`;
            input.onProgress({
              stage: 'analyzing',
              chunksTotal: total,
              chunksDone,
              page: pages[0] ?? 0,
              detail: `Analyzing ${span} (part ${index}/${total}) via ${keyLabel}`,
            });
            input.onLog('info', `analyzing ${span} (part ${index}/${total})`, keyLabel);
          },
          onChunkDone: ({ index, total, pages, keyLabel, highlights, ms }) => {
            chunksDone += 1;
            const span = pages.length > 1 ? `pages ${pages[0]}-${pages[pages.length - 1]}` : `page ${pages[0]}`;
            input.onProgress({ chunksDone, chunksTotal: total });
            input.onLog(
              'success',
              `${span} done (part ${index}/${total}) — ${highlights} candidate(s) in ${(ms / 1000).toFixed(1)}s`,
              keyLabel,
            );
          },
          onRetry: ({ index, attempt, reason }) =>
            input.onLog('warn', `part ${index}: reply was not valid JSON (attempt ${attempt}) — ${reason}`),
        });
    throwIfStopped(signal);

    input.onProgress({ stage: 'matching', detail: 'Matching text to page coordinates' });
    const { matchHighlights } = await import('./match');
    const report = matchHighlights(text, aiHighlights, settings.highlight);
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

    input.onProgress({ stage: 'done', detail: 'Finished' });
    return {
      highlightCount: written,
      lowConfidenceSkipped: report.failures.length,
      pageCount,
      usedOcr: text.usedOcr,
      bytes,
      validation,
    };
  } finally {
    await source.destroy().catch(() => undefined);
  }
}
