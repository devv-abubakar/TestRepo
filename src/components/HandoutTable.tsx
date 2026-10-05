import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Card, Icon, StatusChip } from './ui';

export function HandoutTable() {
  const order = useAppStore((state) => state.order);
  const handouts = useAppStore((state) => state.handouts);
  const selected = useAppStore((state) => state.selectedCourse);
  const downloadOne = useAppStore((state) => state.downloadOne);
  const preview = useAppStore((state) => state.previewHandout);

  const rows = useMemo(
    () =>
      order
        .map((id) => handouts[id])
        .filter((handout) => handout !== undefined)
        .filter((handout) => selected === null || handout.courseCode === selected),
    [order, handouts, selected],
  );

  if (order.length === 0) return null;

  return (
    <Card
      id="handouts"
      title="Handouts"
      description={
        selected ? `Showing ${selected} only — click the course again to clear the filter.` : undefined
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <caption className="sr-only">Handout processing status</caption>
          <thead>
            <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">Course</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Handout</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Status</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Highlights</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">Pages</th>
              <th scope="col" className="py-2 font-semibold">Output</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {rows.map((handout) => (
              <tr key={handout.id} className="align-top">
                <td className="py-2.5 pr-3 font-medium text-ink">{handout.courseCode}</td>
                <td className="py-2.5 pr-3">
                  <span className="text-ink">{handout.fileName}</span>
                  {handout.usedOcr ? (
                    <span className="chip ml-2 bg-warn/15 text-warn">OCR</span>
                  ) : null}
                  {handout.error ? (
                    <span className="mt-1 block max-w-md text-xs text-bad">{handout.error}</span>
                  ) : null}
                  {handout.lowConfidenceSkipped > 0 ? (
                    <span className="mt-1 block text-xs text-muted">
                      {handout.lowConfidenceSkipped} low-confidence span(s) not highlighted
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-3">
                  <StatusChip status={handout.status} />
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-ink">
                  {handout.status === 'completed' ? handout.highlightCount : '—'}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-muted">
                  {handout.pageCount > 0 ? handout.pageCount : '—'}
                </td>
                <td className="py-2.5">
                  {handout.status === 'completed' ? (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="btn-secondary px-2.5 py-1 text-xs"
                        onClick={() => void downloadOne(handout.id)}
                      >
                        <Icon name="download" className="h-3.5 w-3.5" />
                        Download PDF
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-2.5 py-1 text-xs"
                        onClick={() => preview(handout.id)}
                      >
                        <Icon name="eye" className="h-3.5 w-3.5" />
                        Preview
                      </button>
                      {handout.outputMode === 'written' ? (
                        <span className="chip bg-ok/10 text-ok">Saved to folder</span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
