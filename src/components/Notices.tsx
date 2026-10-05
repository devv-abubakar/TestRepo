import { useEffect, useState } from 'react';
import { AI_NOTICE, PRIVACY_NOTICE } from '../constants';
import { useAppStore } from '../store/useAppStore';
import { isFileSystemAccessSupported } from '../services/filesystem';
import { Icon, LEVEL_COLOR, LEVEL_ICON } from './ui';

export function Banner() {
  const banner = useAppStore((state) => state.banner);
  const dismiss = useAppStore((state) => state.dismissBanner);
  if (!banner) return null;
  return (
    <div className="card flex items-start gap-3 p-4" role="status">
      <Icon name={LEVEL_ICON[banner.level]} className={`mt-0.5 h-5 w-5 ${LEVEL_COLOR[banner.level]}`} />
      <p className="flex-1 text-sm text-ink">{banner.message}</p>
      <button type="button" className="btn-ghost" onClick={dismiss} aria-label="Dismiss message">
        <Icon name="close" />
      </button>
    </div>
  );
}

export function ResumeOffer() {
  const offer = useAppStore((state) => state.resumeOffer);
  const resume = useAppStore((state) => state.resumeSession);
  const startOver = useAppStore((state) => state.startOver);
  if (!offer) return null;

  return (
    <div className="card border-brand/40 bg-brand-soft/60 p-5" role="region" aria-label="Previous session">
      <h2 className="text-base font-semibold text-ink">Previous session detected</h2>
      <p className="mt-1 text-sm text-ink/80">
        Folder <strong>{offer.rootName}</strong> — {offer.completed} handouts already completed,{' '}
        {offer.failed} failed, {offer.remaining} remaining. Completed handouts are never processed twice.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => void resume()}>
          <Icon name="retry" />
          Resume Processing
        </button>
        <button type="button" className="btn-secondary" onClick={() => void startOver()}>
          Start Over
        </button>
      </div>
    </div>
  );
}

export function EnvironmentNotices() {
  const [narrow, setNarrow] = useState(false);
  const supported = isFileSystemAccessSupported();

  useEffect(() => {
    const query = window.matchMedia('(max-width: 820px)');
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {narrow ? (
        <p className="card p-4 text-sm text-ink">
          <Icon name="info" className="mr-2 inline h-4 w-4 text-brand" />
          For processing large batches of handouts, please use a desktop/laptop browser.
        </p>
      ) : null}
      {!supported ? (
        <p className="card p-4 text-sm text-ink">
          <Icon name="alert" className="mr-2 inline h-4 w-4 text-warn" />
          This browser cannot open folders directly. Use the fallback folder picker — processing works the
          same way, but outputs arrive as downloads instead of being written back into the course folders.
          Chrome or Edge on desktop gives the full experience.
        </p>
      ) : null}
      <p className="card p-4 text-xs text-muted">{PRIVACY_NOTICE}</p>
      <p className="card p-4 text-xs text-muted">{AI_NOTICE}</p>
    </div>
  );
}

export function ConfirmDialog() {
  const confirm = useAppStore((state) => state.confirm);
  const cancel = useAppStore((state) => state.cancelConfirm);
  const start = useAppStore((state) => state.startProcessing);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, cancel]);

  if (!confirm) return null;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 p-4">
      <div
        className="card w-full max-w-md p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-ink">
          Ready to process
        </h2>
        <dl className="mt-4 space-y-1.5 text-sm">
          {[
            ['Courses', confirm.courses],
            ['Handouts', confirm.handouts],
            ['Existing outputs', confirm.existingOutputs],
            ['Queued now', confirm.toProcess],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-4">
              <dt className="text-muted">{label}</dt>
              <dd className="font-semibold tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <dl className="mt-3 space-y-1.5 border-t border-edge pt-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Coverage mode</dt>
            <dd className="font-semibold capitalize text-ink">{confirm.coverage}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">AI requests per ~12,000 characters</dt>
            <dd className="font-semibold tabular-nums text-ink">{confirm.passesPerChunk}</dd>
          </div>
          {confirm.poolCapacityToday !== null ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Requests left in the key pool today</dt>
              <dd className="font-semibold tabular-nums text-ink">
                {confirm.poolCapacityToday.toLocaleString()}
              </dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-3 text-xs text-muted">
          A 20-page handout is roughly {confirm.passesPerChunk * 3} requests in this mode. If the pool
          runs out, completed handouts are kept and you can resume once the quota resets.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => void start()} autoFocus>
            <Icon name="play" />
            Start Processing
          </button>
        </div>
      </div>
    </div>
  );
}
