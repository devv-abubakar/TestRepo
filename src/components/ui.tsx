/** Small shared presentational pieces and inline icons. */
import type { ReactNode } from 'react';
import type { HandoutStatus, LogLevel } from '../types';

export function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export type IconName =
  | 'folder'
  | 'play'
  | 'stop'
  | 'download'
  | 'retry'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'check'
  | 'alert'
  | 'info'
  | 'chevron'
  | 'eye'
  | 'close'
  | 'spark'
  | 'external';

const PATHS: Record<IconName, ReactNode> = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h3.6l2 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  play: <path d="M7 4.8v14.4L19.5 12Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  download: <path d="M12 3v12m0 0 4.5-4.5M12 15 7.5 10.5M4 20h16" />,
  retry: <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3m0 13v3M4.2 7l2.6 1.5m10.4 6L19.8 16M4.2 16l2.6-1.5m10.4-6L19.8 7" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  check: <path d="M4.5 12.5 9 17l10.5-10.5" />,
  alert: (
    <>
      <path d="M12 4 2.8 20h18.4Z" />
      <path d="M12 10v4.5m0 2.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8.5v.01" />
    </>
  ),
  chevron: <path d="m8 10 4 4 4-4" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  spark: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />,
  external: <path d="M14 4h6v6m0-6-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
};

export function Card({
  title,
  description,
  action,
  children,
  id,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="card animate-fade-in p-5" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold text-ink">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

const STATUS_STYLES: Record<HandoutStatus, string> = {
  pending: 'bg-edge/60 text-muted',
  processing: 'bg-brand-soft text-brand',
  completed: 'bg-ok/15 text-ok',
  failed: 'bg-bad/15 text-bad',
  skipped: 'bg-warn/15 text-warn',
};

const STATUS_LABELS: Record<HandoutStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function StatusChip({ status }: { status: HandoutStatus }) {
  return <span className={`chip ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.min(100, Math.max(0, Math.round(value * 100)));
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2.5 w-full overflow-hidden rounded-full bg-edge/70"
    >
      <div
        className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-edge accent-brand"
      />
      <span>
        {label}
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const LEVEL_ICON: Record<LogLevel, IconName> = {
  info: 'info',
  success: 'check',
  warn: 'alert',
  error: 'alert',
};

export const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'text-muted',
  success: 'text-ok',
  warn: 'text-warn',
  error: 'text-bad',
};
