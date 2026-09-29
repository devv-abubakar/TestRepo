import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Info, Package } from 'lucide-react';
import { downloadBlob, exportAll, type ExportFormat } from '../core/export';
import { PRESETS, hasBlockingError, validateProject } from '../core/playstore';
import { translate } from '../i18n';
import { useProject } from '../store/useProject';
import { Button, Field, Panel, Segmented } from './ui';

export function ExportPanel() {
  const project = useProject((s) => s.project);
  const images = useProject((s) => s.images);
  const crops = useProject((s) => s.crops);
  const lang = useProject((s) => s.lang);
  const notify = useProject((s) => s.notify);
  const setActive = useProject((s) => s.setActive);

  const [format, setFormat] = useState<ExportFormat>('png24');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const preset = PRESETS[project.presetId];
  const findings = useMemo(() => validateProject(project), [project]);
  const blocked = hasBlockingError(findings);

  const run = async () => {
    setProgress({ done: 0, total: project.slides.length });
    try {
      const imageMap = new Map(Object.entries(images));
      const result = await exportAll(project, imageMap, crops, {
        format,
        onProgress: (done, total) => setProgress({ done, total }),
      });

      // A PNG that did not come out as colour type 2 would be rejected by Play
      // for carrying alpha. Catch it here rather than let the user find out.
      if (format === 'png24') {
        const bad = result.assets.find((a) => a.colorType !== 2);
        if (bad) {
          notify('error', `${bad.filename} was not written as a 24-bit PNG. Export stopped.`);
          return;
        }
      }

      downloadBlob(result.blob, result.filename);
      notify('info', `${result.assets.length} files downloaded as ${result.filename}`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <Panel title={t('export.checklist')}>
        <ul className="space-y-2">
          {findings.map((finding, i) => {
            const Icon =
              finding.severity === 'error'
                ? AlertTriangle
                : finding.severity === 'warning'
                  ? Info
                  : CheckCircle2;
            const tone =
              finding.severity === 'error'
                ? 'text-red-400'
                : finding.severity === 'warning'
                  ? 'text-amber-400'
                  : 'text-emerald-400';
            return (
              <li key={`${finding.code}-${i}`} className="flex gap-2">
                <Icon size={13} className={`mt-0.5 shrink-0 ${tone}`} />
                <button
                  type="button"
                  onClick={() => finding.slide !== undefined && setActive(finding.slide)}
                  className={`text-left text-[11px] leading-snug text-ink-300 ${
                    finding.slide !== undefined ? 'hover:text-ink-50 hover:underline' : 'cursor-default'
                  }`}
                >
                  {finding.slide !== undefined && (
                    <span className="mr-1 font-bold text-ink-500">#{finding.slide + 1}</span>
                  )}
                  {finding.message}
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title={t('export.format')}>
        <Segmented
          label={t('export.format')}
          value={format}
          onChange={setFormat}
          options={[
            { value: 'png24', label: 'PNG', title: t('export.png') },
            { value: 'jpeg', label: 'JPEG', title: t('export.jpeg') },
          ]}
        />

        <p className="text-[10px] leading-relaxed text-ink-400">
          {format === 'png24'
            ? 'Written as a true 24-bit PNG with the alpha channel removed, which is what Play asks for. A canvas always produces RGBA, so this is encoded here rather than by the browser.'
            : 'Smaller files, slight quality loss on flat colour and text. Accepted by Play.'}
        </p>

        <Field label="Output" hint={`${preset.width}×${preset.height}`}>
          <div className="rounded-xl border border-white/[0.07] bg-ink-900/60 px-3 py-2 text-[11px] text-ink-300">
            {project.slides.length} × {preset.label}
            <span className="mt-0.5 block text-ink-500">{preset.hint}</span>
          </div>
        </Field>

        <Button variant="primary" full disabled={blocked || progress !== null} onClick={() => void run()}>
          {progress ? (
            <>
              <Package size={14} /> {progress.done}/{progress.total}
            </>
          ) : (
            <>
              <Download size={14} /> {t('action.exportAll')}
            </>
          )}
        </Button>

        {blocked && (
          <p className="text-[10px] font-semibold text-red-400">
            Fix the errors above before exporting.
          </p>
        )}
      </Panel>
    </>
  );
}
