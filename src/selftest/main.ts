/**
 * Entry point for the acceptance harness page (`/selftest.html`).
 * Dev-only: it is not part of the production bundle.
 */
import { runSelfTest, type TestResult } from './harness';
import '../styles/index.css';

declare global {
  interface Window {
    __vuSelfTest?: (filter?: string) => Promise<TestResult[]>;
    __vuSelfTestResults?: TestResult[];
  }
}

const host = document.getElementById('results');

function render(results: TestResult[]): void {
  if (!host) return;
  host.replaceChildren();
  for (const result of results) {
    const section = document.createElement('section');
    section.className = 'card p-4';
    const title = document.createElement('h2');
    title.className = `font-semibold ${result.ok ? 'text-ok' : 'text-bad'}`;
    title.textContent = `${result.ok ? 'PASS' : 'FAIL'} — ${result.test}`;
    section.append(title);
    if (result.error) {
      const error = document.createElement('p');
      error.className = 'mt-1 text-sm text-bad';
      error.textContent = result.error;
      section.append(error);
    }
    const list = document.createElement('ul');
    list.className = 'mt-2 space-y-1 text-xs font-mono';
    for (const check of result.checks) {
      const item = document.createElement('li');
      item.className = check.ok ? 'text-ink' : 'text-bad';
      item.textContent = `${check.ok ? '✓' : '✗'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`;
      list.append(item);
    }
    section.append(list);
    host.append(section);
  }
}

window.__vuSelfTest = async (filter?: string) => {
  const results = await runSelfTest(filter);
  window.__vuSelfTestResults = results;
  render(results);
  return results;
};

document.getElementById('run')?.addEventListener('click', () => {
  void window.__vuSelfTest?.();
});
