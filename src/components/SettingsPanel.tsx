import { useId } from 'react';
import { PASSES_PER_CHUNK } from '../store/defaults';
import { MAX_CONCURRENCY, useAppStore } from '../store/useAppStore';
import type { CoverageMode, Importance } from '../types';
import { ApiSettings } from './ApiSettings';
import { Card, Field, Icon, Toggle } from './ui';

const IMPORTANCE_OPTIONS: { value: Importance; label: string }[] = [
  { value: 'high', label: 'High only — strictest' },
  { value: 'medium', label: 'Medium and above' },
  { value: 'low', label: 'Everything the model returns' },
];

const COVERAGE_OPTIONS: {
  value: CoverageMode;
  title: string;
  detail: string;
}[] = [
  {
    value: 'selective',
    title: 'Selective',
    detail:
      'One AI pass. The cleanest-looking page, but it will leave some definitions unmarked.',
  },
  {
    value: 'balanced',
    title: 'Balanced',
    detail:
      'Two AI passes — a first pass plus a gap sweep — and the rule-based definition sweep.',
  },
  {
    value: 'complete',
    title: 'Complete (recommended for revision)',
    detail:
      'Three AI passes: first pass, gap sweep, then a structured sweep for every definition, ' +
      'formula and classification. Plus the rule-based sweep and loosened caps. Marks the most, ' +
      'and costs about three times the AI requests.',
  },
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

          <section aria-labelledby={`${ids}-coverage`}>
            <h3 id={`${ids}-coverage`} className="section-title mb-3">
              How much to highlight
            </h3>
            <fieldset className="grid gap-2 md:grid-cols-3">
              <legend className="sr-only">Coverage mode</legend>
              {COVERAGE_OPTIONS.map((option) => {
                const active = settings.highlight.coverage === option.value;
                return (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-lg border p-3 text-sm transition-colors ${
                      active ? 'border-brand bg-brand-soft' : 'border-edge bg-panel hover:bg-surface'
                    }`}
                  >
                    <span className="flex items-start gap-2">
                      <input
                        type="radio"
                        name={`${ids}-coverage-mode`}
                        className="mt-1 accent-brand"
                        checked={active}
                        onChange={() =>
                          patch({ highlight: { ...settings.highlight, coverage: option.value } })
                        }
                      />
                      <span>
                        <span className="block font-semibold text-ink">{option.title}</span>
                        <span className="mt-0.5 block text-xs text-muted">{option.detail}</span>
                        <span className="mt-1 block text-xs font-medium text-brand">
                          ~{PASSES_PER_CHUNK[option.value]} AI request(s) per ~12,000 characters
                        </span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <p className="mt-3 text-xs text-muted">
              Even in Complete mode, highlights are study guidance rather than a guarantee: every
              output carries a note asking students to review the full handout. Use the coverage
              figures in the handout table to spot pages that received nothing.
            </p>
          </section>

          <section aria-labelledby={`${ids}-highlight`}>
            <h3 id={`${ids}-highlight`} className="section-title mb-3">
              Highlighting — advanced
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
                label={`Page coverage ceiling (${Math.round(settings.highlight.pageCoverageCeiling * 100)}%)`}
                htmlFor={`${ids}-ceiling`}
                hint="The most of a page's text that may be marked. The real guard against a wall of yellow."
              >
                <input
                  id={`${ids}-ceiling`}
                  type="range"
                  min={0.2}
                  max={0.95}
                  step={0.05}
                  className="w-full accent-brand"
                  value={settings.highlight.pageCoverageCeiling}
                  onChange={(event) =>
                    patch({
                      highlight: {
                        ...settings.highlight,
                        pageCoverageCeiling: Number(event.target.value),
                      },
                    })
                  }
                />
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

              <div className="flex items-end">
                <Toggle
                  checked={settings.highlight.ruleBasedSweep}
                  onChange={(ruleBasedSweep) =>
                    patch({ highlight: { ...settings.highlight, ruleBasedSweep } })
                  }
                  label="Rule-based definition sweep"
                  hint="Marks sentences carrying definition, formula and classification cues even when the model skipped them. Costs no extra AI requests."
                />
              </div>
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
