import { APP_NAME, APP_SUBTITLE } from '../constants';
import { useAppStore } from '../store/useAppStore';
import { Icon } from './ui';

export function Header() {
  const theme = useAppStore((state) => state.settings.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const toggleSettings = useAppStore((state) => state.toggleSettings);
  const settingsOpen = useAppStore((state) => state.settingsOpen);

  return (
    <header className="sticky top-0 z-20 border-b border-edge bg-panel/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span
            className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"
            aria-hidden="true"
          >
            <Icon name="spark" className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold leading-tight text-ink">{APP_NAME}</h1>
            <p className="max-w-xl text-xs text-muted sm:text-sm">{APP_SUBTITLE}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => toggleSettings()}
            aria-expanded={settingsOpen}
            aria-controls="settings-panel"
          >
            <Icon name="settings" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </div>
    </header>
  );
}
