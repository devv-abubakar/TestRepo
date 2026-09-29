import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const OUT = '/tmp/shots';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 2 });

await page.goto('http://127.0.0.1:4173/');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/01-welcome.png` });

await page.getByRole('button', { name: /sample/i }).click();
await page.getByTestId('tab-caption').click();
await page.getByRole('button', { name: /suggest captions/i }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/02-editor.png` });

// Render a strip of every template at export resolution, so the design work can
// actually be judged rather than assumed.
await page.getByTestId('tab-design').click();
const templates = ['spotlight', 'tilt', 'bleed', 'split', 'minimal', 'bold-type', 'frameless', 'duo'];
const frames = [];
for (const id of templates) {
  await page.getByTestId(`template-${id}`).click();
  await page.waitForTimeout(450);
  frames.push(await page.getByTestId('stage-canvas').screenshot());
}
frames.forEach((buf, i) => writeFileSync(`${OUT}/t-${templates[i]}.png`, buf));

// And a real exported file, straight from the encoder.
await page.getByTestId('template-tilt').click();
await page.waitForTimeout(400);
const bytes = await page.evaluate(async () => {
  const canvas = document.querySelector('[data-testid="stage-canvas"]');
  return canvas ? [canvas.width, canvas.height] : null;
});
console.log('stage canvas pixels:', bytes);

await browser.close();
console.log('screenshots written to', OUT);
