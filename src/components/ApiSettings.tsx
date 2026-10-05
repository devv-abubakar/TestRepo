import { useId, useState } from 'react';
import { PROVIDERS, providerMeta } from '../services/ai';
import { useAppStore } from '../store/useAppStore';
import type { ApiKeyEntry, ProviderId } from '../types';
import { Field, Icon, Toggle } from './ui';

/** One editable row of the key pool. Values are masked by default. */
function KeyRow({ entry, index }: { entry: ApiKeyEntry; index: number }) {
  const update = useAppStore((state) => state.updateApiKey);
  const remove = useAppStore((state) => state.removeApiKey);
  const running = useAppStore((state) => state.running);
  const result = useAppStore((state) =>
    state.connection.results.find((row) => row.label === entry.label),
  );
  const [revealed, setRevealed] = useState(false);

  return (
    <li className="rounded-lg border border-edge bg-surface/50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32 shrink-0">
          <label className="label" htmlFor={`key-label-${entry.id}`}>
            Label
          </label>
          <input
            id={`key-label-${entry.id}`}
            className="field"
            value={entry.label}
            maxLength={24}
            onChange={(event) => update(entry.id, { label: event.target.value })}
          />
        </div>
        <div className="min-w-[14rem] flex-1">
          <label className="label" htmlFor={`key-value-${entry.id}`}>
            API key {index + 1}
          </label>
          <input
            id={`key-value-${entry.id}`}
            className="field font-mono"
            type={revealed ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={entry.key}
            placeholder="•••••••••••••••••"
            onChange={(event) => update(entry.id, { key: event.target.value.trim() })}
          />
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setRevealed((value) => !value)}
          aria-pressed={revealed}
          aria-label={revealed ? `Hide ${entry.label} key` : `Show ${entry.label} key`}
        >
          <Icon name="eye" />
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={() => remove(entry.id)}
          disabled={running}
          aria-label={`Remove ${entry.label}`}
        >
          <Icon name="close" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Toggle
          checked={entry.enabled}
          onChange={(enabled) => update(entry.id, { enabled })}
          label="Use this key"
        />
        {result ? (
          <span className={`chip ${result.ok ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}`}>
            {result.ok ? `OK · ${result.ms} ms` : result.message.slice(0, 90)}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function ApiSettings() {
  const ai = useAppStore((state) => state.settings.ai);
  const patch = useAppStore((state) => state.patchSettings);
  const addKey = useAppStore((state) => state.addApiKey);
  const connection = useAppStore((state) => state.connection);
  const test = useAppStore((state) => state.runConnectionTest);
  const ids = useId();

  const meta = providerMeta(ai.provider);
  const usable = ai.keys.filter((entry) => entry.enabled && entry.key.trim().length > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="API Provider" htmlFor={`${ids}-provider`}>
          <select
            id={`${ids}-provider`}
            className="field"
            value={ai.provider}
            onChange={(event) => {
              const provider = event.target.value as ProviderId;
              const next = providerMeta(provider);
              patch({ ai: { ...ai, provider, model: next.defaultModel || ai.model } });
            }}
          >
            {PROVIDERS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="AI Model"
          htmlFor={`${ids}-model`}
          hint="Type any model name your keys have access to."
        >
          <input
            id={`${ids}-model`}
            className="field font-mono"
            list={`${ids}-models`}
            value={ai.model}
            placeholder="model name"
            onChange={(event) => patch({ ai: { ...ai, model: event.target.value } })}
          />
          <datalist id={`${ids}-models`}>
            {meta.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </Field>
      </div>

      {meta.browserDirect ? (
        <section aria-labelledby={`${ids}-keys`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 id={`${ids}-keys`} className="section-title">
              API key pool ({usable} of {ai.keys.length} ready)
            </h4>
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={addKey}>
              <Icon name="spark" className="h-3.5 w-3.5" />
              Add another key
            </button>
          </div>
          <p className="mb-2 text-xs text-muted">
            {meta.keyHint}. Free-tier quotas are counted per cloud project, so a key from each project
            adds its own limit to the pool. Requests are spread across the keys and move to another
            key the moment one is rate-limited.
          </p>
          <ul className="space-y-2" role="list">
            {ai.keys.map((entry, index) => (
              <KeyRow key={entry.id} entry={entry} index={index} />
            ))}
          </ul>
          {ai.keys.length === 0 ? (
            <p className="text-sm text-muted">No keys yet — add one to get started.</p>
          ) : null}
        </section>
      ) : (
        <Field
          label="Proxy Endpoint URL"
          htmlFor={`${ids}-proxy`}
          hint="Your serverless function holds the provider key. Nothing secret is stored in the browser."
        >
          <input
            id={`${ids}-proxy`}
            className="field font-mono"
            value={ai.proxyUrl}
            placeholder="/api/ai-proxy"
            onChange={(event) => patch({ ai: { ...ai, proxyUrl: event.target.value } })}
          />
        </Field>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Field
          label="Requests per minute, per key"
          htmlFor={`${ids}-rpm`}
          hint="Keep this at or below your plan's limit. 0 removes the spacing."
        >
          <input
            id={`${ids}-rpm`}
            type="number"
            min={0}
            max={600}
            className="field"
            value={ai.requestsPerMinutePerKey}
            onChange={(event) =>
              patch({ ai: { ...ai, requestsPerMinutePerKey: Number(event.target.value) } })
            }
          />
        </Field>
        <Field
          label="Daily requests, per key"
          htmlFor={`${ids}-daily`}
          hint="A key that hits this is parked until the quota resets. 0 removes the budget."
        >
          <input
            id={`${ids}-daily`}
            type="number"
            min={0}
            max={100000}
            className="field"
            value={ai.dailyBudgetPerKey}
            onChange={(event) => patch({ ai: { ...ai, dailyBudgetPerKey: Number(event.target.value) } })}
          />
        </Field>
        <Field
          label="Max parallel AI requests"
          htmlFor={`${ids}-parallel`}
          hint="Across the whole pool. More keys make a higher number useful."
        >
          <input
            id={`${ids}-parallel`}
            type="number"
            min={1}
            max={16}
            className="field"
            value={ai.maxParallelRequests}
            onChange={(event) =>
              patch({ ai: { ...ai, maxParallelRequests: Number(event.target.value) } })
            }
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label={`Temperature (${ai.temperature.toFixed(2)})`}
          htmlFor={`${ids}-temp`}
          hint="Low values keep the model literal, which is what verbatim quoting needs."
        >
          <input
            id={`${ids}-temp`}
            type="range"
            min={0}
            max={1}
            step={0.05}
            className="w-full accent-brand"
            value={ai.temperature}
            onChange={(event) => patch({ ai: { ...ai, temperature: Number(event.target.value) } })}
          />
        </Field>

        <div className="flex flex-col justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void test()}
            disabled={connection.state === 'testing'}
          >
            <Icon name="spark" />
            {connection.state === 'testing' ? 'Testing every key…' : 'Test Connection'}
          </button>
          {connection.state === 'done' ? (
            <p
              className={`text-xs ${
                connection.results.every((row) => row.ok) ? 'text-ok' : 'text-bad'
              }`}
              role="status"
            >
              {connection.results.filter((row) => row.ok).length} of {connection.results.length} key(s)
              responded correctly with {ai.model}.
            </p>
          ) : null}
        </div>
      </div>

      {meta.browserDirect ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-ink">
          <p className="font-semibold">Bring-your-own-keys, running in your browser</p>
          <p className="mt-1">
            Your keys are sent directly from this browser to {meta.label} and are never stored in this
            app's source, logs or repository. Anyone with access to this browser profile could read
            remembered keys, so for a shared or public deployment choose the backend proxy provider and
            keep the keys server-side.
          </p>
          <div className="mt-2">
            <Toggle
              checked={ai.rememberKey}
              onChange={(rememberKey) => patch({ ai: { ...ai, rememberKey } })}
              label="Remember these keys in local browser storage"
              hint="Off by default. Turning it off removes them immediately."
            />
          </div>
          <a
            className="mt-2 inline-flex items-center gap-1 font-medium text-brand underline"
            href={meta.docsUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            Get an API key
            <Icon name="external" className="h-3 w-3" />
          </a>
        </div>
      ) : null}
    </div>
  );
}
