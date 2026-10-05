/**
 * Adding the student information block without touching original content.
 *
 * Nothing here is allowed to overlap what is already on the page, so the
 * footer is only drawn into a strip that was measured as genuinely blank, the
 * WhatsApp contact is only appended inline when the rest of that line is
 * clear, and when neither fits the block moves to a brand new final page.
 */
import { PDFFont, PDFPage, rgb, StandardFonts, type PDFDocument } from 'pdf-lib';
import type { ContentSettings, DocumentText, Rect } from '../../types';
import {
  AI_STUDY_MESSAGE,
  BOOKSHOP_ANCHOR,
  PLAY_STORE_LABEL,
  PLAY_STORE_URL,
  STUDENTS_GUIDE_TEXT,
  WHATSAPP_TEXT,
  WHATSAPP_URL,
} from '../../constants';
import { addLinkAnnotation } from './annotations';
import { rangeToRects } from './geometry';
import type { PdfDocument } from './pdfjs';
import { hasClearRunway, measurePage } from './whitespace';

const SIDE_MARGIN = 36;
const BLOCK_PADDING = 8;
const BODY_SIZE = 7.6;
const LINK_SIZE = 8.2;
const LINE_GAP = 1.25;
/** Blank band must clear the block by this much before we use it. */
const BAND_SAFETY = 14;

const INK = rgb(0.18, 0.2, 0.25);
const ACCENT = rgb(0.06, 0.36, 0.68);
const RULE = rgb(0.78, 0.8, 0.85);

type LineKind = 'bold' | 'body' | 'link';

interface BlockLine {
  text: string;
  kind: LineKind;
  size: number;
  url?: string;
}

export interface DecorateResult {
  /** Text this module added, so validation can subtract it again. */
  addedFragments: string[];
  /** True when a new final information page was appended. */
  addedPage: boolean;
  /** URLs that now have a clickable annotation. */
  links: string[];
  whatsappPlacement: 'inline' | 'block' | 'none';
  footerPlacement: 'footer-band' | 'new-page' | 'none';
  /**
   * Top edge of the block drawn into page one's footer band, in PDF units.
   * Validation asserts no original text sits below it.
   */
  footerBandTop?: number;
}

/** Greedy word wrap against real font metrics. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || current.length === 0) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function lineHeight(line: BlockLine): number {
  return line.size * LINE_GAP;
}

/** Draw a prepared block upward from `bottomY`, wiring up link annotations. */
function drawBlock(
  page: PDFPage,
  lines: readonly BlockLine[],
  fonts: { body: PDFFont; bold: PDFFont },
  bottomY: number,
  maxWidth: number,
  options: { rule: boolean },
): string[] {
  const total = lines.reduce((sum, line) => sum + lineHeight(line), 0);
  let y = bottomY + total;

  if (options.rule) {
    page.drawLine({
      start: { x: SIDE_MARGIN, y: y + BLOCK_PADDING * 0.6 },
      end: { x: SIDE_MARGIN + maxWidth, y: y + BLOCK_PADDING * 0.6 },
      thickness: 0.5,
      color: RULE,
    });
  }

  const urls: string[] = [];
  for (const line of lines) {
    y -= lineHeight(line);
    const font = line.kind === 'body' ? fonts.body : fonts.bold;
    const color = line.kind === 'link' ? ACCENT : INK;
    page.drawText(line.text, { x: SIDE_MARGIN, y, size: line.size, font, color });
    if (line.url) {
      const width = font.widthOfTextAtSize(line.text, line.size);
      const rect: Rect = {
        x: SIDE_MARGIN - 1,
        y: y - line.size * 0.22,
        width: width + 2,
        height: line.size * 1.2,
      };
      page.drawLine({
        start: { x: SIDE_MARGIN, y: y - line.size * 0.16 },
        end: { x: SIDE_MARGIN + width, y: y - line.size * 0.16 },
        thickness: 0.4,
        color: ACCENT,
      });
      addLinkAnnotation(page, rect, line.url);
      urls.push(line.url);
    }
  }
  return urls;
}

/**
 * Append the WhatsApp contact directly after the existing bookshop line,
 * but only when that line has verifiably clear space left on it.
 */
async function tryInlineWhatsApp(
  out: PDFDocument,
  source: PdfDocument,
  text: DocumentText,
  bold: PDFFont,
): Promise<{ placed: boolean; links: string[] }> {
  for (const page of text.pages) {
    const at = page.normalized.indexOf(BOOKSHOP_ANCHOR);
    if (at < 0) continue;

    const rects = rangeToRects(page, at, at + BOOKSHOP_ANCHOR.length);
    const anchor = rects[rects.length - 1];
    const target = out.getPages()[page.pageIndex];
    if (!anchor || !target) continue;

    const size = Math.min(Math.max(anchor.height * 0.92, 7), 10.5);
    const label = ` ${WHATSAPP_TEXT}`;
    const width = bold.widthOfTextAtSize(label, size);
    const startX = anchor.x + anchor.width;
    if (startX + width > page.width - SIDE_MARGIN * 0.6) return { placed: false, links: [] };

    const sourcePage = await source.getPage(page.pageIndex + 1);
    let clear = false;
    try {
      clear = await hasClearRunway(sourcePage, startX, anchor.y, anchor.height, width + 3);
    } finally {
      sourcePage.cleanup();
    }
    if (!clear) return { placed: false, links: [] };

    target.drawText(label, { x: startX, y: anchor.y, size, font: bold, color: ACCENT });
    addLinkAnnotation(
      target,
      { x: startX, y: anchor.y - size * 0.24, width, height: size * 1.2 },
      WHATSAPP_URL,
    );
    return { placed: true, links: [WHATSAPP_URL] };
  }
  return { placed: false, links: [] };
}

/**
 * Add every enabled information element to the output document.
 * `out` is the pdf-lib document being written; `source` is the same file open
 * in pdf.js, used only for measuring what is already on the page.
 */
export async function decorate(
  out: PDFDocument,
  source: PdfDocument,
  text: DocumentText,
  content: ContentSettings,
): Promise<DecorateResult> {
  const body = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const result: DecorateResult = {
    addedFragments: [],
    addedPage: false,
    links: [],
    whatsappPlacement: 'none',
    footerPlacement: 'none',
  };

  let whatsappInBlock = false;
  if (content.addWhatsApp) {
    const inline = await tryInlineWhatsApp(out, source, text, bold);
    if (inline.placed) {
      result.whatsappPlacement = 'inline';
      result.links.push(...inline.links);
      result.addedFragments.push(WHATSAPP_TEXT);
    } else {
      // No safe room on that line: carry it into the information block so the
      // contact detail is never lost and never overlaps existing content.
      whatsappInBlock = true;
    }
  }

  const firstPage = out.getPages()[0];
  if (!firstPage) return result;
  const maxWidth = firstPage.getWidth() - SIDE_MARGIN * 2;

  const lines: BlockLine[] = [];
  if (content.addStudentsGuide) {
    for (const line of wrap(STUDENTS_GUIDE_TEXT, bold, LINK_SIZE, maxWidth)) {
      lines.push({ text: line, kind: 'bold', size: LINK_SIZE });
    }
    lines.push({ text: PLAY_STORE_LABEL, kind: 'link', size: LINK_SIZE, url: PLAY_STORE_URL });
  }
  if (whatsappInBlock) {
    lines.push({ text: WHATSAPP_TEXT, kind: 'link', size: LINK_SIZE, url: WHATSAPP_URL });
  }
  if (content.addStudyMessage) {
    for (const line of wrap(AI_STUDY_MESSAGE, body, BODY_SIZE, maxWidth)) {
      lines.push({ text: line, kind: 'body', size: BODY_SIZE });
    }
  }
  if (lines.length === 0) return result;

  const needed = lines.reduce((sum, line) => sum + lineHeight(line), 0) + BLOCK_PADDING * 2;

  // Only a measured-blank strip at the foot of page one may be used.
  const page1 = await source.getPage(1);
  let bandHeight = 0;
  try {
    const space = await measurePage(page1);
    bandHeight = space.footer?.height ?? 0;
  } finally {
    page1.cleanup();
  }

  if (bandHeight >= needed + BAND_SAFETY) {
    const urls = drawBlock(firstPage, lines, { body, bold }, BLOCK_PADDING, maxWidth, { rule: true });
    result.links.push(...urls);
    result.footerPlacement = 'footer-band';
    result.footerBandTop = needed;
  } else {
    // Squeezing is not an option, so the block gets a page of its own.
    const page = out.addPage([firstPage.getWidth(), firstPage.getHeight()]);
    const title = 'VU Students — Information';
    page.drawText(title, {
      x: SIDE_MARGIN,
      y: page.getHeight() - SIDE_MARGIN - 14,
      size: 14,
      font: bold,
      color: INK,
    });
    const blockHeight = lines.reduce((sum, line) => sum + lineHeight(line), 0);
    const urls = drawBlock(
      page,
      lines,
      { body, bold },
      page.getHeight() - SIDE_MARGIN - 34 - blockHeight,
      maxWidth,
      { rule: false },
    );
    result.links.push(...urls);
    result.addedFragments.push(title);
    result.addedPage = true;
    result.footerPlacement = 'new-page';
  }

  if (whatsappInBlock) {
    result.whatsappPlacement = 'block';
    result.addedFragments.push(WHATSAPP_TEXT);
  }
  if (content.addStudentsGuide) {
    result.addedFragments.push(STUDENTS_GUIDE_TEXT, PLAY_STORE_LABEL);
  }
  if (content.addStudyMessage) result.addedFragments.push(AI_STUDY_MESSAGE);

  return result;
}
