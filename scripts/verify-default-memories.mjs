// Both production bases must load the real public corpus, without a dev-only endpoint.
import assert from 'node:assert/strict';
import { readdir, readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { build, preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import { parseMemories } from '../src/memoryPlayback.ts';

const root = resolve(import.meta.dirname, '..');
const publicText = await readFile(join(root, 'public/memories.json'), 'utf8');
const originals = parseMemories(publicText);
assert.equal(originals.length, 1910);
assert.ok(JSON.parse(publicText).every((entry) => typeof entry === 'string'));
async function inspect(directory) {
  for (const name of await readdir(directory)) {
    assert.ok(!['artifacts', 'local-memories.json', 'embeddings_lab_updated.zip', '.runtime', '.tmuxhub'].includes(name), 'raw work files must not be emitted');
    const path = join(directory, name);
    if ((await stat(path)).isDirectory()) await inspect(path);
  }
}
const scratch = await mkdtemp(join(tmpdir(), 'pottery-public-build-'));
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const base of ['/', '/pottery/']) {
    const outDir = base === '/' ? join(root, 'dist') : join(scratch, 'dist-pottery');
    if (base !== '/') await build({ root, base, build: { outDir, emptyOutDir: true }, logLevel: 'warn' });
    await inspect(outDir);
    assert.equal(await readFile(join(outDir, 'memories.json'), 'utf8'), publicText);
    const server = await preview({ root, base, build: { outDir }, preview: { host: '127.0.0.1', port: 0, strictPort: false } });
    try {
      const address = server.httpServer.address();
      const url = `http://127.0.0.1:${address.port}${base}`;
      const response = await fetch(`${url}memories.json`, { headers: { 'x-forwarded-for': '192.0.2.1' } });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), publicText);
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      let oldRequests = 0;
      page.on('request', (request) => { if (request.url().includes('/_local/')) oldRequests++; });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.memory-counter')).toHaveText('01/1910');
      assert.equal(await page.locator('.memory-active p').evaluate((p) => p.textContent.trim().length > 0), true);
      await expect(page.locator('.memory-empty')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Start printing from the workbench', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Start printing from the workbench', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Pause print', exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Pause print', exact: false }).click();
      await expect(page.locator('.viewport .clay-scene')).toHaveAttribute('data-engine', '3');
      assert.equal(oldRequests, 0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('.memory-counter')).toHaveText('01/1910');
      await page.getByLabel('Memories JSON file').setInputFiles({ name: 'fictional.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(['Private manual fixture — must remain browser-only.'])) });
      await expect(page.locator('.memory-active p')).toHaveText('Private manual fixture — must remain browser-only.');
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('Private manual fixture')), false);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('.memory-counter')).toHaveText('01/1910');
      await page.close();
      console.log(`[default-memories] Production ${base}: 1910 public originals auto-loaded, printing enabled, reload verified; no localhost API required.`);
    } finally {
      await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
    }
  }
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}
