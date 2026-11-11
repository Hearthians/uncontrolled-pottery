import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build, preview } from 'vite';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const scores = { calm: 1, anxiety: 2, anger: 0, stress: 3, sadness: 1 };
const entries = [{ id: 'fixture', text: 'A test memory', scores, status: 'analyzed', source: { block: 0, start: 0, end: 13 } }];

test('production public demo requires an explicit opt-in for anonymous analysis', { timeout: 120000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pottery-public-test-'));
  const previous = { demo: process.env.VITE_PUBLIC_DEMO_SCORES, analysis: process.env.VITE_PUBLIC_ANALYSIS };
  let browser;
  try {
    process.env.VITE_PUBLIC_DEMO_SCORES = '1';
    browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    for (const enabled of [false, true]) {
      if (enabled) process.env.VITE_PUBLIC_ANALYSIS = '1'; else delete process.env.VITE_PUBLIC_ANALYSIS;
      const outDir = path.join(dir, enabled ? 'enabled' : 'static');
      await build({ root, configFile: false, logLevel: 'error', build: { outDir, emptyOutDir: true } });
      const server = await preview({ root, configFile: false, logLevel: 'error', build: { outDir }, preview: { port: 0, host: '127.0.0.1' } });
      const page = await browser.newPage();
      try {
        let posts = 0, failure = 'rate';
        await page.route('**/memories.json', route => route.fulfill({ json: ['A public memory'] }));
        await page.route('**/default-memory-scores.json', route => route.fulfill({ status: 404 }));
        await page.route('**/api/memories/jobs**', route => {
          if (route.request().method() === 'POST') {
            posts++;
            assert.equal(route.request().headers()['x-memory-access-code'], undefined);
            return failure === 'rate' ? route.fulfill({ status: 429, json: { error: 'Quota' } }) : route.fulfill({ status: 202, json: { id: 'fixture', token: 'token' } });
          }
          if (route.request().method() === 'DELETE') return route.fulfill({ json: {} });
          return route.fulfill({ json: failure === 'job' ? { id: 'fixture', status: 'failed', progress: { completed: 0, total: 1 }, error: 'Analysis failed' } : { id: 'fixture', status: 'completed', progress: { completed: 1, total: 1 }, entries } });
        });
        const address = server.httpServer.address();
        await page.goto(`http://127.0.0.1:${address.port}/`);
        await expect(page.locator('.memory-active')).toContainText('A public memory');
        await expect(page.getByRole('combobox', { name: 'Print behavior' })).toHaveValue('demo');
        await expect(page.locator('.memory-demo-note')).toContainText('random demo');
        if (!enabled) {
          await expect(page.getByRole('button', { name: 'Replace', exact: true })).toHaveCount(0);
          await expect(page.getByText(/upload and analysis are unavailable/i).first()).toBeVisible();
          continue;
        }
        await page.getByRole('button', { name: 'Replace', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Analyze memories' });
        await expect(dialog.getByText(/MiniMax; GPT-6 Luna may be used as fallback/)).toBeVisible();
        await expect(dialog.getByText('Model gateway limits apply.')).toBeVisible();
        await expect(dialog.getByLabel(/access code/i)).toHaveCount(0);
        await dialog.getByLabel('Paste text').fill('A test memory');
        await expect(dialog.getByRole('button', { name: 'Analyze memories' })).toBeDisabled();
        assert.equal(posts, 0);
        await dialog.getByRole('checkbox').check();
        await dialog.getByRole('button', { name: 'Analyze memories' }).click();
        await expect(dialog.getByRole('alert')).toContainText('quota');
        await expect(page.locator('.memory-active')).toContainText('A public memory');
        failure = 'job';
        await dialog.getByRole('button', { name: 'Analyze memories' }).click();
        await expect(dialog.getByRole('alert')).toContainText('quota');
        failure = null;
        await dialog.getByRole('button', { name: 'Analyze memories' }).click();
        await dialog.getByRole('button', { name: 'Use these memories' }).click();
        await expect(page.locator('.memory-active')).toContainText('A test memory');
        await expect(page.locator('.memory-source-status').first()).toContainText('Your memories');
        await expect(page.getByRole('combobox', { name: 'Print behavior' })).toHaveValue('analyzed');
        await expect(page.locator('.memory-demo-note')).not.toContainText('random');
        await expect(page.getByRole('button', { name: 'Start printing from the workbench', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: 'About memories' }).click();
        await page.getByRole('button', { name: 'Reload default memories' }).click();
        await expect(page.locator('.memory-demo-note')).toContainText('random demo');
        await expect(page.getByRole('button', { name: 'Start printing from the workbench', exact: true })).toBeDisabled();
      } finally {
        await page.close();
        await new Promise(resolve => server.httpServer.close(resolve));
      }
    }
  } finally {
    await browser?.close();
    for (const [key, value] of Object.entries({ VITE_PUBLIC_DEMO_SCORES: previous.demo, VITE_PUBLIC_ANALYSIS: previous.analysis })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('verified default scores set the initial mode without overriding an explicit choice', { timeout: 120000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pottery-scored-test-'));
  const previous = process.env.VITE_PUBLIC_DEMO_SCORES;
  let browser, server;
  try {
    process.env.VITE_PUBLIC_DEMO_SCORES = '1';
    await build({ root, configFile: false, logLevel: 'error', build: { outDir: dir, emptyOutDir: true } });
    server = await preview({ root, configFile: false, logLevel: 'error', build: { outDir: dir }, preview: { port: 0, host: '127.0.0.1' } });
    browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const corpus = JSON.stringify(Array.from({ length: 1910 }, (_, i) => `Public memory ${i}`));
    const sidecar = { version: 1, model: 'MiniMax-fixture', prompt: 'fixture-v1', corpusSha256: createHash('sha256').update(corpus).digest('hex'), scores: Array.from({ length: 1910 }, () => scores) };
    for (const explicit of [false, true]) {
      const page = await browser.newPage();
      let release;
      const waiting = new Promise(resolve => { release = resolve; });
      let started;
      const requested = new Promise(resolve => { started = resolve; });
      try {
        await page.route('**/memories.json', route => route.fulfill({ body: corpus, contentType: 'application/json' }));
        await page.route('**/default-memory-scores.json', async route => { started(); await waiting; await route.fulfill({ json: sidecar }); });
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
        await requested;
        const mode = page.getByRole('combobox', { name: 'Print behavior' });
        if (explicit) await mode.selectOption('collective');
        release();
        await expect(page.getByText('Public memories · analyzed scores')).toBeVisible();
        await expect(mode).toHaveValue(explicit ? 'collective' : 'analyzed');
        await expect(page.getByText('Scores are random, not analyzed.')).toHaveCount(0);
      } finally { release(); await page.close(); }
    }
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.httpServer.close(resolve));
    if (previous === undefined) delete process.env.VITE_PUBLIC_DEMO_SCORES; else process.env.VITE_PUBLIC_DEMO_SCORES = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
