/**
 * Preview of a generated output, rendered with pdf.js.
 *
 * Pages are rendered in small batches: a 40-page handout must not put forty
 * canvases on the heap just because someone clicked Preview.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getOutput } from '../services/persist';
import { openPdf, type PdfDocument } from '../services/pdf/pdfjs';
import { releaseCanvas, renderPage } from '../services/pdf/render';
import { Icon } from './ui';

const BATCH = 3;

export function PdfPreview() {
  const handoutId = useAppStore((state) => state.previewHandoutId);
  const close = useAppStore((state) => state.previewHandout);
  const handout = useAppStore((state) => (handoutId ? state.handouts[handoutId] : undefined));

  const hostRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfDocument | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [shown, setShown] = useState(0);
  const [pageCount, setPageCount] = useState(0);

  const renderRange = useCallback(async (from: number, to: number) => {
    const doc = docRef.current;
    const host = hostRef.current;
    if (!doc || !host) return;
    for (let n = from; n <= to; n += 1) {
      const page = await doc.getPage(n);
      try {
        const raster = await renderPage(page, 1.25);
        raster.canvas.className = 'mx-auto w-full max-w-3xl rounded border border-edge shadow-card';
        raster.canvas.setAttribute('role', 'img');
        raster.canvas.setAttribute('aria-label', `Page ${n}`);
        const wrapper = document.createElement('figure');
        wrapper.className = 'space-y-1';
        const caption = document.createElement('figcaption');
        caption.className = 'text-center text-xs text-muted';
        caption.textContent = `Page ${n}`;
        wrapper.append(caption, raster.canvas);
        host.append(wrapper);
      } finally {
        page.cleanup();
      }
    }
  }, []);

  useEffect(() => {
    if (!handoutId) return;
    let cancelled = false;
    setStatus('loading');
    setShown(0);

    void (async () => {
      try {
        const output = await getOutput(handoutId);
        if (!output) throw new Error('This output is no longer cached in the browser.');
        const doc = await openPdf(output.bytes.slice());
        if (cancelled) {
          await doc.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
        const upto = Math.min(BATCH, doc.numPages);
        await renderRange(1, upto);
        if (cancelled) return;
        setShown(upto);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : 'Preview failed.');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      const host = hostRef.current;
      if (host) {
        for (const canvas of host.querySelectorAll('canvas')) releaseCanvas(canvas);
        host.replaceChildren();
      }
      const doc = docRef.current;
      docRef.current = null;
      void doc?.destroy().catch(() => undefined);
    };
  }, [handoutId, renderRange]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(null);
    };
    if (handoutId) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handoutId, close]);

  if (!handoutId) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/55 p-3 sm:p-6">
      <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">PDF Preview</h2>
            <p className="text-xs text-muted">
              {handout ? `${handout.courseCode} / ${handout.outputName ?? handout.fileName}` : ''}
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => close(null)}>
            <Icon name="close" />
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-4 py-4">
          {status === 'loading' ? <p className="text-sm text-muted">Rendering preview…</p> : null}
          {status === 'error' ? <p className="text-sm text-bad">{message}</p> : null}
          <div ref={hostRef} className="space-y-5" />
          {status === 'ready' && shown < pageCount ? (
            <div className="mt-5 text-center">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const next = Math.min(shown + BATCH, pageCount);
                  void renderRange(shown + 1, next).then(() => setShown(next));
                }}
              >
                Show more pages ({shown} / {pageCount})
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
