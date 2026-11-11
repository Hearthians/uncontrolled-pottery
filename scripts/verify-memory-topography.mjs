import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { build, preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import { TOPOGRAPHY_ANIMATION } from '../src/topographyAnimation.ts';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, 'artifacts/memory-topography');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0 } });
const address = server.httpServer.address(), url = `http://127.0.0.1:${address.port}`;
const scratch = await mkdtemp(join(tmpdir(), 'pottery-topography-'));
const report = { desktop: false, mobile: false, singleWork: false, comparisonRoute: false,
  decoder: 'count-diversity-plump-strand-4', nozzleTracksPath: false, nozzlePauses: false,
  nozzleHiddenAfterPrinting: false, nozzleLayerSeam: null,
  animation: false, pauseResume: false, replay: false, rotation: false, reducedMotion: false,
  mouseRotate: false, wheelZoom: false, touchRotate: false, pinchZoom: false,
  resetView: false, manualViewStopsTurntable: false, inspectionAngles: {},
  offscreenPause: false, missingData: false, mismatchedCorpus: false, subpath: false, maxDropMm: 0, bands: [] };
const canvasImage = page => page.locator('.topography-canvas canvas').evaluate(canvas => canvas.toDataURL('image/png'));
const imageHash = image => createHash('sha256').update(image).digest('hex');
const nozzleState = page => page.locator('.topography-canvas').evaluate(node => ({
  x: Number(node.dataset.nozzleX), y: Number(node.dataset.nozzleY), z: Number(node.dataset.nozzleZ),
  path: Number(node.dataset.nozzlePath), visible: node.dataset.nozzleVisible === 'true',
}));
const advance = async (page, milliseconds) => {
  // Fast-forward schedules one frame after the interval, avoiding thousands of
  // software-rendered frames while still exercising the normal animation loop.
  await page.clock.fastForward(milliseconds);
  await page.clock.runFor(32);
};
const clickControl = async (page, name, restartCompleted = false) => {
  const work = page.locator('.topography-object');
  const restarts = name === 'Replay animation' || restartCompleted;
  await page.getByRole('button', { name, exact: true }).click();
  await expect(work).toHaveAttribute('data-playing', name === 'Pause animation' ? 'false' : 'true');
  if (restarts) await expect.poll(async () => {
    await page.clock.runFor(128);
    return Number(await work.getAttribute('data-progress'));
  }, { timeout: 15_000, intervals: [20] }).toBeLessThan(0.02);
  // Commit React effects and initialize the newly resumed RAF clock before a jump.
  await page.clock.runFor(128);
};
const viewState = page => page.locator('.topography-canvas').evaluate(node => ({
  azimuth: Number(node.dataset.viewAzimuth), polar: Number(node.dataset.viewPolar),
  zoom: Number(node.dataset.viewZoom), manual: node.dataset.viewManual === 'true',
}));
const settleView = async page => {
  let previous = '', stable = 0;
  for (let step = 0; step < 40; step++) {
    await page.clock.runFor(160);
    const current = JSON.stringify(await viewState(page));
    stable = current === previous ? stable + 1 : 0;
    if (stable >= 2) return;
    previous = current;
  }
  throw new Error('The inspection camera did not settle');
};
const dragView = async (page, dx, dy = 0) => {
  await page.locator('.topography-canvas').scrollIntoViewIfNeeded();
  const box = await page.locator('.topography-canvas canvas').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 }); await page.mouse.up();
  await settleView(page);
};
const resetView = async page => {
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect.poll(async () => { await page.clock.runFor(128); return (await viewState(page)).manual; },
    { timeout: 15_000, intervals: [20] }).toBe(false);
  await settleView(page);
};
const orbitTo = async (page, target) => {
  for (let step = 0; step < 12; step++) {
    const delta = Math.atan2(Math.sin(target - (await viewState(page)).azimuth), Math.cos(target - (await viewState(page)).azimuth));
    if (Math.abs(delta) < 0.01) return;
    const box = await page.locator('.topography-canvas canvas').boundingBox();
    await dragView(page, -Math.max(-0.7, Math.min(0.7, delta)) * box.height / (Math.PI * 2 * 0.6));
  }
  throw new Error('Could not reach the inspection angle by dragging');
};
const saveArtwork = async (page, name) => {
  const image = await canvasImage(page);
  await writeFile(join(artifacts, name), Buffer.from(image.split(',')[1], 'base64'));
};
const waitVisibility = (page, visible) => page.locator('.topography-canvas').evaluate((canvas, visible) =>
  new Promise(resolve => {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting === visible) { observer.disconnect(); resolve(); }
    });
    observer.observe(canvas);
  }), visible);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1280 } });
  await page.clock.install();
  const errors = [], apiRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (request.url().includes('/api/')) apiRequests.push(request.url()); });
  await page.goto(`${url}/?lab=memory-regions`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.topography-object[data-ready="true"]')).toHaveCount(1, { timeout: 60_000 });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const work = page.locator('.topography-object');
  const attribute = name => work.getAttribute(`data-${name}`);
  await expect(work).toHaveAttribute('data-decoder', report.decoder);
  await expect(page.locator('.topography-canvas canvas')).toHaveCount(1);
  await expect(page.locator('.topography-legend')).toHaveCount(4);
  await expect(page.getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Pause animation', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replay animation', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset view', exact: true })).toBeVisible();
  await expect(page.getByRole('slider')).toHaveCount(0);
  await expect(page.locator('.memory-emotion-tags')).toHaveCount(0);
  const output = page.locator('.topography-render-metrics');
  await expect(output).toHaveAttribute('data-count', '1910');
  await expect(output).toHaveAttribute('data-layers', '64');
  report.maxDropMm = Number(await output.getAttribute('data-drop'));
  report.bands = JSON.parse(await output.getAttribute('data-bands'));
  assert.ok(report.maxDropMm > 25 && report.maxDropMm <= 28,
    'the existing strong local sag should remain visible and bounded');
  assert.deepEqual(errors, []);
  assert.deepEqual(apiRequests, []);
  report.singleWork = true;
  const imageData = await page.locator('a[download="memory-topography.png"]').getAttribute('href');
  await writeFile(join(artifacts, 'vessel.png'), Buffer.from(imageData.split(',')[1], 'base64'));

  await clickControl(page, 'Replay animation');
  await advance(page, 100);
  const firstImage = imageHash(await canvasImage(page));
  const firstProgress = Number(await attribute('progress'));
  const firstNozzle = await nozzleState(page);
  assert.equal(firstNozzle.visible, true);
  assert.ok(['x', 'y', 'z', 'path'].every(key => Number.isFinite(firstNozzle[key])));
  await advance(page, 10_000);
  await expect(work).toHaveAttribute('data-phase', 'printing');
  assert.ok(Number(await attribute('progress')) > firstProgress,
    `printing progress should advance from ${firstProgress}, got ${await attribute('progress')}`);
  assert.ok(Number(await attribute('layer')) > 1 && Number(await attribute('layer')) < 64);
  const advancedNozzle = await nozzleState(page);
  assert.equal(advancedNozzle.visible, true);
  assert.ok(advancedNozzle.path > firstNozzle.path && advancedNozzle.y > firstNozzle.y);
  assert.ok(Math.hypot(advancedNozzle.x - firstNozzle.x, advancedNozzle.y - firstNozzle.y,
    advancedNozzle.z - firstNozzle.z) > 5);
  report.nozzleTracksPath = true;
  // Bracket an integer turn using the rendered source coordinates. The nozzle
  // must gain only the continuous pitch, rather than jump a full layer at a seam.
  const seam = Math.floor(advancedNozzle.path) + 2;
  await advance(page, (seam - 0.2 - advancedNozzle.path) * TOPOGRAPHY_ANIMATION.printSeconds / 64 * 1000);
  const beforeSeam = await nozzleState(page);
  await page.clock.runFor(220);
  const afterSeam = await nozzleState(page);
  assert.ok(beforeSeam.path < seam && afterSeam.path >= seam,
    `expected samples around turn ${seam}, got ${beforeSeam.path} and ${afterSeam.path}`);
  const pathStep = afterSeam.path - beforeSeam.path;
  assert.ok(Math.abs(afterSeam.y - beforeSeam.y - 4 * pathStep) < 0.2,
    'the nozzle should rise smoothly across the nominal 4 mm layer boundary');
  report.nozzleLayerSeam = { turn: seam, before: beforeSeam, after: afterSeam };
  const partialImage = await canvasImage(page);
  assert.notEqual(imageHash(partialImage), firstImage, 'printing must change actual canvas pixels');
  await writeFile(join(artifacts, 'printing.png'), Buffer.from(partialImage.split(',')[1], 'base64'));

  await clickControl(page, 'Pause animation');
  await advance(page, 64);
  await expect(work).toHaveAttribute('data-playing', 'false');
  const pausedProgress = await attribute('progress');
  const pausedImage = imageHash(await canvasImage(page));
  const pausedNozzle = await nozzleState(page);
  await advance(page, 3000);
  assert.equal(await attribute('progress'), pausedProgress);
  assert.equal(imageHash(await canvasImage(page)), pausedImage, 'pause must freeze geometry and camera');
  assert.deepEqual(await nozzleState(page), pausedNozzle, 'pause must also freeze the nozzle');
  report.nozzlePauses = true;
  await clickControl(page, 'Play animation');
  await advance(page, 1000);
  assert.ok(Number(await attribute('progress')) > Number(pausedProgress));
  report.pauseResume = true;

  await clickControl(page, 'Replay animation');
  await advance(page, TOPOGRAPHY_ANIMATION.printSeconds * 1000 + 100);
  await expect(work).toHaveAttribute('data-phase', 'settling');
  assert.equal((await nozzleState(page)).visible, false);
  await advance(page, (TOPOGRAPHY_ANIMATION.settleSeconds + TOPOGRAPHY_ANIMATION.settleDelaySeconds) * 1000);
  await expect(work).toHaveAttribute('data-phase', 'complete');
  await expect(work).toHaveAttribute('data-layer', '64');
  assert.equal((await nozzleState(page)).visible, false);
  report.nozzleHiddenAfterPrinting = true;
  assert.notEqual(imageHash(await canvasImage(page)), imageHash(partialImage));
  report.animation = true;
  const rotation = Number(await attribute('rotation'));
  const completedImage = imageHash(await canvasImage(page));
  await advance(page, 4000);
  assert.ok(Math.abs(Number(await attribute('rotation')) - rotation) > 0.01);
  assert.notEqual(imageHash(await canvasImage(page)), completedImage, 'completed vessel must rotate visibly');
  report.rotation = true;

  await clickControl(page, 'Pause animation');
  await settleView(page);
  const originalView = await viewState(page), inspectionProgress = await attribute('progress');
  const beforeDrag = imageHash(await canvasImage(page));
  await dragView(page, 200, -40);
  const draggedView = await viewState(page);
  assert.ok(Math.abs(draggedView.azimuth - originalView.azimuth) > 0.1);
  assert.ok(Math.abs(draggedView.polar - originalView.polar) > 0.02);
  assert.equal(draggedView.manual, true);
  assert.notEqual(imageHash(await canvasImage(page)), beforeDrag);
  report.mouseRotate = true;
  const wheelBox = await page.locator('.topography-canvas canvas').boundingBox();
  await page.mouse.move(wheelBox.x + wheelBox.width / 2, wheelBox.y + wheelBox.height / 2);
  await page.mouse.wheel(0, -350); await settleView(page);
  assert.ok((await viewState(page)).zoom > draggedView.zoom);
  assert.equal(await attribute('progress'), inspectionProgress);
  await expect(work).toHaveAttribute('data-playing', 'false');
  report.wheelZoom = true;
  await clickControl(page, 'Play animation');
  await settleView(page);
  const inspectedRotation = await attribute('rotation'), inspectedImage = imageHash(await canvasImage(page));
  await advance(page, 3000);
  assert.equal(await attribute('rotation'), inspectedRotation);
  assert.equal(imageHash(await canvasImage(page)), inspectedImage, 'manual inspection must stop automatic turning');
  report.manualViewStopsTurntable = true;
  await clickControl(page, 'Pause animation');
  await resetView(page);
  const restoredView = await viewState(page);
  for (const key of ['azimuth', 'polar', 'zoom']) assert.ok(Math.abs(restoredView[key] - originalView[key]) < 1e-5);
  assert.equal(await attribute('progress'), inspectionProgress);
  await expect(work).toHaveAttribute('data-playing', 'false');
  report.resetView = true;
  await saveArtwork(page, 'inspection-front.png');
  report.inspectionAngles.front = await viewState(page);
  await orbitTo(page, originalView.azimuth + Math.PI / 2);
  await saveArtwork(page, 'inspection-side.png');
  report.inspectionAngles.side = await viewState(page);
  await orbitTo(page, originalView.azimuth + Math.PI);
  await saveArtwork(page, 'inspection-back.png');
  report.inspectionAngles.back = await viewState(page);
  await resetView(page);
  await page.screenshot({ path: join(artifacts, 'desktop.png'), fullPage: true });
  report.desktop = true;
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(artifacts, 'mobile.png'), fullPage: true });
  report.mobile = true;

  await page.setViewportSize({ width: 1440, height: 1280 });
  await clickControl(page, 'Replay animation');
  await advance(page, 100);
  await expect(work).toHaveAttribute('data-phase', 'printing');
  assert.ok(Number(await attribute('progress')) < firstProgress + 0.01);
  report.replay = true;
  await page.setViewportSize({ width: 1440, height: 300 });
  await page.locator('.topography-footer').scrollIntoViewIfNeeded();
  await waitVisibility(page, false);
  await page.clock.runFor(128);
  const offscreenProgress = await attribute('progress');
  await advance(page, 3000);
  assert.equal(await attribute('progress'), offscreenProgress, 'offscreen animation must not advance');
  await page.locator('.topography-image').scrollIntoViewIfNeeded();
  await waitVisibility(page, true);
  await page.clock.runFor(128);
  await advance(page, 1000);
  assert.ok(Number(await attribute('progress')) > Number(offscreenProgress));
  report.offscreenPause = true;
  assert.deepEqual(errors, []);
  assert.deepEqual(apiRequests, []);
  await page.close();

  const reduced = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1280 } });
  await reduced.clock.install();
  await reduced.goto(`${url}/?lab=memory-topography`);
  const reducedWork = reduced.locator('.topography-object');
  await expect(reducedWork).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await reduced.clock.pauseAt(await reduced.evaluate(() => Date.now() + 1000));
  await expect(reducedWork).toHaveAttribute('data-phase', 'complete');
  await expect(reducedWork).toHaveAttribute('data-playing', 'false');
  assert.equal((await nozzleState(reduced)).visible, false);
  const reducedImage = imageHash(await canvasImage(reduced));
  await advance(reduced, 4000);
  assert.equal(imageHash(await canvasImage(reduced)), reducedImage);
  await clickControl(reduced, 'Play animation', true);
  await advance(reduced, 2000);
  await expect(reducedWork).toHaveAttribute('data-playing', 'true');
  await expect(reducedWork).toHaveAttribute('data-phase', 'printing');
  assert.notEqual(imageHash(await canvasImage(reduced)), reducedImage);
  report.reducedMotion = true;
  await reduced.close();

  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
  const touchErrors = [];
  touch.on('pageerror', error => touchErrors.push(error.message));
  touch.on('console', message => { if (message.type() === 'error') touchErrors.push(message.text()); });
  await touch.clock.install();
  await touch.goto(`${url}/?lab=memory-topography`);
  const touchWork = touch.locator('.topography-object');
  await expect(touchWork).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await touch.clock.pauseAt(await touch.evaluate(() => Date.now() + 500));
  await settleView(touch);
  await touch.locator('.topography-canvas').scrollIntoViewIfNeeded();
  const touchBox = await touch.locator('.topography-canvas canvas').boundingBox();
  const tx = touchBox.x + touchBox.width / 2, ty = touchBox.y + touchBox.height / 2;
  const initialTouchView = await viewState(touch), touchProgress = await touchWork.getAttribute('data-progress');
  const initialTouchImage = imageHash(await canvasImage(touch));
  const cdp = await touch.context().newCDPSession(touch);
  const finger = (x, y, id = 0) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(tx, ty)] });
  for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [finger(tx + step * 10, ty - step * 3)],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settleView(touch);
  const draggedTouchView = await viewState(touch);
  assert.ok(Math.abs(draggedTouchView.azimuth - initialTouchView.azimuth) > 0.1);
  assert.notEqual(imageHash(await canvasImage(touch)), initialTouchImage);
  report.touchRotate = true;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(tx - 30, ty, 0), finger(tx + 30, ty, 1)] });
  for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [finger(tx - 30 - step * 5, ty, 0), finger(tx + 30 + step * 5, ty, 1)],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await settleView(touch);
  assert.ok((await viewState(touch)).zoom > draggedTouchView.zoom);
  assert.equal(await touchWork.getAttribute('data-progress'), touchProgress);
  await expect(touchWork).toHaveAttribute('data-playing', 'false');
  report.pinchZoom = true;
  await resetView(touch);
  const resetTouchView = await viewState(touch);
  for (const key of ['azimuth', 'polar', 'zoom']) assert.ok(Math.abs(resetTouchView[key] - initialTouchView[key]) < 1e-5);
  assert.deepEqual(touchErrors, []);
  await touch.close();

  const old = await browser.newPage();
  await old.goto(`${url}/?lab=memory-comparison`);
  await expect(old.locator('.region-work')).toHaveCount(4);
  report.comparisonRoute = true;
  await old.close();

  const missing = await browser.newPage();
  await missing.route('**/memory-topography.json', route => route.fulfill({ status: 404 }));
  await missing.goto(`${url}/?lab=memory-regions`);
  await expect(missing.getByRole('alert')).toContainText('could not be loaded');
  await expect(missing.locator('.topography-object')).toHaveCount(0);
  report.missingData = true;
  await missing.close();
  const invalid = await browser.newPage();
  const data = JSON.parse(await readFile(join(root, 'public/memory-topography.json'), 'utf8'));
  data.corpusSha256 = '0'.repeat(64);
  await invalid.route('**/memory-topography.json', route => route.fulfill({ json: data }));
  await invalid.goto(`${url}/?lab=memory-regions`);
  await expect(invalid.getByRole('alert')).toContainText('do not match');
  report.mismatchedCorpus = true;
  await invalid.close();

  const outDir = join(scratch, 'dist');
  await build({ root, base: '/pottery/', build: { outDir, emptyOutDir: true }, logLevel: 'warn' });
  const sub = await preview({ root, base: '/pottery/', build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
  try {
    const p = await browser.newPage();
    const requests = [];
    p.on('request', request => { if (/\/(memories|memory-topography)\.json/.test(request.url())) requests.push(request.url()); });
    await p.goto(`http://127.0.0.1:${sub.httpServer.address().port}/pottery/?lab=memory-topography`);
    await expect(p.locator('.topography-object[data-ready="true"]')).toHaveCount(1, { timeout: 60_000 });
    assert.equal(requests.length, 2);
    assert.ok(requests.every(value => value.includes('/pottery/')));
    report.subpath = true;
    await p.close();
  } finally { await new Promise(resolve => sub.httpServer.close(resolve)); }
  await writeFile(join(artifacts, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
