// Public-corpus smoke check: count and readiness only; no passage output.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const url = new URL(process.env.POTTERY_URL || 'http://127.0.0.1:5173/?physics=strand');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  let failed = false;
  page.on('pageerror', () => { failed = true; });
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.memory-playback')?.getAttribute('data-source-state') === 'ready', { }, { timeout: 15_000 });
  const result = await page.evaluate(() => ({
    ready: document.querySelector('.memory-playback')?.getAttribute('data-source-state') === 'ready',
    total: Number(document.querySelector('.memory-counter')?.textContent?.split('/').at(-1)),
    originalVisible: !!document.querySelector('.memory-active p')?.textContent?.trim(),
    emptyState: !!document.querySelector('.memory-empty'),
    canStart: !document.querySelector('[aria-label="Start printing from the workbench"]')?.disabled,
    mode: document.querySelector('[aria-label="Print physics model"]')?.value,
  }));
  assert.deepEqual(result, { ready: true, total: 1910, originalVisible: true, emptyState: false, canStart: true, mode: 'strand' });
  assert.equal(failed, false, 'no browser runtime errors');
  console.log('[local-originals] Public default ready; 1910 originals; nonempty passage visible before printing; V3 selected. No content recorded.');
} finally {
  await browser.close();
}
