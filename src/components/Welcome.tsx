import { useRef, useState } from 'react';
import { Check, ImageUp, Loader2, Sparkles } from 'lucide-react';
import { makeDemoFiles } from '../core/demo';
import { translate } from '../i18n';
import { useProject } from '../store/useProject';

/**
 * The first screen. It is also the pitch: three lines saying exactly what the
 * tool guarantees, because every one of them is a thing people get wrong by hand
 * and then get rejected for.
 */
export function Welcome() {
  const lang = useProject((s) => s.lang);
  const addFiles = useProject((s) => s.addFiles);
  const notify = useProject((s) => s.notify);
  const [dragging, setDragging] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  const runDemo = async () => {
    setLoadingDemo(true);
    try {
      await addFiles(await makeDemoFiles());
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not build the sample.');
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <div className="grid flex-1 place-items-center overflow-y-auto bg-[radial-gradient(ellipse_at_50%_-10%,rgba(51,93,255,0.16),transparent_58%)] p-6">
      <div className="w-full max-w-lg animate-fade-up text-center">
        <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 shadow-[0_16px_40px_-16px_rgba(51,93,255,1)]">
          <Sparkles size={24} className="text-white" strokeWidth={2.2} />
        </span>

        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink-50">
          {t('welcome.title')}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
          {t('app.tagline')}
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          className={`mt-7 cursor-pointer rounded-3xl border-2 border-dashed p-9 transition ${
            dragging
              ? 'border-acid bg-acid/[0.06]'
              : 'border-white/[0.13] bg-ink-850/50 hover:border-brand-400/60 hover:bg-ink-850'
          }`}
        >
          <ImageUp size={28} className="mx-auto text-ink-400" />
          <p className="mt-3 text-sm font-bold text-ink-100">{t('welcome.cta')}</p>
          <p className="mt-1 text-[11px] text-ink-500">{t('welcome.sub')}</p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={() => void runDemo()}
          disabled={loadingDemo}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-brand-300 transition hover:text-brand-200 disabled:text-ink-500"
        >
          {loadingDemo ? <Loader2 size={13} className="animate-spin" /> : null}
          {t('welcome.demo')}
        </button>

        <ul className="mx-auto mt-9 grid max-w-md gap-2 text-left">
          {[t('welcome.point1'), t('welcome.point2'), t('welcome.point3')].map((point) => (
            <li
              key={point}
              className="flex items-center gap-2.5 rounded-xl border border-white/[0.05] bg-ink-850/45 px-3.5 py-2.5"
            >
              <Check size={14} className="shrink-0 text-acid" strokeWidth={3} />
              <span className="text-[11.5px] text-ink-300">{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
