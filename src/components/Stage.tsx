import { useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Upload } from 'lucide-react';
import { PRESETS } from '../core/playstore';
import { translate } from '../i18n';
import { useProject } from '../store/useProject';
import { SlideCanvas } from './SlideCanvas';
import { Button } from './ui';
import { exportSlide, downloadAsset } from '../core/export';

/**
 * The centre stage: one large preview, drag-and-drop onto it, and a per-slide
 * download. Everything here is sized from the preset's own aspect ratio so a
 * feature graphic and a tablet screenshot both sit correctly without a special
 * case.
 */
export function Stage() {
  const project = useProject((s) => s.project);
  const activeIndex = useProject((s) => s.activeIndex);
  const lang = useProject((s) => s.lang);
  const images = useProject((s) => s.images);
  const crops = useProject((s) => s.crops);
  const setActive = useProject((s) => s.setActive);
  const addFiles = useProject((s) => s.addFiles);
  const updateSlide = useProject((s) => s.updateSlide);
  const notify = useProject((s) => s.notify);

  const [dragOver, setDragOver] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const preset = PRESETS[project.presetId];
  const slide = project.slides[activeIndex];

  const onDrop = useCallback(
    (files: FileList) => {
      setDragOver(false);
      void addFiles(files);
    },
    [addFiles],
  );

  const downloadOne = async () => {
    if (!slide) return;
    setDownloading(true);
    try {
      const image = slide.imageId ? images[slide.imageId] ?? null : null;
      const asset = await exportSlide(project, activeIndex, image, crops);
      downloadAsset(asset);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-[radial-gradient(ellipse_at_top,rgba(51,93,255,0.09),transparent_60%)]">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length > 0) onDrop(e.dataTransfer.files);
        }}
        className="flex flex-1 items-center justify-center overflow-hidden p-5"
      >
        <div
          className={`relative max-h-full transition ${
            dragOver ? 'scale-[0.985] opacity-70' : ''
          }`}
          style={{
            // Height-bound, capped by width. With an aspect ratio set, this makes
            // a 9:16 phone asset fill the available height and a 1024x500 feature
            // graphic fill the available width, with no per-preset special case.
            aspectRatio: `${preset.width} / ${preset.height}`,
            height: '100%',
            width: 'auto',
            maxWidth: '100%',
          }}
        >
          <div className="h-full w-full overflow-hidden rounded-2xl shadow-lift ring-1 ring-white/[0.08]">
            <SlideCanvas index={activeIndex} rounded={false} className="h-full" testId="stage-canvas" />
          </div>

          {dragOver && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl border-2 border-dashed border-acid bg-ink-950/45">
              <span className="flex items-center gap-2 rounded-full bg-ink-950/90 px-4 py-2 text-xs font-bold text-acid">
                <Upload size={14} /> {t('welcome.title')}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-white/[0.06] bg-ink-900/60 px-4 py-2.5">
        <Button
          variant="ghost"
          onClick={() => setActive(activeIndex - 1)}
          disabled={activeIndex === 0}
          title="Previous"
        >
          <ChevronLeft size={15} />
        </Button>

        <span className="min-w-[92px] text-center text-[11px] font-bold tabular-nums text-ink-300">
          {activeIndex + 1} / {project.slides.length}
          <span className="ml-2 font-medium text-ink-500">
            {preset.width}×{preset.height}
          </span>
        </span>

        <Button
          variant="ghost"
          onClick={() => setActive(activeIndex + 1)}
          disabled={activeIndex >= project.slides.length - 1}
          title="Next"
        >
          <ChevronRight size={15} />
        </Button>

        <div className="mx-2 h-6 w-px bg-white/[0.07]" />

        {slide?.imageId && (
          <Button
            variant="ghost"
            onClick={() => updateSlide(activeIndex, { imageId: null })}
            title="Detach the screenshot from this slide"
          >
            Clear
          </Button>
        )}

        <Button variant="secondary" onClick={() => void downloadOne()} disabled={downloading}>
          <Download size={14} /> {downloading ? '…' : t('action.exportOne')}
        </Button>
      </div>
    </div>
  );
}
