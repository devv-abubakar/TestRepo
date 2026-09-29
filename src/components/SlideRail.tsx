import { useRef, useState } from 'react';
import { GripVertical, ImagePlus, Plus, X } from 'lucide-react';
import { PRESETS } from '../core/playstore';
import { translate } from '../i18n';
import { useProject } from '../store/useProject';
import { SlideCanvas } from './SlideCanvas';

/**
 * The slide strip. Order matters more than anything else in the editor: Play
 * shows the first two or three screenshots without the user scrolling, so the
 * rail makes the sequence obvious and reorderable by drag.
 */
export function SlideRail() {
  const project = useProject((s) => s.project);
  const activeIndex = useProject((s) => s.activeIndex);
  const lang = useProject((s) => s.lang);
  const setActive = useProject((s) => s.setActive);
  const removeSlide = useProject((s) => s.removeSlide);
  const addEmptySlide = useProject((s) => s.addEmptySlide);
  const moveSlide = useProject((s) => s.moveSlide);
  const addFiles = useProject((s) => s.addFiles);

  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const preset = PRESETS[project.presetId];
  const full = project.slides.length >= preset.maxCount;

  return (
    <aside className="flex w-[124px] shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/40">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-500">
          {project.slides.length}/{preset.maxCount}
        </span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title={t('action.add')}
          className="rounded-lg p-1 text-ink-400 transition hover:bg-white/[0.06] hover:text-ink-100"
        >
          <ImagePlus size={14} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
        {project.slides.map((slide, index) => {
          const active = index === activeIndex;
          const isOver = over === index && dragging !== null && dragging !== index;
          return (
            <div
              key={slide.id}
              draggable
              onDragStart={() => setDragging(index)}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null) moveSlide(dragging, index);
                setDragging(null);
                setOver(null);
              }}
              className={`group relative cursor-grab rounded-xl p-0.5 transition ${
                isOver ? 'ring-2 ring-acid' : ''
              } ${active ? 'ring-2 ring-brand-400' : 'ring-1 ring-white/[0.06] hover:ring-white/20'}`}
            >
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-current={active}
                aria-label={`Screenshot ${index + 1}`}
                className="block w-full"
              >
                <SlideCanvas index={index} testId={`rail-canvas-${index}`} />
              </button>

              <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-md bg-ink-950/80 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-ink-100">
                {index + 1}
              </span>

              <span className="pointer-events-none absolute bottom-1.5 left-1.5 text-ink-500 opacity-0 transition group-hover:opacity-100">
                <GripVertical size={11} />
              </span>

              {project.slides.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSlide(index)}
                  aria-label={`${t('action.remove')} ${index + 1}`}
                  className="absolute right-1 top-1 rounded-md bg-ink-950/85 p-0.5 text-ink-300 opacity-0 transition hover:bg-red-500/85 hover:text-white group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
              )}

              {!slide.imageId && (
                <span className="pointer-events-none absolute inset-x-1 bottom-4 text-center text-[8px] font-semibold uppercase tracking-wide text-ink-500">
                  {t('slide.empty')}
                </span>
              )}
            </div>
          );
        })}

        {!full && (
          <button
            type="button"
            onClick={addEmptySlide}
            className="grid w-full place-items-center rounded-xl border border-dashed border-white/[0.1] py-6 text-ink-500 transition hover:border-brand-400/50 hover:text-brand-300"
            title={t('action.addSlide')}
          >
            <Plus size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}
