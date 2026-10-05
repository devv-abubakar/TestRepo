import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { HandoutStatus } from '../types';

interface Tile {
  label: string;
  value: string;
  tone: string;
}

export function Dashboard() {
  const courses = useAppStore((state) => state.courses);
  const handouts = useAppStore((state) => state.handouts);
  const order = useAppStore((state) => state.order);
  const totalHighlights = useAppStore((state) => state.totalHighlights);

  const counts = useMemo(() => {
    const base: Record<HandoutStatus, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    };
    for (const id of order) base[handouts[id]?.status ?? 'pending'] += 1;
    return base;
  }, [handouts, order]);

  /** Pages that hold text but ended up with nothing marked, across the batch. */
  const gaps = useMemo(
    () => order.reduce((sum, id) => sum + (handouts[id]?.pagesWithoutHighlights ?? 0), 0),
    [handouts, order],
  );

  const tiles: Tile[] = [
    { label: 'Courses', value: String(courses.length), tone: 'text-ink' },
    { label: 'Handouts', value: String(order.length), tone: 'text-ink' },
    { label: 'Completed', value: String(counts.completed), tone: 'text-ok' },
    { label: 'Failed', value: String(counts.failed), tone: 'text-bad' },
    { label: 'Skipped', value: String(counts.skipped), tone: 'text-warn' },
    { label: 'Highlights', value: totalHighlights.toLocaleString(), tone: 'text-brand' },
    { label: 'Unmarked pages', value: String(gaps), tone: gaps > 0 ? 'text-warn' : 'text-muted' },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {tiles.map((tile) => (
        <div key={tile.label} className="card p-4">
          <dd className={`text-2xl font-bold tabular-nums ${tile.tone}`}>{tile.value}</dd>
          <dt className="mt-0.5 text-xs font-medium uppercase tracking-wide text-muted">{tile.label}</dt>
        </div>
      ))}
    </dl>
  );
}
