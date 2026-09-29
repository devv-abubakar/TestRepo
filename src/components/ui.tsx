import type { ReactNode } from 'react';

export function Panel({
  title,
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-ink-850/70 shadow-panel backdrop-blur-sm">
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-3">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">{title}</h3>
          {action}
        </header>
      )}
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-semibold text-ink-200">
          {label}
        </label>
        {hint && <span className="text-[10px] tabular-nums text-ink-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

interface Option<T> {
  value: T;
  label: string;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1 rounded-xl border border-white/[0.06] bg-ink-900/80 p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title ?? option.label}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
              active
                ? 'bg-brand-500 text-white shadow-[0_2px_10px_-2px_rgba(51,93,255,0.8)]'
                : 'text-ink-300 hover:bg-white/[0.05] hover:text-ink-100'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-700 accent-brand-400 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand-400 [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(51,93,255,0.22)]"
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${
        checked ? 'bg-brand-500' : 'bg-ink-700'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-semibold text-ink-200">{label}</span>
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  full,
  title,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  full?: boolean;
  title?: string;
  type?: 'button' | 'submit';
}) {
  const styles: Record<string, string> = {
    primary:
      'bg-brand-500 text-white hover:bg-brand-400 shadow-[0_6px_20px_-8px_rgba(51,93,255,0.9)] disabled:bg-ink-700 disabled:text-ink-400 disabled:shadow-none',
    secondary:
      'bg-white/[0.06] text-ink-100 hover:bg-white/[0.11] border border-white/[0.07] disabled:text-ink-500',
    ghost: 'text-ink-300 hover:bg-white/[0.06] hover:text-ink-100 disabled:text-ink-600',
    danger: 'text-red-300 hover:bg-red-500/12 hover:text-red-200',
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed ${
        styles[variant]
      } ${full ? 'w-full' : ''}`}
    >
      {children}
    </button>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  id,
  maxLength,
  dir,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  maxLength?: number;
  dir?: 'ltr' | 'rtl' | 'auto';
}) {
  return (
    <input
      id={id}
      dir={dir ?? 'auto'}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-white/[0.07] bg-ink-900/80 px-3 py-2 text-sm text-ink-50 outline-none transition placeholder:text-ink-500 focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20"
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  id,
  rows = 2,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <textarea
      id={id}
      dir="auto"
      rows={rows}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-none rounded-xl border border-white/[0.07] bg-ink-900/80 px-3 py-2 text-sm leading-snug text-ink-50 outline-none transition placeholder:text-ink-500 focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20"
    />
  );
}
