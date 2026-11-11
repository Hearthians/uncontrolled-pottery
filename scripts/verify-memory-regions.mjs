import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { preview, build } from 'vite';
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'artifacts/memory-regions');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false } });
const address = server.httpServer.address();
const base = `http://127.0.0.1:${address.port}`;
const scratch = await mkdtemp(join(tmpdir(), 'pottery-regions-'));
const report = { desktop: false, mobile: false, missingData: false, mismatchedCorpus: false, subpath: false, works: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1350 } });
  const errors = [], apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/')) apiRequests.push(request.url()); });
  await page.goto(`${base}/?lab=memory-comparison`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '记忆，在一条线上。' })).toBeVisible();
  await expect(page.locator('.region-work')).toHaveCount(4);
  await expect(page.locator('.region-still[data-ready="true"]')).toHaveCount(5, { timeout: 180_000 });
  await expect(page.locator('.memory-emotion-tags')).toHaveCount(0);
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.locator('.regions-original-grid blockquote')).toHaveCount(12);
  report.works = await page.locator('.region-still').evaluateAll(figures => figures.map(figure => ({
    id: figure.dataset.potteryId, missingPercent: Number(figure.querySelector('strong').textContent.replace('%', '')),
    imageWidth: figure.querySelector('img').naturalWidth,
  })));
  assert.ok(report.works.every(work => work.imageWidth >= 400));
  assert.equal(report.works.at(-1).missingPercent, 0);
  assert.ok(report.works[3].missingPercent > report.works[0].missingPercent + 1, 'memory groups must produce observably different supply outcomes');
  assert.deepEqual(apiRequests, [], 'the study must not call a model service');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(artifacts, 'desktop.png') });
  await page.screenshot({ path: join(artifacts, 'full-page.png'), fullPage: true });
  report.desktop = true;
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile layout must not overflow');
  await page.screenshot({ path: join(artifacts, 'mobile.png') });
  report.mobile = true;
  await page.close();

  const missing = await browser.newPage();
  await missing.route('**/memory-regions.json', route => route.fulfill({ status: 404, body: 'Not found' }));
  await missing.goto(`${base}/?lab=memory-comparison`);
  await expect(missing.getByRole('alert')).toContainText('无法载入');
  await expect(missing.locator('.region-work')).toHaveCount(0);
  report.missingData = true;
  await missing.close();

  const mismatched = await browser.newPage();
  const data = JSON.parse(await readFile(join(root, 'public/memory-regions.json'), 'utf8'));
  data.corpusSha256 = '0'.repeat(64);
  await mismatched.route('**/memory-regions.json', route => route.fulfill({ json: data }));
  await mismatched.goto(`${base}/?lab=memory-comparison`);
  await expect(mismatched.getByRole('alert')).toContainText('不匹配');
  await expect(mismatched.locator('.region-work')).toHaveCount(0);
  report.mismatchedCorpus = true;
  await mismatched.close();

  const outDir = join(scratch, 'dist');
  await build({ root, base: '/pottery/', build: { outDir, emptyOutDir: true }, logLevel: 'warn' });
  const subServer = await preview({ root, base: '/pottery/', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
  try {
    const subPage = await browser.newPage();
    const subAddress = subServer.httpServer.address();
    const requested = [];
    subPage.on('request', request => { if (/\/(memories|memory-regions)\.json/.test(request.url())) requested.push(request.url()); });
    await subPage.goto(`http://127.0.0.1:${subAddress.port}/pottery/?lab=memory-comparison`);
    await expect(subPage.locator('.region-work')).toHaveCount(4);
    assert.equal(requested.length, 2);
    assert.ok(requested.every(url => url.includes('/pottery/')));
    report.subpath = true;
    await subPage.close();
  } finally { await new Promise(resolve => subServer.httpServer.close(resolve)); }
  await writeFile(join(artifacts, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
