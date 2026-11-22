import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const destination = resolve(process.env.SCORE_STUDY_ARTIFACTS ?? 'artifacts/score-study');
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath(),
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
const report = { english: false, desktop: false, mobile: false, customScore: false, inspection: false, samples: [] };
try {
  await page.goto(`${process.env.POTTERY_URL ?? 'http://127.0.0.1:5198/'}?lab=score-study`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.score-comparison-row:not([data-strategy="supply"]) .score-sample[data-ready="true"]'))
    .toHaveCount(12, { timeout: 60_000 });
  await expect(page.locator('.score-viewer')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.score-study-page')).toHaveAttribute('lang', 'en');
  const visibleCopy = await page.locator('.score-study-page').evaluate(node => [node.innerText,
    ...Array.from(node.querySelectorAll('[aria-label], [alt]'), element => `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('alt') ?? ''}`)].join('\n'));
  assert.equal(/[\u3400-\u9fff]/u.test(visibleCopy), false, 'the page and accessible labels must be in English');
  report.english = true;
  await page.screenshot({ path: join(destination, 'desktop.png'), fullPage: true });
  for (const method of ['path', 'field']) {
    await page.locator(`.score-comparison-row[data-strategy="${method}"]`).screenshot({ path: join(destination, `${method}-six.png`) });
    for (const score of ['0.00', '0.20', '0.40', '0.60', '0.80', '1.00']) {
      const image = await page.locator(`[data-key="${method}-${score}"] img`).getAttribute('src');
      await writeFile(join(destination, `${method}-${score}.png`), Buffer.from(image.split(',')[1], 'base64'));
    }
  }
  report.desktop = true;
  console.log('B/C: 12 specimens rendered; comparison images saved.');

  await page.locator('[data-key="field-1.00"]').click();
  await page.locator('.score-viewer').scrollIntoViewIfNeeded();
  await expect(page.locator('.score-view-caption > span').first()).toHaveText('C / 1.00');
  const front = await page.locator('.score-viewer canvas').evaluate(canvas => canvas.toDataURL());
  assert.ok(front.length > 30_000, 'the interactive canvas contains a rendered specimen');
  await writeFile(join(destination, 'field-1.00-detail.png'), Buffer.from(front.split(',')[1], 'base64'));
  await page.getByRole('button', { name: 'Back view', exact: true }).click();
  const back = await page.locator('.score-viewer canvas').evaluate(canvas => canvas.toDataURL());
  assert.ok(front !== back, 'back view must reveal the other side');
  await writeFile(join(destination, 'field-1.00-back.png'), Buffer.from(back.split(',')[1], 'base64'));
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  assert.equal(front, await page.locator('.score-viewer canvas').evaluate(canvas => canvas.toDataURL()), 'reset restores exact camera');
  const box = await page.locator('.score-viewer canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2 + 35, { steps: 8 }); await page.mouse.up();
  assert.ok(front !== await page.locator('.score-viewer canvas').evaluate(canvas => canvas.toDataURL()), 'dragging changes the inspection angle');
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  report.inspection = true;

  await page.getByLabel('Instability score', { exact: true }).fill('0.73');
  await page.getByRole('button', { name: 'Generate specimen' }).click();
  await expect(page.locator('.score-view-caption > span').first()).toHaveText('C / 0.73', { timeout: 20_000 });
  report.customScore = true;
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile must not overflow horizontally');
  await page.screenshot({ path: join(destination, 'mobile.png'), fullPage: true });
  report.mobile = true;
  await page.setViewportSize({ width: 1500, height: 1100 });

  await expect(page.locator('.score-sample[data-ready="true"]')).toHaveCount(18, { timeout: 240_000 });
  await page.locator('.score-comparison-row[data-strategy="supply"]').screenshot({ path: join(destination, 'supply-six.png') });
  console.log('A: 6 material specimens rendered.');
  for (const method of ['supply', 'path', 'field']) for (const score of ['0.00', '0.20', '0.40', '0.60', '0.80', '1.00']) {
    await page.locator(`[data-key="${method}-${score}"]`).click();
    await expect(page.locator('.score-view-caption > span').first()).toContainText(score);
    const metrics = JSON.parse(await page.locator('.score-measurements').getAttribute('data-metrics'));
    report.samples.push({ strategy: method, score: Number(score), metrics });
  }
  await page.locator('.score-comparison').screenshot({ path: join(destination, 'comparison.png') });
  await page.locator('[data-key="field-0.60"]').click();
  await page.screenshot({ path: join(destination, 'desktop.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log(JSON.stringify({ ...report, samples: report.samples.length, errors }));
} finally {
  await writeFile(join(destination, 'browser-report.json'), JSON.stringify({ ...report, errors }, null, 2));
  await browser.close();
}
