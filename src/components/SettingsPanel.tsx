import { useId } from 'react';
import { MAX_CONCURRENCY, useAppStore } from '../store/useAppStore';
import type { Importance } from '../types';
import { ApiSettings } from './ApiSettings';
import { Card, Field, Icon, Toggle } from './ui';

const IMPORTANCE_OPTIONS: { value: Importance; label: string }[] = [
  { value: 'high', label: 'High only — strictest' },
  { value: 'medium', label: 'Medium and above (recommended)' },
  { value: 'low', label: 'Everything the model returns' },
];

export function SettingsPanel() {
  const open = useAppStore((state) => state.settingsOpen);
  const toggle = useAppStore((state) => state.toggleSettings);
  const settings = useAppStore((state) => state.settings);
  const patch = useAppStore((state) => state.patchSettings);
  const running = useAppStore((state) => state.running);
  const ids = useId();

  return (
    <Card
      id="settings-panel"
      title="Settings"
      description="AI configuration, highlighting limits and output options."
      action={
        <button
          type="button"
          className="btn-secondary px-3 py-1.5 text-xs"
          onClick={() => toggle()}
          aria-expanded={open}
        >
          <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
          {open ? 'Collapse' : 'Expand'}
        </button>
      }
    >
      {open ? (
        <div className="space-y-8">
          <section aria-labelledby={`${ids}-ai`}>
            <h3 id={`${ids}-ai`} className="section-title mb-3">
              AI Configuration
            </h3>
            <ApiSettings />
          </section>

          <section aria-labelledby={`${ids}-highlight`}>
            <h3 id={`${ids}-highlight`} className="section-title mb-3">
              Highlighting
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Highlight colour" htmlFor={`${ids}-color`}>
                <div className="flex items-center gap-2">
                  <input
                    id={`${ids}-color`}
                    type="color"
                    className="h-10 w-14 cursor-pointer rounded border border-edge bg-panel"
                    value={settings.highlight.color}
                    onChange={(event) =>
                      patch({ highlight: { ...settings.highlight, color: event.target.value } })
                    }
                  />
                  <span className="font-mono text-sm text-muted">{settings.highlight.color}</span>
                </div>
              </Field>

              <Field
                label={`Opacity (${Math.round(settings.highlight.opacity * 100)}%)`}
                htmlFor={`${ids}-opacity`}
                hint="30–45% stays print-friendly and keeps the text readable."
              >
                <input
                  id={`${ids}-opacity`}
                  type="range"
                  min={0.15}
                  max={0.7}
                  step={0.01}
                  className="w-full accent-brand"
                  value={settings.highlight.opacity}
                  onChange={(event) =>
                    patch({ highlight: { ...settings.highlight, opacity: Number(event.target.value) } })
                  }
                />
              </Field>

              <Field label="Minimum importance" htmlFor={`${ids}-importance`}>
                <select
                  id={`${ids}-importance`}
                  className="field"
                  value={settings.highlight.minImportance}
                  onChange={(event) =>
                    patch({
                      highlight: {
                        ...settings.highlight,
                        minImportance: event.target.value as Importance,
                      },
                    })
                  }
                >
                  {IMPORTANCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Maximum highlights per page"
                htmlFor={`${ids}-maxper`}
                hint="0 removes the cap. The page coverage ceiling still applies."
              >
                <input
                  id={`${ids}-maxper`}
                  type="number"
                  min={0}
                  max={20}
                  className="field"
                  value={settings.highlight.maxPerPage}
                  onChange={(event) =>
                    patch({
                      highlight: { ...settings.highlight, maxPerPage: Number(event.target.value) },
                    })
                  }
                />
              </Field>

              <Field
                label={`Minimum match confidence (${Math.round(settings.highlight.minConfidence * 100)}%)`}
                htmlFor={`${ids}-confidence`}
                hint="Spans that match the handout less closely than this are logged, never highlighted."
              >
                <input
                  id={`${ids}-confidence`}
                  type="range"
                  min={0.7}
                  max={0.99}
                  step={0.01}
                  className="w-full accent-brand"
                  value={settings.highlight.minConfidence}
                  onChange={(event) =>
                    patch({
                      highlight: { ...settings.highlight, minConfidence: Number(event.target.value) },
                    })
                  }
                />
              </Field>
            </div>
          </section>

          <section aria-labelledby={`${ids}-content`}>
            <h3 id={`${ids}-content`} className="section-title mb-3">
              Added Content
            </h3>
            <div className="grid gap-3 md:grid-cols-3">
              <Toggle
                checked={settings.content.addStudyMessage}
                onChange={(addStudyMessage) => patch({ content: { ...settings.content, addStudyMessage } })}
                label="Add AI Study Message"
              />
              <Toggle
                checked={settings.content.addStudentsGuide}
                onChange={(addStudentsGuide) =>
                  patch({ content: { ...settings.content, addStudentsGuide } })
                }
                label="Add VU Students Guide"
              />
              <Toggle
                checked={settings.content.addWhatsApp}
                onChange={(addWhatsApp) => patch({ content: { ...settings.content, addWhatsApp } })}
                label="Add WhatsApp Contact"
              />
            </div>
          </section>

          <section aria-labelledby={`${ids}-output`}>
            <h3 id={`${ids}-output`} className="section-title mb-3">
              Output
            </h3>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Filename suffix" htmlFor={`${ids}-suffix`}>
                <input
                  id={`${ids}-suffix`}
                  className="field font-mono"
                  value={settings.output.suffix}
                  onChange={(event) =>
                    patch({ output: { ...settings.output, suffix: event.target.value } })
                  }
                />
              </Field>
              <Field
                label="Documents at a time"
                htmlFor={`${ids}-concurrency`}
                hint={`1–${MAX_CONCURRENCY} documents. Raise it when the key pool has spare capacity.`}
              >
                <input
                  id={`${ids}-concurrency`}
                  type="number"
                  min={1}
                  max={MAX_CONCURRENCY}
                  className="field"
                  disabled={running}
                  value={settings.output.concurrency}
                  onChange={(event) =>
                    patch({ output: { ...settings.output, concurrency: Number(event.target.value) } })
                  }
                />
              </Field>
              <div className="flex items-end">
                <Toggle
                  checked={settings.output.reprocessExisting}
                  onChange={(reprocessExisting) =>
                    patch({ output: { ...settings.output, reprocessExisting } })
                  }
                  label="Re-process existing outputs"
                  hint="Off: handouts that already have an output file are skipped."
                />
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </Card>
  );
}
