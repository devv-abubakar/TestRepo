import { expect, test } from '@playwright/test';

/** The key-pool UI: adding keys, masking them, and the per-key test results. */
test('manages a pool of API keys', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.deleteDatabase('vu-handouts-highlighter');
  });
  await page.reload();

  await page.getByRole('button', { name: 'Settings' }).first().click();

  // Gemini is the default provider, with the requested model preselected.
  await expect(page.getByLabel('API Provider')).toHaveValue('gemini');
  await expect(page.getByLabel('AI Model')).toHaveValue('gemini-3.1-flash-lite');

  // One empty key row exists; values are masked.
  const firstKey = page.getByLabel('API key 1');
  await expect(firstKey).toHaveAttribute('type', 'password');
  await firstKey.fill('AIza-test-key-one');
  await expect(page.getByText(/API key pool \(1 of 1 ready\)/)).toBeVisible();

  // A second project's key can be added and labelled.
  await page.getByRole('button', { name: 'Add another key' }).click();
  await page.getByLabel('API key 2').fill('AIza-test-key-two');
  await expect(page.getByText(/API key pool \(2 of 2 ready\)/)).toBeVisible();

  const labels = page.locator('input[id^="key-label-"]');
  await expect(labels).toHaveCount(2);
  await labels.nth(1).fill('Spare');
  await expect(labels.nth(1)).toHaveValue('Spare');

  // Revealing one key must not reveal the other.
  await page.getByRole('button', { name: 'Show Project A key' }).click();
  await expect(firstKey).toHaveAttribute('type', 'text');
  await expect(page.getByLabel('API key 2')).toHaveAttribute('type', 'password');

  // Disabling a key takes it out of the pool count.
  await page.getByRole('checkbox', { name: 'Use this key' }).nth(1).uncheck();
  await expect(page.getByText(/API key pool \(1 of 2 ready\)/)).toBeVisible();

  // Removing a key leaves the other intact.
  await page.getByRole('button', { name: 'Remove Spare' }).click();
  await expect(page.getByLabel('API key 2')).toHaveCount(0);
  await expect(firstKey).toHaveValue('AIza-test-key-one');

  // Pool limits are configurable and default to the free-tier figures.
  await expect(page.getByLabel('Requests per minute, per key')).toHaveValue('15');
  await expect(page.getByLabel('Daily requests, per key')).toHaveValue('1000');
  await expect(page.getByLabel('Max parallel AI requests')).toHaveValue('4');
});

test('keeps key values out of storage unless asked', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByLabel('API key 1').fill('AIza-secret-value');

  // Default is not to remember: the value must not be in localStorage.
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain('AIza-secret-value');

  // Opting in stores it, and opting back out removes it again.
  await page.getByRole('checkbox', { name: /Remember these keys/ }).check();
  await expect
    .poll(async () => (await page.evaluate(() => JSON.stringify(localStorage))).includes('AIza-secret-value'))
    .toBe(true);

  await page.getByRole('checkbox', { name: /Remember these keys/ }).uncheck();
  await expect
    .poll(async () => (await page.evaluate(() => JSON.stringify(localStorage))).includes('AIza-secret-value'))
    .toBe(false);

  // The label and the enabled flag survive a reload even without the value.
  await page.getByRole('checkbox', { name: /Remember these keys/ }).check();
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.getByLabel('API key 1')).toHaveValue('AIza-secret-value');
});
