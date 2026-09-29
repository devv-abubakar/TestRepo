import { Languages, RotateCcw, RotateCw, Sparkles, Trash2 } from 'lucide-react';
import { PRESETS, PRESET_ORDER } from '../core/playstore';
import { translate } from '../i18n';
import { useProject } from '../store/useProject';
import { Button } from './ui';

export function TopBar() {
  // One selector per value on purpose. A selector that builds a new object on
  // every call makes zustand's snapshot differ each read, which React reports as
  // an uncached getSnapshot and repaints in a loop.
  const project = useProject((s) => s.project);
  const lang = useProject((s) => s.lang);
  const history = useProject((s) => s.history);
  const future = useProject((s) => s.future);
  const setName = useProject((s) => s.setName);
  const setPreset = useProject((s) => s.setPreset);
  const setLang = useProject((s) => s.setLang);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);
  const reset = useProject((s) => s.reset);
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-ink-900/85 px-4 py-2.5 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-[0_4px_14px_-4px_rgba(51,93,255,0.9)]">
          <Sparkles size={16} strokeWidth={2.4} />
        </span>
        <div className="leading-tight">
          <p className="font-display text-sm font-bold tracking-tight text-ink-50">StoreShot</p>
          <p className="hidden text-[10px] text-ink-500 sm:block">{t('app.privacy')}</p>
        </div>
      </div>

      <div className="mx-1 h-7 w-px bg-white/[0.07]" />

      <input
        value={project.name}
        onChange={(e) => setName(e.target.value)}
        aria-label={t('field.appName')}
        placeholder={t('field.appName')}
        maxLength={60}
        className="w-36 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-ink-50 outline-none transition hover:border-white/[0.08] focus:border-brand-400/60 focus:bg-ink-900 sm:w-52"
      />

      <select
        value={project.presetId}
        onChange={(e) => setPreset(e.target.value as typeof project.presetId)}
        aria-label={t('field.assetType')}
        className="rounded-lg border border-white/[0.07] bg-ink-900 px-2.5 py-1.5 text-xs font-semibold text-ink-100 outline-none focus:border-brand-400/60"
      >
        {PRESET_ORDER.map((id) => (
          <option key={id} value={id}>
            {PRESETS[id].label} · {PRESETS[id].width}×{PRESETS[id].height}
          </option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          onClick={undo}
          disabled={history.length === 0}
          title={`${t('action.undo')} (Ctrl+Z)`}
        >
          <RotateCcw size={14} />
        </Button>
        <Button
          variant="ghost"
          onClick={redo}
          disabled={future.length === 0}
          title={`${t('action.redo')} (Ctrl+Shift+Z)`}
        >
          <RotateCw size={14} />
        </Button>
        <Button
          variant="ghost"
          onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}
          title="English / Urdu"
        >
          <Languages size={14} />
          <span className="hidden sm:inline">{lang === 'en' ? 'اردو' : 'EN'}</span>
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm('Discard this project and every screenshot in it?')) reset();
          }}
          title={t('action.reset')}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </header>
  );
}
