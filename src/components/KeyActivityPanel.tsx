/**
 * Live state of the API key pool: which key is working on what, how much of
 * each key's quota is gone, and which keys are resting after a rate limit.
 */
import { useEffect, useState } from 'react';
import { providerMeta } from '../services/ai';
import { useAppStore } from '../store/useAppStore';
import type { KeyStatus } from '../types';
import { Card, Icon } from './ui';

const STATUS_STYLE: Record<KeyStatus, string> = {
  idle: 'bg-edge/60 text-muted',
  active: 'bg-brand-soft text-brand',
  cooling: 'bg-warn/15 text-warn',
  exhausted: 'bg-warn/20 text-warn',
  disabled: 'bg-bad/15 text-bad',
};

const STATUS_LABEL: Record<KeyStatus, string> = {
  idle: 'Ready',
  active: 'Working',
  cooling: 'Resting',
  exhausted: 'Quota used',
  disabled: 'Disabled',
};

export function KeyActivityPanel() {
  const stats = useAppStore((state) => state.keyStats);
  const ai = useAppStore((state) => state.settings.ai);
  const running = useAppStore((state) => state.running);
  const [, tick] = useState(0);

  // A cooldown countdown has to move on its own, so re-render while resting.
  const resting = stats.some((row) => row.cooldownUntil > Date.now());
  useEffect(() => {
    if (!running && !resting) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running, resting]);

  if (!providerMeta(ai.provider).browserDirect || stats.length === 0) return null;

  const totals = stats.reduce(
    (acc, row) => ({
      requests: acc.requests + row.requests,
      succeeded: acc.succeeded + row.succeeded,
      failed: acc.failed + row.failed,
      rateLimited: acc.rateLimited + row.rateLimited,
    }),
    { requests: 0, succeeded: 0, failed: 0, rateLimited: 0 },
  );

  return (
    <Card
      id="keys"
      title="API Key Activity"
      description={`${stats.length} key(s) in the pool · ${totals.succeeded} successful request(s), ${totals.failed} failed, ${totals.rateLimited} rate-limited.`}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">Live API key pool status</caption>
          <thead>
            <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">Key</th>
              <th scope="col" className="py-2 pr-3 font-semibold">State</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Working on</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Today</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">OK</th>
              <th scope="col" className="py-2 text-right font-semibold">Issues</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {stats.map((row) => {
              const resting = Math.max(0, Math.ceil((row.cooldownUntil - Date.now()) / 1000));
              const budget = ai.dailyBudgetPerKey;
              return (
                <tr key={row.id} className="align-top">
                  <td className="py-2.5 pr-3 font-medium text-ink">{row.label}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`chip ${STATUS_STYLE[row.status]}`}>
                      {STATUS_LABEL[row.status]}
                      {resting > 0 && row.status === 'cooling' ? ` ${resting}s` : ''}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-muted">
                    {row.task ? <span className="text-ink">{row.task}</span> : '—'}
                    {row.lastError && row.status !== 'active' ? (
                      <span className="mt-0.5 block max-w-sm text-xs text-bad">
                        {row.lastError.slice(0, 140)}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-ink">
                    {budget > 0 ? `${row.usedToday} / ${budget}` : row.usedToday}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-ok">{row.succeeded}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted">
                    {row.failed > 0 ? <span className="text-bad">{row.failed}</span> : 0}
                    {row.rateLimited > 0 ? (
                      <span className="text-warn"> · {row.rateLimited} limited</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {stats.every((row) => row.status === 'disabled' || row.status === 'exhausted') ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-warn">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          Every key is out of quota or disabled. Add another key, or wait for the daily quota to reset.
        </p>
      ) : null}
    </Card>
  );
}
