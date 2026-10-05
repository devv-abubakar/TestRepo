/**
 * Low-level PDF annotation construction.
 *
 * pdf-lib has no first-class markup annotations, so these are assembled from
 * raw dictionaries. Highlights get a real /Highlight annotation *and* an
 * explicit appearance stream using the Multiply blend mode: the annotation is
 * what makes the mark a genuine, selectable highlight rather than a drawn
 * box, and the appearance stream is what guarantees every viewer renders it
 * identically with the underlying text still legible.
 */
import { PDFHexString, PDFName, PDFString, type PDFContext, type PDFPage, type PDFRef } from 'pdf-lib';
import type { Rect } from '../../types';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#RRGGBB` into 0..1 components, falling back to standard yellow. */
export function parseColor(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || !match[1]) return { r: 1, g: 0.945, b: 0.463 };
  const value = Number.parseInt(match[1], 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

function numbers(values: readonly number[]): number[] {
  return values.map((value) => Math.round(value * 1000) / 1000);
}

/**
 * Expand a text-run box into the band a highlighter pen would cover: a little
 * below the baseline for descenders, a little above for ascenders.
 */
export function highlightBand(rect: Rect): { x: number; y: number; width: number; height: number } {
  const height = Math.max(rect.height, 4);
  return {
    x: rect.x - height * 0.06,
    y: rect.y - height * 0.22,
    width: rect.width + height * 0.12,
    height: height * 1.2,
  };
}

/** One shared /ExtGState per document, so blend mode costs a single object. */
const gsCache = new WeakMap<PDFContext, Map<number, PDFRef>>();

function blendState(context: PDFContext, opacity: number): PDFRef {
  let perDoc = gsCache.get(context);
  if (!perDoc) {
    perDoc = new Map<number, PDFRef>();
    gsCache.set(context, perDoc);
  }
  const key = Math.round(opacity * 1000);
  const existing = perDoc.get(key);
  if (existing) return existing;
  const ref = context.register(
    context.obj({
      Type: 'ExtGState',
      BM: 'Multiply',
      ca: opacity,
      CA: opacity,
    }),
  );
  perDoc.set(key, ref);
  return ref;
}

/**
 * Add a highlight annotation covering `rects` (all on one page).
 * Returns the number of quads written.
 */
export function addHighlightAnnotation(
  page: PDFPage,
  rects: readonly Rect[],
  options: { color: Rgb; opacity: number; title: string; contents: string },
): number {
  if (rects.length === 0) return 0;
  const context = page.doc.context;
  const bands = rects.map(highlightBand);

  const left = Math.min(...bands.map((b) => b.x));
  const bottom = Math.min(...bands.map((b) => b.y));
  const right = Math.max(...bands.map((b) => b.x + b.width));
  const top = Math.max(...bands.map((b) => b.y + b.height));

  const quads: number[] = [];
  for (const band of bands) {
    // Order required by the spec: upper-left, upper-right, lower-left, lower-right.
    quads.push(
      band.x,
      band.y + band.height,
      band.x + band.width,
      band.y + band.height,
      band.x,
      band.y,
      band.x + band.width,
      band.y,
    );
  }

  const { color, opacity } = options;
  const gs = blendState(context, opacity);
  const paint = bands
    .map(
      (band) =>
        `${numbers([band.x - left, band.y - bottom, band.width, band.height]).join(' ')} re`,
    )
    .join('\n');
  const appearance = context.flateStream(
    `q\n/GS0 gs\n${numbers([color.r, color.g, color.b]).join(' ')} rg\n${paint}\nf\nQ\n`,
    {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: numbers([0, 0, right - left, top - bottom]),
      Resources: context.obj({ ExtGState: context.obj({ GS0: gs }) }),
    },
  );
  const appearanceRef = context.register(appearance);

  const annotation = context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: numbers([left, bottom, right, top]),
    QuadPoints: numbers(quads),
    C: numbers([color.r, color.g, color.b]),
    CA: opacity,
    // Print + NoZoom-free: the highlight must survive printing.
    F: 4,
    T: PDFString.of(options.title),
    Contents: PDFHexString.fromText(options.contents),
    AP: context.obj({ N: appearanceRef }),
  });

  page.node.addAnnot(context.register(annotation));
  return bands.length;
}

/** Add a clickable external link over `rect`. */
export function addLinkAnnotation(page: PDFPage, rect: Rect, url: string): void {
  const context = page.doc.context;
  const annotation = context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: numbers([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]),
    Border: [0, 0, 0],
    F: 4,
    // /I keeps viewers from inverting the page area on click.
    H: PDFName.of('I'),
    A: context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(url) }),
  });
  page.node.addAnnot(context.register(annotation));
}
