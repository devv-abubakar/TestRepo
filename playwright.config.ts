import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/**
 * Browser-level acceptance tests. The pipeline needs real PDF rendering,
 * canvas pixel access, IndexedDB and workers, so these run in Chromium
 * against the dev server rather than in a DOM shim.
 *
 * CHROMIUM_PATH lets a pre-installed Chromium be used instead of Playwright's
 * own download, which matters in sandboxes where browsers are provisioned.
 */
const preinstalled = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((path): path is string => Boolean(path) && existsSync(path as string));

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    ...(preinstalled ? { launchOptions: { executablePath: preinstalled } } : {}),
  },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
