/**
 * Synthetic handouts used by the acceptance harness.
 *
 * These are built with pdf-lib so the tests run against genuine PDF bytes,
 * exercising the same extraction, coordinate mapping and annotation code the
 * app uses on a real handout.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const BOOKSHOP_LINE_A =
  'Get all Virtual University books in high-quality hard copy, delivered right to';
export const BOOKSHOP_LINE_B = 'your doorstep. Visit vubookshoppk.com';

export const DEFINITION =
  'Inflation is defined as a sustained increase in the general price level of an economy over time.';
export const CLASSIFICATION =
  'Demand-pull inflation occurs when aggregate demand exceeds aggregate supply at full employment.';
export const FORMULA = 'Real interest rate equals nominal interest rate minus the rate of inflation.';

const BODY = [
  'Welcome to this lecture. In this handout we will look at several ideas in sequence.',
  'Before we begin, please make sure you have read the previous lecture notes carefully.',
  DEFINITION,
  'This idea appears in many textbooks and is discussed widely in the literature.',
  CLASSIFICATION,
  'Students sometimes confuse the two mechanisms described above, so read them again.',
  FORMULA,
  'That concludes the main discussion for this section of the handout.',
];

export interface FixtureOptions {
  /** Pages after the first; each gets filler plus one key sentence. */
  extraPages?: number;
  /** Fill page one to the bottom so no blank footer band remains. */
  fillFirstPage?: boolean;
  /** Push the bookshop line out to the right margin, removing the runway. */
  crowdBookshopLine?: boolean;
  /** Dense page used to exercise the over-highlighting guard. */
  densePage?: boolean;
}

export async function buildHandout(options: FixtureOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = 11;
  const ink = rgb(0.1, 0.1, 0.12);

  const page = doc.addPage([595, 842]);
  let y = 780;
  page.drawText('CS101 — Lecture 01', { x: 50, y, size: 16, font: bold, color: ink });
  y -= 30;

  for (const line of BODY) {
    page.drawText(line, { x: 50, y, size, font, color: ink });
    y -= 18;
  }

  if (options.fillFirstPage) {
    while (y > 40) {
      page.drawText('Additional discussion text that continues down the page body area.', {
        x: 50,
        y,
        size,
        font,
        color: ink,
      });
      y -= 16;
    }
  }

  // The bookshop line already present in every real handout.
  const bookshopY = options.fillFirstPage ? 26 : 120;
  if (options.crowdBookshopLine) {
    page.drawText(`${BOOKSHOP_LINE_A} ${BOOKSHOP_LINE_B}`, {
      x: 50,
      y: bookshopY,
      size: 8,
      font,
      color: ink,
    });
  } else {
    page.drawText(BOOKSHOP_LINE_A, { x: 50, y: bookshopY + 12, size: 9, font, color: ink });
    page.drawText(BOOKSHOP_LINE_B, { x: 50, y: bookshopY, size: 9, font, color: ink });
  }

  for (let n = 0; n < (options.extraPages ?? 0); n += 1) {
    const extra = doc.addPage([595, 842]);
    let ey = 780;
    extra.drawText(`Page ${n + 2} — continued`, { x: 50, y: ey, size: 14, font: bold, color: ink });
    ey -= 28;
    const lines = options.densePage
      ? Array.from(
          { length: 38 },
          (_, i) => `Paragraph ${i + 1} explains one distinct idea in a complete sentence of body text.`,
        )
      : [
          'The following sentence is the key takeaway for this page of the handout.',
          `${FORMULA} It is applied in every numerical question on this topic.`,
          'Everything else on this page is supporting narrative and worked discussion.',
        ];
    for (const line of lines) {
      extra.drawText(line, { x: 50, y: ey, size: options.densePage ? 9 : size, font, color: ink });
      ey -= options.densePage ? 14 : 18;
      if (ey < 60) break;
    }
  }

  return doc.save({ useObjectStreams: false });
}

/** A page-image-only PDF, i.e. what a scanned handout looks like. */
export async function buildScannedHandout(): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111111';
  context.font = '30px sans-serif';
  // Wrapped by hand so nothing runs off the page edge and gets clipped.
  const lines = [
    'Inflation is defined as a sustained increase in the',
    'general price level of an economy over time.',
    'This page exists only as an image, with no text layer.',
  ];
  let y = 220;
  for (const line of lines) {
    context.fillText(line, 90, y);
    y += 60;
  }

  const dataUrl = canvas.toDataURL('image/png');
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(dataUrl);
  const page = doc.addPage([595, 842]);
  page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  return doc.save({ useObjectStreams: false });
}

/** Definitions, a formula and a classification, spread over several pages. */
export const DEF_INFLATION =
  'Inflation is defined as a sustained increase in the general price level of an economy.';
export const DEF_OPPORTUNITY =
  'Opportunity cost refers to the value of the next best alternative that is forgone.';
export const DEF_ELASTICITY =
  'Price elasticity of demand is known as the responsiveness of quantity demanded to price.';
export const RULE_DEMAND =
  'The law of demand states that the quantity demanded falls as the price of a good rises.';
export const CLASS_MARKET =
  'There are four main types of market structure studied in introductory economics courses.';
export const FORMULA_REAL =
  'The real interest rate is given by the nominal interest rate minus the rate of inflation.';

/**
 * A handout whose examinable content is explicit, used to measure how much of
 * it survives when the model itself is unhelpful.
 */
export async function buildDefinitionHandout(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12);

  const write = (title: string, lines: readonly string[], footer?: readonly string[]) => {
    const page = doc.addPage([595, 842]);
    let y = 780;
    page.drawText(title, { x: 50, y, size: 15, font: bold, color: ink });
    y -= 30;
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 10.5, font, color: ink });
      y -= 17;
    }
    if (footer) {
      let fy = 120;
      for (const line of footer) {
        page.drawText(line, { x: 50, y: fy, size: 9, font, color: ink });
        fy -= 12;
      }
    }
  };

  write(
    'ECO401 — Lecture 01',
    [
      'This opening paragraph simply welcomes you to the course and sets expectations.',
      DEF_INFLATION,
      'We will return to this idea repeatedly throughout the remainder of the course.',
      DEF_OPPORTUNITY,
      'Students often find the second idea more intuitive than the first one here.',
      DEF_ELASTICITY,
    ],
    [BOOKSHOP_LINE_A, BOOKSHOP_LINE_B],
  );

  write('ECO401 — Lecture 01 continued', [
    'The next section builds on the definitions introduced on the previous page.',
    RULE_DEMAND,
    'Worked examples for this rule appear in the accompanying exercise booklet.',
    CLASS_MARKET,
    'Each of those structures is discussed in detail in a later lecture of the course.',
    FORMULA_REAL,
  ]);

  // Deliberately free of examinable content, so the gap report has something
  // real to flag rather than a page that merely looks empty.
  write('ECO401 — Closing remarks', [
    'That concludes the material for this week and we hope you enjoyed the discussion.',
    'Please attend the weekly session and bring any questions that you may still have.',
    'The discussion forum remains open for the rest of the term for general questions.',
    'We look forward to seeing your participation in the activities planned for you.',
  ]);

  return doc.save({ useObjectStreams: false });
}
