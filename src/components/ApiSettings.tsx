import { useId, useState } from 'react';
import { PROVIDERS, providerMeta } from '../services/ai';
import { useAppStore } from '../store/useAppStore';
import type { ProviderId } from '../types';
import { Field, Icon, Toggle } from './ui';

export function ApiSettings() {
  const ai = useAppStore((state) => state.settings.ai);
  const patch = useAppStore((state) => state.patchSettings);
  const connection = useAppStore((state) => state.connection);
  const test = useAppStore((state) => state.runConnectionTest);
  const [revealed, setRevealed] = useState(false);
  const ids = useId();

  const meta = providerMeta(ai.provider);

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
          hint="Type any model name your key has access to."
        >
          <input
            id={`${ids}-model`}
            className="field"
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
        <Field label="API Key" htmlFor={`${ids}-key`} hint={meta.keyHint}>
          <div className="flex gap-2">
            <input
              id={`${ids}-key`}
              className="field font-mono"
              type={revealed ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={ai.apiKey}
              placeholder="•••••••••••••••••"
              onChange={(event) => patch({ ai: { ...ai, apiKey: event.target.value } })}
            />
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={() => setRevealed((value) => !value)}
              aria-pressed={revealed}
            >
              <Icon name="eye" />
              <span className="sr-only sm:not-sr-only">{revealed ? 'Hide' : 'Show'}</span>
            </button>
          </div>
        </Field>
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
            {connection.state === 'testing' ? 'Testing…' : 'Test Connection'}
          </button>
          {connection.message ? (
            <p
              className={`text-xs ${connection.state === 'ok' ? 'text-ok' : 'text-bad'}`}
              role="status"
            >
              {connection.message}
            </p>
          ) : null}
        </div>
      </div>

      {meta.browserDirect ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-ink">
          <p className="font-semibold">Bring-your-own-key, running in your browser</p>
          <p className="mt-1">
            Your key is sent directly from this browser to {meta.label} and is never stored in this
            app's source, logs or repository. Anyone with access to this browser profile could read a
            remembered key, so for a shared or public deployment choose the backend proxy provider
            instead and keep the key server-side.
          </p>
          <div className="mt-2">
            <Toggle
              checked={ai.rememberKey}
              onChange={(rememberKey) => patch({ ai: { ...ai, rememberKey } })}
              label="Remember this key in local browser storage"
              hint="Off by default. Clearing it removes the key immediately."
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
