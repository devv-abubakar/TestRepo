import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * Exercises the directory-input backend end-to-end: a real folder tree of
 * real PDFs is handed to the fallback picker, and the app must detect the
 * courses, build the queue and recognise outputs that already exist.
 */
let root = '';

async function writePdf(path: string, label: string): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText(label, { x: 50, y: 700, size: 12, font });
  await writeFile(path, await doc.save());
}

test.beforeAll(async () => {
  root = join(await Promise.resolve(tmpdir()), `vu-handouts-${Date.now()}`, 'All Handouts');
  const tree: Record<string, string[]> = {
    CS101: ['Handout 01.pdf', 'Handout 02.pdf', 'Handout 03.pdf'],
    ENG101: ['Handout 01.pdf'],
    MGT101: ['Handout 01.pdf', 'Handout 02.pdf'],
  };
  for (const [course, files] of Object.entries(tree)) {
    await mkdir(join(root, course), { recursive: true });
    for (const file of files) await writePdf(join(root, course, file), `${course} — ${file}`);
  }
  // An output that already exists must be detected and skipped.
  await writePdf(join(root, 'CS101', 'Handout 01_AI_Highlighted.pdf'), 'already processed');
  // A non-PDF must be ignored entirely.
  await writeFile(join(root, 'CS101', 'notes.txt'), 'not a pdf');
});

test.afterAll(async () => {
  if (root) await rm(join(root, '..'), { recursive: true, force: true });
});

test('detects courses and handouts from a selected folder tree', async ({ page }) => {
  await page.goto('/');
  // Start from a clean slate so no earlier run's resume state interferes.
  await page.evaluate(() => indexedDB.deleteDatabase('vu-handouts-highlighter'));
  await page.reload();

  await page.setInputFiles('input[type="file"]', root);

  const dashboard = page.getByRole('definition');
  await expect(dashboard.first()).toBeVisible();

  // 3 course folders, 6 source handouts, and the existing output excluded.
  await expect(page.locator('dl').first()).toContainText('Courses');
  const counts = await page.locator('dl').first().innerText();
  expect(counts).toMatch(/\b3\b/);
  expect(counts).toMatch(/\b6\b/);

  for (const course of ['CS101', 'ENG101', 'MGT101']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${course}`) })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /^CS101\s+3 handouts/ })).toBeVisible();

  // Every handout starts pending and the table lists all six.
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(page.getByText('notes.txt')).toHaveCount(0);
  await expect(page.getByText('Handout 01_AI_Highlighted.pdf')).toHaveCount(0);

  // Course filtering narrows the table.
  await page.getByRole('button', { name: /^ENG101/ }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: /^ENG101/ }).click();
  await expect(rows).toHaveCount(6);

  // The pre-flight summary reports the queue honestly.
  await page.getByRole('button', { name: 'Process All Handouts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ready to process' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Existing outputs');
  await expect(dialog.locator('dd').nth(1)).toHaveText('6');
  await expect(dialog.locator('dd').nth(2)).toHaveText('1');
  // The pre-flight summary states what the chosen coverage mode will cost.
  await expect(dialog).toContainText('Coverage mode');
  await expect(dialog).toContainText('complete');
  await expect(dialog).toContainText('AI requests per ~12,000 characters');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  // Without an API key, starting must be refused with a clear message.
  await page.getByRole('button', { name: 'Process All Handouts' }).click();
  await page.getByRole('button', { name: 'Start Processing' }).click();
  await expect(page.getByRole('status').first()).toContainText(/API key/i);
});

test('remembers completed work across a reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => indexedDB.deleteDatabase('vu-handouts-highlighter'));
  await page.reload();
  await page.setInputFiles('input[type="file"]', root);
  await expect(page.locator('table tbody tr')).toHaveCount(6);

  // Mark one handout completed the way the runner would, then reload.
  await page.evaluate(async () => {
    // Imported by runtime URL: this spec is type-checked for Node, so the
    // specifier is kept out of the static module graph.
    const specifier = '/src/services/persist/index.ts';
    const persist = (await import(specifier)) as typeof import('../../src/services/persist');
    const snapshot = await persist.loadSnapshot();
    if (!snapshot) throw new Error('no snapshot was checkpointed');
    const first = snapshot.handouts[0];
    if (!first) throw new Error('snapshot has no handouts');
    first.status = 'completed';
    first.highlightCount = 9;
    snapshot.totalHighlights = 9;
    await persist.saveSnapshot(snapshot);
  });

  await page.reload();
  await expect(page.getByText('Previous session detected')).toBeVisible();
  await expect(page.getByText(/1 handouts already completed/)).toBeVisible();

  // Re-selecting the same folder carries the completed status forward.
  await page.setInputFiles('input[type="file"]', root);
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toContainText('Completed');
});
