import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { ProcessingProgress, ProcessingStage } from '../types';
import { Card, Icon, ProgressBar } from './ui';

const STAGE_LABEL: Record<ProcessingStage, string> = {
  idle: 'Waiting',
  reading: 'Reading the file',
  extracting: 'Extracting PDF text',
  ocr: 'Running OCR on scanned pages',
  analyzing: 'Analyzing important content',
  matching: 'Matching text to page coordinates',
  highlighting: 'Applying yellow highlights',
  annotating: 'Adding student information and links',
  validating: 'Validating the output PDF',
  saving: 'Saving the highlighted PDF',
  done: 'Finished',
};

/**
 * Progress within one handout. During analysis the chunk counter is the honest
 * measure; before it, page extraction is.
 */
function documentProgress(progress: ProcessingProgress): number {
  if (progress.chunksTotal > 0) {
    const analysed = progress.chunksDone / progress.chunksTotal;
    // Extraction is roughly the first third of the work on a handout.
    return 0.3 + analysed * 0.6;
  }
  if (progress.pageCount > 0 && progress.page > 0) {
    return Math.min(0.3, (progress.page / progress.pageCount) * 0.3);
  }
  return 0.02;
}

function elapsed(since: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function ActiveRow({ progress }: { progress: ProcessingProgress }) {
  return (
    <li className="rounded-lg border border-edge bg-surface/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          <span className="font-semibold">{progress.courseCode}</span> · {progress.handoutName}
        </p>
        <p className="text-xs tabular-nums text-muted">
          {progress.pageCount > 0 ? `page ${Math.max(progress.page, 1)} / ${progress.pageCount}` : '—'}
          {progress.chunksTotal > 0 ? ` · part ${progress.chunksDone}/${progress.chunksTotal}` : ''}
          {` · ${elapsed(progress.startedAt)}`}
        </p>
      </div>
      <p className="mt-1 text-sm text-brand">{progress.detail || STAGE_LABEL[progress.stage]}</p>
      <div className="mt-2">
        <ProgressBar
          value={documentProgress(progress)}
          label={`Progress for ${progress.handoutName}`}
        />
      </div>
    </li>
  );
}

export function ProgressPanel() {
  const order = useAppStore((state) => state.order);
  const handouts = useAppStore((state) => state.handouts);
  const active = useAppStore((state) => state.active);
  const running = useAppStore((state) => state.running);
  const stopping = useAppStore((state) => state.stopping);
  const requestStart = useAppStore((state) => state.requestStart);
  const stopProcessing = useAppStore((state) => state.stopProcessing);
  const retryFailed = useAppStore((state) => state.retryFailed);

  const stats = useMemo(() => {
    let settled = 0;
    let failed = 0;
    for (const id of order) {
      const status = handouts[id]?.status;
      if (status === 'completed' || status === 'skipped') settled += 1;
      if (status === 'failed') failed += 1;
    }
    return { settled, failed, total: order.length, remaining: order.length - settled - failed };
  }, [handouts, order]);

  const rows = Object.values(active);
  const overall = stats.total === 0 ? 0 : (stats.settled + stats.failed) / stats.total;

  return (
    <Card
      id="progress"
      title="Processing Dashboard"
      description="Progress is calculated from the real queue, never simulated."
      action={
        <div className="flex flex-wrap gap-2">
          {running ? (
            <button type="button" className="btn-danger" onClick={stopProcessing} disabled={stopping}>
              <Icon name="stop" />
              {stopping ? 'Stopping…' : 'Stop Processing'}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={requestStart}
              disabled={stats.total === 0}
            >
              <Icon name="play" />
              Process All Handouts
            </button>
          )}
          {stats.failed > 0 && !running ? (
            <button type="button" className="btn-secondary" onClick={() => void retryFailed()}>
              <Icon name="retry" />
              Retry Failed ({stats.failed})
            </button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-medium text-ink">Overall · {Math.round(overall * 100)}%</span>
            <span className="tabular-nums text-muted">
              {stats.settled + stats.failed} / {stats.total} processed · {stats.remaining} remaining
            </span>
          </div>
          <ProgressBar value={overall} label="Overall batch progress" />
        </div>

        <div>
          <h3 className="section-title">
            Current Handouts{rows.length > 1 ? ` (${rows.length} in parallel)` : ''}
          </h3>
          {rows.length > 0 ? (
            <ul className="mt-2 space-y-2" role="list">
              {rows.map((progress) => (
                <ActiveRow key={progress.handoutId} progress={progress} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {running ? 'Starting the next handout…' : 'Idle — nothing is being processed.'}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
