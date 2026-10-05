import { useAppStore } from '../store/useAppStore';
import { Card, Icon, LEVEL_COLOR, LEVEL_ICON } from './ui';

export function LogPanel() {
  const logs = useAppStore((state) => state.logs);
  const open = useAppStore((state) => state.logsOpen);
  const toggle = useAppStore((state) => state.toggleLogs);
  const clear = useAppStore((state) => state.clearLogs);

  return (
    <Card
      id="logs"
      title="Processing Log"
      description={`${logs.length} entr${logs.length === 1 ? 'y' : 'ies'} — newest first. Key-specific lines are tagged with the key's label.`}
      action={
        <div className="flex gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={clear}>
            Clear
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-xs"
            onClick={toggle}
            aria-expanded={open}
            aria-controls="log-list"
          >
            <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
            {open ? 'Collapse' : 'Expand'}
          </button>
        </div>
      }
    >
      {open ? (
        <ul
          id="log-list"
          className="max-h-80 space-y-1.5 overflow-y-auto font-mono text-xs"
          aria-live="polite"
        >
          {logs.length === 0 ? (
            <li className="text-muted">No activity yet.</li>
          ) : (
            logs.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2">
                <Icon name={LEVEL_ICON[entry.level]} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${LEVEL_COLOR[entry.level]}`} />
                <span className="shrink-0 text-muted">
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
                {entry.keyLabel ? (
                  <span className="shrink-0 rounded bg-brand-soft px-1.5 font-semibold text-brand">
                    {entry.keyLabel}
                  </span>
                ) : null}
                <span className="break-words text-ink">{entry.message}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </Card>
  );
}
