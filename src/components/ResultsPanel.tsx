import { useMemo } from 'react';
import { PLAY_STORE_URL } from '../constants';
import { useAppStore } from '../store/useAppStore';
import { Card, Icon } from './ui';

export function ResultsPanel() {
  const order = useAppStore((state) => state.order);
  const handouts = useAppStore((state) => state.handouts);
  const totalHighlights = useAppStore((state) => state.totalHighlights);
  const downloadAll = useAppStore((state) => state.downloadAll);
  const retryFailed = useAppStore((state) => state.retryFailed);
  const zipping = useAppStore((state) => state.zipping);
  const running = useAppStore((state) => state.running);

  const summary = useMemo(() => {
    const rows = order.map((id) => handouts[id]).filter((row) => row !== undefined);
    return {
      total: rows.length,
      completed: rows.filter((row) => row.status === 'completed').length,
      failed: rows.filter((row) => row.status === 'failed'),
      skipped: rows.filter((row) => row.status === 'skipped').length,
    };
  }, [order, handouts]);

  if (summary.total === 0) return null;

  return (
    <Card
      id="results"
      title="Results"
      description="Download All Highlighted Handouts — the ZIP keeps your course folder structure."
    >
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ['Total', summary.total],
          ['Completed', summary.completed],
          ['Failed', summary.failed.length],
          ['Total highlights', totalHighlights.toLocaleString()],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-edge bg-surface/60 p-3">
            <dd className="text-lg font-semibold tabular-nums text-ink">{value}</dd>
            <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          onClick={() => void downloadAll()}
          disabled={summary.completed === 0 || zipping !== null}
        >
          <Icon name="download" />
          {zipping ? `Packaging ${zipping.done}/${zipping.total}…` : 'Download All ZIP'}
        </button>
        {summary.failed.length > 0 ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void retryFailed()}
            disabled={running}
          >
            <Icon name="retry" />
            Retry Failed ({summary.failed.length})
          </button>
        ) : null}
      </div>

      {summary.failed.length > 0 ? (
        <div className="mt-5">
          <h3 className="section-title">Failed Handouts</h3>
          <ul className="mt-2 space-y-1.5 text-sm" role="list">
            {summary.failed.map((handout) => (
              <li key={handout.id} className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2">
                <span className="font-medium text-ink">
                  {handout.courseCode} / {handout.fileName}
                </span>
                <span className="mt-0.5 block text-xs text-bad">{handout.error}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 rounded-lg border border-edge bg-surface/60 p-4 text-sm">
        <p className="font-semibold text-ink">For VU Students — VU Students Guide</p>
        <p className="mt-1 text-muted">
          Every highlighted handout carries a clickable link to the VU Students Guide app and the
          bookshop WhatsApp contact.
        </p>
        <a
          className="mt-2 inline-flex items-center gap-1 font-medium text-brand underline"
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open VU Students Guide on Google Play
          <Icon name="external" className="h-3.5 w-3.5" />
        </a>
      </div>
    </Card>
  );
}
