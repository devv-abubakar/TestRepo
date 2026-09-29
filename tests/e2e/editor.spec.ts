import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

/**
 * These run against the production build in a real browser, because the parts
 * most likely to break — canvas rendering, font loading, the PNG encoder, the
 * download path — cannot be exercised in a unit test.
 */

/** Reads the average luminance of a canvas, to prove it actually drew something. */
async function canvasStats(page: Page, testId: string) {
  return page.locator(`[data-testid="${testId}"]`).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0) return { width: 0, height: 0, mean: 0, unique: 0 };
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) {
      const v = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      sum += v;
      seen.add((data[i]! >> 4) << 8 | (data[i + 1]! >> 4) << 4 | data[i + 2]! >> 4);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      mean: sum / (data.length / (4 * 97)),
      unique: seen.size,
    };
  });
}

async function startWithSample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /sample/i }).click();
  await expect(page.getByTestId('tab-design')).toBeVisible();
  // Let fonts settle so the first paint is the real one.
  await page.waitForTimeout(700);
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test('landing page states the guarantees and offers a sample', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/drop your app screenshots/i);
  await expect(page.getByText(/no alpha channel/i)).toBeVisible();
  await expect(page.getByText(/nothing is uploaded/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /sample/i })).toBeVisible();
});

test('sample screenshots load and render a non-empty composition', async ({ page }) => {
  await startWithSample(page);

  const stats = await canvasStats(page, 'stage-canvas');
  expect(stats.width).toBeGreaterThan(300);
  // A blank or single-colour canvas would mean the renderer silently failed.
  expect(stats.unique).toBeGreaterThan(20);
  expect(stats.mean).toBeGreaterThan(5);
  expect(stats.mean).toBeLessThan(250);
});

test('changing the layout changes the rendered pixels', async ({ page }) => {
  await startWithSample(page);
  const before = await canvasStats(page, 'stage-canvas');

  await page.getByTestId('template-bold-type').click();
  await page.waitForTimeout(400);

  const after = await canvasStats(page, 'stage-canvas');
  expect(Math.abs(after.mean - before.mean)).toBeGreaterThan(0.4);
});

test('caption suggestions fill every slide with distinct copy', async ({ page }) => {
  await startWithSample(page);
  await page.getByTestId('tab-caption').click();
  await page.getByRole('button', { name: /suggest captions/i }).click();

  const headline = page.getByPlaceholder('Know where your money went');
  await expect(headline).not.toHaveValue('');

  const first = await headline.inputValue();
  await page.getByRole('button', { name: 'Screenshot 2' }).click();
  const second = await headline.inputValue();

  expect(second).not.toBe('');
  expect(second).not.toBe(first);
});

test('the compliance panel blocks an export that Play would reject', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /sample/i }).click();
  await expect(page.getByTestId('tab-export')).toBeVisible();

  // Drop to a single screenshot; Play requires at least two.
  await page.getByRole('button', { name: /remove 3/i }).click();
  await page.getByRole('button', { name: /remove 2/i }).click();

  await page.getByTestId('tab-export').click();
  await expect(page.getByText(/at least 2/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /download all/i })).toBeDisabled();
});

test('exports a ZIP of real 24-bit PNGs at the exact Play dimensions', async ({ page }) => {
  await startWithSample(page);
  await page.getByTestId('tab-export').click();

  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByRole('button', { name: /download all/i }).click(),
  ]).then(([d]) => d);

  expect(download.suggestedFilename()).toMatch(/\.zip$/);

  const path = await download.path();
  expect(path).toBeTruthy();
  const entries = unzipSync(new Uint8Array(readFileSync(path!)));
  const names = Object.keys(entries);

  expect(names).toContain('README.txt');
  const pngs = names.filter((n) => n.endsWith('.png'));
  expect(pngs.length).toBeGreaterThanOrEqual(2);

  for (const name of pngs) {
    const bytes = entries[name]!;
    // PNG signature
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    const colorType = bytes[25];

    expect(width, name).toBe(1080);
    expect(height, name).toBe(1920);
    // 2 = truecolour without alpha. This is the whole reason the encoder exists.
    expect(colorType, name).toBe(2);
    expect(bytes.length, name).toBeGreaterThan(10_000);
  }

  const readme = new TextDecoder().decode(entries['README.txt']!);
  expect(readme).toContain('Main store listing');
  expect(readme).toContain('1080 x 1920');
});

test('a feature graphic exports at 1024x500 and is not blocked by screenshot rules', async ({ page }) => {
  await startWithSample(page);
  await page.getByLabel('Asset type').selectOption('feature-graphic');
  await page.getByTestId('tab-export').click();

  // A warning (no headline yet) must not block export; only an error may.
  await expect(page.getByRole('button', { name: /download all/i })).toBeEnabled();

  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByRole('button', { name: /download all/i }).click(),
  ]).then(([d]) => d);

  const entries = unzipSync(new Uint8Array(readFileSync((await download.path())!)));
  const png = Object.entries(entries).find(([n]) => n.endsWith('.png'));
  expect(png).toBeTruthy();

  const bytes = png![1];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(16)).toBe(1024);
  expect(view.getUint32(20)).toBe(500);
});

test('the project survives a reload', async ({ page }) => {
  await startWithSample(page);
  await page.getByTestId('tab-caption').click();
  await page.getByPlaceholder('Know where your money went').fill('Persisted headline');
  await page.waitForTimeout(500);

  await page.reload();
  await expect(page.getByTestId('tab-design')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('tab-caption').click();
  await expect(page.getByPlaceholder('Know where your money went')).toHaveValue('Persisted headline');

  // And the screenshot itself came back, not just the text.
  const stats = await canvasStats(page, 'stage-canvas');
  expect(stats.unique).toBeGreaterThan(20);
});

test('undo reverses a change', async ({ page }) => {
  await startWithSample(page);
  await page.getByTestId('tab-caption').click();
  const headline = page.getByPlaceholder('Know where your money went');
  await headline.fill('First');
  await page.waitForTimeout(300);
  await headline.fill('Second');
  await page.waitForTimeout(300);

  await page.getByTitle(/undo/i).click();
  await expect(headline).not.toHaveValue('Second');
});

test('the preview and a thumbnail lay text out identically', async ({ page }) => {
  await startWithSample(page);
  await page.getByTestId('tab-caption').click();
  await page.getByRole('button', { name: /suggest captions/i }).click();
  await page.waitForTimeout(800);

  /**
   * The preview and the export share one render function and differ only by a
   * scale transform, so the same slide drawn into a 198px thumbnail and an
   * 888px stage must place its text at the same fraction of the width. If this
   * ever drifts, the file a user downloads is not the one they approved.
   */
  const extent = (testId: string) =>
    page.locator(`[data-testid="${testId}"]`).evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const top = Math.round(canvas.height * 0.05);
      const height = Math.round(canvas.height * 0.15);
      const { data } = ctx.getImageData(0, top, canvas.width, height);
      let min = canvas.width;
      let max = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const i = (y * canvas.width + x) * 4;
          if ((data[i]! + data[i + 1]! + data[i + 2]!) / 3 > 170) {
            if (x < min) min = x;
            if (x > max) max = x;
          }
        }
      }
      return max <= min ? null : { left: min / canvas.width, right: max / canvas.width };
    });

  const stage = await extent('stage-canvas');
  const rail = await extent('rail-canvas-0');

  expect(stage).not.toBeNull();
  expect(rail).not.toBeNull();
  expect(rail!.left).toBeCloseTo(stage!.left, 1);
  expect(rail!.right).toBeCloseTo(stage!.right, 1);
  // And the text stays inside the canvas at both sizes.
  expect(stage!.left).toBeGreaterThan(0.01);
  expect(stage!.right).toBeLessThan(0.99);
});
