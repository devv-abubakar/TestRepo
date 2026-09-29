import { useEffect, useRef } from 'react';
import { PRESETS } from '../core/playstore';
import { resolveSlide } from '../core/project';
import { renderSlide } from '../core/render';
import { useProject } from '../store/useProject';

/**
 * Paints one slide onto a canvas at whatever size the element happens to be.
 *
 * The preview and the export share `renderSlide`, and the only difference
 * between them is the transform applied here — so what the user approves on
 * screen is what the exported file contains. Device pixel ratio is capped at 2:
 * beyond that the extra pixels are invisible and the repaint cost on a phone is
 * not.
 */
export function SlideCanvas({
  index,
  className,
  rounded = true,
  testId,
}: {
  index: number;
  className?: string;
  rounded?: boolean;
  /** Distinguishes the stage canvas from the rail thumbnail of the same slide. */
  testId?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);

  const project = useProject((s) => s.project);
  const images = useProject((s) => s.images);
  const crops = useProject((s) => s.crops);
  const revision = useProject((s) => s.revision);

  const preset = PRESETS[project.presetId];

  useEffect(() => {
    const paint = () => {
      frameRef.current = null;
      const canvas = canvasRef.current;
      const slide = project.slides[index];
      if (!canvas || !slide) return;

      const cssWidth = canvas.clientWidth;
      if (cssWidth <= 0) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const scale = (cssWidth * dpr) / preset.width;
      const pixelWidth = Math.round(preset.width * scale);
      const pixelHeight = Math.round(preset.height * scale);

      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);

      const image = slide.imageId ? images[slide.imageId] ?? null : null;
      const cropped = image ? crops.get(image, slide.cropTop) : null;

      renderSlide(ctx, {
        width: preset.width,
        height: preset.height,
        resolved: resolveSlide(project, slide, image?.palette ?? null),
        image: cropped?.source ?? null,
        imageWidth: cropped?.width ?? 0,
        imageHeight: cropped?.height ?? 0,
        dpr: scale,
      });
    };

    // Coalesce the bursts that a slider drag produces into one paint per frame.
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(paint);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [index, project, images, crops, revision, preset]);

  // Repaint when the element is resized, which no state change signals.
  // The PARENT is observed, not the canvas: painting changes the canvas bitmap
  // size, and observing the canvas itself risks a resize/paint feedback loop.
  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    let last = 0;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (Math.abs(width - last) < 1) return;
      last = width;
      useProject.setState((s) => ({ revision: s.revision + 1 }));
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid={testId ?? `slide-canvas-${index}`}
      aria-label={`Preview of screenshot ${index + 1}`}
      style={{ aspectRatio: `${preset.width} / ${preset.height}` }}
      className={`block w-full ${rounded ? 'rounded-xl' : ''} ${className ?? ''}`}
    />
  );
}
