import { AlertCircle, Info, X } from 'lucide-react';
import { useProject } from '../store/useProject';

export function Notices() {
  const notices = useProject((s) => s.notices);
  const busy = useProject((s) => s.busy);
  const dismiss = useProject((s) => s.dismiss);

  if (notices.length === 0 && !busy) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
      {busy && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/[0.08] bg-ink-850/95 px-4 py-2.5 shadow-lift backdrop-blur">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full rounded-full bg-brand-400 transition-all"
              style={{ width: `${busy.total === 0 ? 0 : (busy.done / busy.total) * 100}%` }}
            />
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-ink-300">
            {busy.label} {busy.done}/{busy.total}
          </span>
        </div>
      )}

      {notices.map((notice) => (
        <div
          key={notice.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-2.5 shadow-lift backdrop-blur animate-fade-up ${
            notice.kind === 'error'
              ? 'border-red-500/25 bg-red-950/85'
              : 'border-white/[0.08] bg-ink-850/95'
          }`}
        >
          {notice.kind === 'error' ? (
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
          ) : (
            <Info size={14} className="mt-0.5 shrink-0 text-brand-300" />
          )}
          <p className="flex-1 text-[11.5px] leading-snug text-ink-200">{notice.message}</p>
          <button
            type="button"
            onClick={() => dismiss(notice.id)}
            className="shrink-0 rounded p-0.5 text-ink-500 transition hover:text-ink-100"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
