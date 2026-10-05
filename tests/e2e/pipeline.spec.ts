import { expect, test } from '@playwright/test';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface TestResult {
  test: string;
  ok: boolean;
  checks: CheckResult[];
  error?: string;
}

/**
 * Tesseract fetches its English model from a public host on first use, so in
 * a sandbox without outbound network that one request fails. The OCR scenario
 * asserts the failure is reported cleanly, so the console noise it produces is
 * expected rather than a defect.
 */
const EXPECTED_OFFLINE = /tesseract|tessdata|traineddata/i;

test('processing pipeline passes the acceptance harness', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => {
    if (EXPECTED_OFFLINE.test(error.message)) {
      console.log(`   (expected offline) ${error.message}`);
      return;
    }
    failures.push(`pageerror: ${error.message}`);
  });

  await page.goto('/selftest.html');
  const results = await page.evaluate(
    () => (window as unknown as { __vuSelfTest: () => Promise<TestResult[]> }).__vuSelfTest(),
  );

  for (const result of results) {
    // eslint-disable-next-line no-console
    console.log(`${result.ok ? 'PASS' : 'FAIL'} — ${result.test}`);
    for (const check of result.checks) {
      console.log(`   ${check.ok ? '✓' : '✗'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    }
    if (result.error) console.log(`   error: ${result.error}`);
  }

  const broken = results.filter((result) => !result.ok);
  expect(broken.map((r) => `${r.test}: ${r.error ?? r.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`)).toEqual([]);
  expect(failures).toEqual([]);
});

test('the app shell renders and guards the start button', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'VU Handouts AI Highlighter' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Select Handouts Folder', exact: true }),
  ).toBeVisible();
  // Nothing is selected yet, so there is no queue and no process button.
  await expect(page.getByRole('button', { name: 'Process All Handouts' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.getByLabel('API Key')).toHaveAttribute('type', 'password');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
