import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { ProcessingStage } from '../types';
import { Card, Icon, ProgressBar } from './ui';

const STAGE_LABEL: Record<ProcessingStage, string> = {
  idle: 'Waiting',
  reading: 'Reading the file…',
  extracting: 'Extracting PDF text…',
  ocr: 'Running OCR on scanned pages…',
  analyzing: 'Analyzing important content…',
  matching: 'Matching text to page coordinates…',
  highlighting: 'Applying yellow highlights…',
  annotating: 'Adding student information and links…',
  validating: 'Validating the output PDF…',
  saving: 'Saving the highlighted PDF…',
  done: 'Finished',
};

export function ProgressPanel() {
  const order = useAppStore((state) => state.order);
  const handouts = useAppStore((state) => state.handouts);
  const progress = useAppStore((state) => state.progress);
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

  const overall = stats.total === 0 ? 0 : (stats.settled + stats.failed) / stats.total;
  const docProgress =
    progress.pageCount > 0 ? Math.min(1, progress.page / progress.pageCount) : running ? 0.05 : 0;

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
            <span className="font-medium text-ink">
              Overall · {Math.round(overall * 100)}%
            </span>
            <span className="tabular-nums text-muted">
              {stats.settled + stats.failed} / {stats.total} processed · {stats.remaining} remaining
            </span>
          </div>
          <ProgressBar value={overall} label="Overall batch progress" />
        </div>

        <div className="rounded-lg border border-edge bg-surface/60 p-4">
          <h3 className="section-title">Current Handout</h3>
          {progress.handoutId ? (
            <>
              <p className="mt-2 text-sm text-ink">
                <strong>{progress.courseCode}</strong> · {progress.handoutName}
                {progress.pageCount > 0 ? (
                  <span className="text-muted">
                    {' '}
                    · page {progress.page} / {progress.pageCount}
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-brand">{STAGE_LABEL[progress.stage]}</p>
              <div className="mt-2">
                <ProgressBar value={docProgress} label="Current handout progress" />
              </div>
            </>
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
