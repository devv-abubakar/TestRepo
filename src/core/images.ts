import { extractPalette, type Palette } from './palette';
import { detectCropFraction } from './statusbar';

export interface LoadedImage {
  id: string;
  name: string;
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  /** Palette derived from the pixels, used when the theme follows the screenshot. */
  palette: Palette;
  /** Status bar crop the detector suggests, as a fraction of height. */
  suggestedCrop: number;
  bytes: number;
  /** The original file, kept so the project can be restored after a reload. */
  blob: Blob;
}

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export class ImageLoadError extends Error {}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> path; some browsers reject certain WebP/AVIF.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new ImageLoadError('This file could not be decoded as an image.'));
      img.src = url;
    });
    return img;
  } finally {
    // The bitmap is retained by the element, so the URL can go.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function sizeOf(source: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  if ('naturalWidth' in source) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

/**
 * Reads the pixels once, at low resolution, and reuses them for both the palette
 * and the status bar detection.
 *
 * Analysing a full 1440x3120 screenshot means three million iterations per
 * upload and a visible stall when someone drops eight files at once. The palette
 * is unaffected by downsampling, and the status bar detector only needs the
 * vertical structure, so both run on a version at most 320px wide.
 */
function analyse(
  source: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
): { palette: Palette; suggestedCrop: number } {
  const scale = Math.min(1, 320 / Math.max(1, width));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { palette: extractPalette(new Uint8ClampedArray(0), 0, 0), suggestedCrop: 0 };
  }
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  return {
    palette: extractPalette(data, w, h),
    suggestedCrop: detectCropFraction(data, w, h),
  };
}

export async function loadImageFile(file: File, id: string): Promise<LoadedImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new ImageLoadError(
      `${file.name}: ${file.type || 'unknown type'} is not supported. Use PNG, JPEG, WebP or AVIF.`,
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ImageLoadError(
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
        MAX_FILE_BYTES / 1024 / 1024
      } MB.`,
    );
  }

  const source = await decode(file);
  const { width, height } = sizeOf(source);
  if (width < 2 || height < 2) throw new ImageLoadError(`${file.name} has no usable pixels.`);

  const { palette, suggestedCrop } = analyse(source, width, height);

  return {
    id,
    name: file.name,
    source,
    width,
    height,
    palette,
    suggestedCrop,
    bytes: file.size,
    blob: file,
  };
}

/**
 * Applies the top crop, caching the result. Called on every render, so it must
 * not redraw unless the crop actually changed.
 */
export class CropCache {
  private cache = new Map<string, { canvas: HTMLCanvasElement; crop: number }>();

  get(image: LoadedImage, cropTop: number): { source: CanvasImageSource; width: number; height: number } {
    const cropPx = Math.round(image.height * Math.max(0, Math.min(0.25, cropTop)));
    if (cropPx <= 0) {
      return { source: image.source, width: image.width, height: image.height };
    }

    const existing = this.cache.get(image.id);
    if (existing && existing.crop === cropPx) {
      return { source: existing.canvas, width: existing.canvas.width, height: existing.canvas.height };
    }

    const canvas = existing?.canvas ?? document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height - cropPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { source: image.source, width: image.width, height: image.height };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      image.source,
      0,
      cropPx,
      image.width,
      image.height - cropPx,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    this.cache.set(image.id, { canvas, crop: cropPx });
    return { source: canvas, width: canvas.width, height: canvas.height };
  }

  invalidate(id: string): void {
    this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }
}
