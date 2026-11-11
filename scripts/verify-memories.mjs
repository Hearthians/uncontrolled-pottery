// Browser checks use fabricated test entries only, in a fresh local browser session.
import { chromium, expect } from "@playwright/test";
import { mockDefaultMemories, MEMORY_FIXTURE } from "./memory-fixture.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { TOTAL_STEPS } from "../src/simulation.ts";
import { MAX_MEMORY_FILE_BYTES, memoryIndexAtStep, memoryPassageAtStep, parseMemories } from "../src/memoryPlayback.ts";

const baseUrl = process.env.POTTERY_MEMORIES_URL || "http://127.0.0.1:5173";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname), "Run memory verification only against a local server.");
const output = new URL("../artifacts/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const errors = [];
const upload = async (page, data) => {
  let entries;
  try {
    const parsed = parseMemories(Buffer.isBuffer(data) ? data.toString() : JSON.stringify(data));
    entries = parsed.map(({text}, index) => ({ id: `fixture-${index}`, text, scores: {calm:0, anxiety:0, anger:0, stress:0, sadness:0}, status:'analyzed', source:{block:index,start:0,end:text.length} }));
  } catch { entries = null; }
  await page.route('**/api/memories/jobs**', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ status:202, json:{id:'test',token:'test'} });
    if (route.request().method() === 'DELETE') return route.fulfill({ json:{id:'test',status:'cancelled',progress:{completed:0,total:0}} });
    return route.fulfill({ json: entries ? {id:'test',status:'completed',progress:{completed:entries.length,total:entries.length},entries} : {id:'test',status:'failed',progress:{completed:0,total:0},error:'Invalid test input'} });
  });
  await page.locator('.memory-playback button[aria-label="Replace"], .memory-playback button[aria-label="Load memories"]').first().click();
  const dialog = page.getByRole('dialog', {name:'Analyze memories'});
  await dialog.getByLabel('Paste text').fill('Fabricated test fixture');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', {name:'Analyze memories'}).click();
  if (entries) { await dialog.getByRole('button', {name:'Use these memories'}).click(); }
  else { await expect(dialog.getByRole('alert')).toBeVisible(); await dialog.getByRole('button', {name:'Close memory import'}).click(); }
  await page.unroute('**/api/memories/jobs**');
};
const current = (page) => page.locator(".memory-playback").getAttribute("data-current-index").then(Number);
const nodes = (page) => page.locator(".viewport canvas").evaluate((canvas) => Number(canvas.dataset.nodes));
async function assertBounded(page) {
  await expect(page.locator('.memory-active[aria-current="step"]')).toHaveCount(1);
  const state = await page.locator('.memory-carousel').evaluate((carousel) => ({
    count: carousel.querySelectorAll('.memory-slide').length,
    outgoingHidden: [...carousel.querySelectorAll('.memory-outgoing')].every((slide) => slide.inert && slide.getAttribute('aria-hidden') === 'true'),
  }));
  assert.ok(state.count >= 1 && state.count <= 2, "only the current and outgoing original may be mounted");
  assert.equal(state.outgoingHidden, true);
}
const active = (page) => page.locator('.memory-active');
const displayed = (page) => page.locator('.memory-playback').getAttribute('data-displayed-index').then(Number);
const animations = (page) => page.locator('.memory-carousel').evaluate((node) => node.getAnimations({ subtree: true }).length);
async function settled(page) {
  await expect(page.locator('.memory-outgoing')).toHaveCount(0);
  await expect.poll(() => animations(page)).toBe(0);
  await assertBounded(page);
}
async function assertMemoryHierarchy(page) {
  const type = await page.locator(".memory-panel").evaluate((panel) => {
    const style = (selector) => getComputedStyle(panel.querySelector(selector));
    const empty = style(".memory-empty > p");
    return { empty: parseFloat(empty.fontSize), title: !!panel.querySelector('.emotion-plan-copy'), emotion: !!panel.querySelector('.memory-emotion-tags') };
  });
  assert.equal(type.title, false, "the collection title is absent from the studio panel");
  assert.equal(type.emotion, false, "there is no emotion label without a displayed memory");
  assert.ok(type.empty <= 14, "the empty-state slogan stays secondary");
  await assertPanelLayout(page);
}
async function assertPanelLayout(page) {
  const boxes = await page.locator(".memory-panel").evaluate((panel) => {
    const rect = (node) => { const b = node.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
    const carousel = panel.querySelector('.memory-carousel');
    const emotion = panel.querySelector('.memory-playback > .memory-emotion-tags');
    return { panel: rect(panel), body: rect(panel.querySelector(".memory-panel-scroll")), actions: rect(panel.querySelector(".print-actions")),
      carousel: carousel ? rect(carousel) : null, emotion: emotion ? rect(emotion) : null,
      title: !!panel.querySelector('.emotion-plan-copy'), horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  assert.equal(boxes.title, false, "the collection title is absent from the studio panel");
  if (boxes.carousel) assert.ok(boxes.emotion.top >= boxes.carousel.bottom - 1 && boxes.emotion.bottom <= boxes.actions.top,
    "the emotion stays between the reading region and print actions");
  assert.ok(boxes.actions.top >= boxes.body.bottom - 1, "actions cannot overlap the scrolling panel");
  assert.ok(boxes.actions.bottom <= boxes.panel.bottom + 1, "actions stay within the panel");
  assert.equal(boxes.horizontalOverflow, false);
}

try {
  const loadingPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  loadingPage.on('pageerror', (error) => errors.push(error.message));
  const loadingContext = loadingPage.context();
  let requests = 0;
  let releaseLoad;
  const gate = new Promise((resolve) => { releaseLoad = resolve; });
  await loadingContext.route('**/memories.json', async (route) => {
    requests++;
    await gate;
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Unavailable"}' }).catch(() => {});
  });
  await loadingPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => requests, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(loadingPage.locator('.memory-playback')).toHaveAttribute('data-source-state', 'loading');
  await expect(loadingPage.getByRole('button', { name: 'Start printing from the workbench', exact: true })).toBeDisabled();
  await expect(loadingPage.locator('.print-actions').getByRole('button', { name: /^Start print/ })).toBeDisabled();
  assert.equal(await loadingPage.locator('.memory-active').count(), 0);
  releaseLoad();
  await expect(loadingPage.locator('.memory-playback')).toHaveAttribute('data-source-state', 'error');
  await expect(loadingPage.getByRole('alert')).toContainText('Default memories could not be loaded');
  await expect(loadingPage.getByRole('button', { name: 'Start printing from the workbench', exact: true })).toBeDisabled();
  await loadingContext.unroute('**/memories.json');
  let releaseRetry;
  const retryGate = new Promise((resolve) => { releaseRetry = resolve; });
  await loadingContext.route('**/memories.json', async (route) => {
    requests++;
    await retryGate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(['Stale automatic original']) }).catch(() => {});
  });
  await loadingPage.getByRole('button', { name: 'Reload default memories', exact: true }).click();
  await expect(loadingPage.locator('.memory-playback')).toHaveAttribute('data-source-state', 'loading');
  await upload(loadingPage, ['Manual replacement wins']);
  await expect(active(loadingPage).locator('p')).toHaveText('Manual replacement wins');
  releaseRetry();
  await loadingPage.waitForTimeout(150);
  await expect(active(loadingPage).locator('p')).toHaveText('Manual replacement wins');
  await expect(loadingPage.getByRole('button', { name: 'Start printing from the workbench', exact: true })).toBeEnabled();
  const countBeforeGallery = requests;
  await loadingPage.getByRole('button', { name: 'Gallery', exact: true }).click();
  await loadingPage.getByRole('button', { name: 'Print studio', exact: true }).click();
  assert.equal(requests, countBeforeGallery, 'carousel remount cannot reload the default corpus');
  await expect(active(loadingPage).locator('p')).toHaveText('Manual replacement wins');
  await loadingPage.close();

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await mockDefaultMemories(page.context());
  page.on("pageerror", (error) => errors.push(error.message));
  const uploads = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) uploads.push(request.method());
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole('combobox', { name: 'Print physics model' })).toHaveValue('strand');
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByText("The default collection contains 1,910 public memories. If you explicitly analyze your own content, it is sent to this website’s analysis service and configured model gateway. It is not saved with the pottery.", { exact: true }).count(), 0);
  await expect(page.locator('.memory-counter')).toHaveText('01/4');
  await expect(active(page).locator('p')).toHaveText(MEMORY_FIXTURE[0]);
  await page.getByRole("button", { name: "About memories", exact: true }).click();
  await expect(page.getByText("The default collection contains 1,910 public memories. If you explicitly analyze your own content, it is sent to this website’s analysis service and configured model gateway. It is not saved with the pottery.", { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear memories', exact: true }).click();
  await expect(page.getByRole("button", { name: "Load memories", exact: true })).toBeVisible();
  assert.equal(await page.locator(".memory-active").count(), 0, "no invented text in the empty state");
  const importStyle = await page.locator(".memory-load").evaluate((button) => {
    const style = getComputedStyle(button);
    return { height: button.getBoundingClientRect().height, background: style.backgroundColor, opacity: style.opacity };
  });
  assert.ok(importStyle.height >= 48, "memory import retains a comfortably sized hit target");
  assert.notEqual(importStyle.background, "rgba(0, 0, 0, 0)");
  assert.equal(importStyle.opacity, "1");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertMemoryHierarchy(page);
    if (width === 390) await page.screenshot({ path: new URL("memories-empty-phone.png", output).pathname, fullPage: true });
  }
  await page.screenshot({ path: new URL("memories-empty-prominent.png", output).pathname, fullPage: true });
  await expect(page.getByRole('button', { name: 'Start printing from the workbench', exact: true })).toBeDisabled();
  await expect(page.locator('.print-actions').getByRole('button', { name: /^Start print/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Reload default memories', exact: true }).click();
  await expect(page.locator('.memory-counter')).toHaveText('01/4');
  await page.getByRole("button", { name: "Start printing from the workbench", exact: true }).click();
  await page.getByRole("button", { name: "Pause print", exact: false }).click();
  await expect(page.getByRole('button', { name: 'Replace', exact: true })).toBeDisabled();
  await page.screenshot({ path: new URL("memories-locked-prominent.png", output).pathname, fullPage: true });
  const labOpening = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open physics lab in a new tab", exact: true }).click();
  const lab = await labOpening;
  await expect(lab.getByRole("heading", { name: "Deposition, up close.", exact: true })).toBeVisible();
  assert.equal(new URL(lab.url()).searchParams.get("lab"), "deposition");
  await lab.close();
  await expect(page.getByRole("button", { name: "Resume print", exact: false })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });

  await upload(page, [
    { activity: "Test memory 1", name: "Test private name", date: "2099-01-01" },
    { content: "Test memory 2", date: "2000-01-01" },
    "Test memory 3 <b>literal text</b>",
  ]);
  await expect(page.locator(".memory-counter")).toHaveText("01/3");
  assert.equal(await page.getByText("Test private name", { exact: true }).count(), 0);
  assert.equal(await page.locator(".memory-active b").count(), 0, "text never becomes HTML");
  await expect(page.locator(".memory-active").first()).toContainText("Test memory 1");

  // Long text scrolls inside the carousel; the emotion remains outside and visible.
  const longPlacementOriginal = 'Long original. '.repeat(120) + 'END OF ORIGINAL';
  await upload(page, [longPlacementOriginal]);
  const reading = active(page);
  const emotionLabel = page.locator('.memory-playback > .memory-emotion-tags');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await assertPanelLayout(page);
    await expect(emotionLabel).toBeVisible();
    const placement = await page.locator('.memory-playback').evaluate((panel) => {
      const slide = panel.querySelector('.memory-active'), carousel = panel.querySelector('.memory-carousel');
      const tag = panel.querySelector(':scope > .memory-emotion-tags');
      const canvas = carousel.getBoundingClientRect(), label = tag.getBoundingClientRect();
      const start = { y: label.y, opacity: getComputedStyle(tag).opacity };
      slide.scrollTop = slide.scrollHeight;
      const end = tag.getBoundingClientRect();
      return { overflow: slide.scrollHeight > slide.clientHeight, nested: !!slide.querySelector('.memory-emotion-tags'),
        below: label.top >= canvas.bottom - 1, within: label.bottom <= panel.getBoundingClientRect().bottom,
        delta: end.y - start.y, opacity: start.opacity, value: tag.textContent };
    });
    assert.equal(placement.overflow, true);
    assert.equal(placement.nested, false);
    assert.equal(placement.below && placement.within, true, 'the tag stays visible below the reading region');
    assert.ok(Math.abs(placement.delta) < 1 && placement.opacity === '1' && placement.value.trim(),
      'scrolling a long memory cannot move or fade its separate emotion label');
    await expect(emotionLabel).toBeVisible();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await upload(page, Array.from({ length: 2000 }, (_, index) => ({ activity: `Test memory ${index + 1}`, name: `Test private name ${index + 1}` })));
  await expect(page.locator(".memory-counter")).toHaveText("01/2000");
  await expect(page.getByText("Selected passages", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "About memories", exact: true }).click();
  await expect(page.locator(".memory-information")).toContainText("The print follows the preset collective arc.");
  await expect(page.locator(".memory-information")).toContainText("Use the arrows to read every memory.");
  await page.keyboard.press("Escape");
  await assertBounded(page);
  for (const invalid of [Buffer.from("{bad JSON"), ["Test replacement", null], Array(2001).fill("Test excess memory"), Buffer.alloc(MAX_MEMORY_FILE_BYTES + 1, 32)]) {
    await upload(page, invalid);
    await expect(page.locator('.memory-active')).toBeVisible();
    await expect(page.locator(".memory-counter")).toHaveText("01/2000");
  }
  // Successful replacement also clears the error without persisting the filename.
  await upload(page, Array.from({ length: 2000 }, (_, index) => `Test memory ${index + 1}`));
  await expect(page.getByRole("alert")).toHaveCount(0);
  await assertPanelLayout(page);
  await page.locator(".print-actions").getByRole("button", { name: "Start print" }).click();
  await expect(page.getByRole("button", { name: "Replace", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "About memories", exact: true }).click();
  await expect(page.getByText("Import and clear are locked until this print finishes, including while paused.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => current(page), { timeout: 20_000 }).toBeGreaterThan(35);
  await page.getByRole("button", { name: "Pause print", exact: false }).click();
  const paused = await current(page);
  const pausedPassage = await displayed(page);
  assert.equal(paused, memoryIndexAtStep(await nodes(page), 2000, TOTAL_STEPS));
  const pausedEmotion = await page.locator('.memory-playback > .memory-emotion-tags').textContent();
  await page.getByRole('button', { name: 'Read next memory', exact: true }).click();
  await expect(page.locator('.memory-playback > .memory-emotion-tags')).toHaveText(pausedEmotion);
  await expect(page.getByRole('button', { name: 'Auto-follow off', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Auto-follow off', exact: true }).click();
  await expect(page.locator('.viewport .clay-scene')).toHaveAttribute('data-engine', '3');
  await page.waitForTimeout(500);
  assert.equal(await current(page), paused, "pause freezes the current memory");
  assert.equal(await displayed(page), pausedPassage, "pause freezes the displayed original too");
  await expect(page.getByRole("button", { name: "Replace", exact: true })).toBeDisabled();
  await assertBounded(page);
  await assertPanelLayout(page);
  await page.screenshot({ path: new URL("memories-desktop.png", output).pathname, fullPage: true });

  await page.getByRole("button", { name: "Read next memory", exact: true }).click();
  await expect(page.getByRole("button", { name: "Auto-follow off", exact: true })).toHaveAttribute("aria-pressed", "false");
  await settled(page);
  await page.getByRole("button", { name: "Auto-follow off", exact: true }).click();
  await expect(page.locator('.memory-active[aria-current="step"]')).toHaveAttribute("data-memory-index", String(memoryPassageAtStep(await nodes(page), 2000, TOTAL_STEPS)));
  const automatic = await page.locator('.memory-carousel').evaluate((carousel) => {
    const entering = carousel.querySelector('.memory-active').getAnimations()[0];
    const leaving = carousel.querySelector('.memory-outgoing').getAnimations()[0];
    entering.pause(); leaving.pause();
    entering.currentTime = leaving.currentTime = 140;
    const duringExit = Number(getComputedStyle(carousel.querySelector('.memory-active')).opacity);
    entering.currentTime = leaving.currentTime = 280;
    const duringPause = { inOpacity: Number(getComputedStyle(carousel.querySelector('.memory-active')).opacity),
      outOpacity: Number(getComputedStyle(carousel.querySelector('.memory-outgoing')).opacity) };
    entering.currentTime = leaving.currentTime = 400;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(carousel.querySelector('.memory-active')).transform);
    const exitOpacity = Number(getComputedStyle(carousel.querySelector('.memory-outgoing')).opacity);
    entering.play(); leaving.play();
    return { duringExit, duringPause, exitOpacity, x: matrix.m41, y: matrix.m42 };
  });
  assert.equal(automatic.duringExit, 0, 'new original is invisible while the old one fades');
  assert.deepEqual(automatic.duringPause, { inOpacity: 0, outOpacity: 0 }, 'short pause keeps passages from overlapping');
  assert.equal(automatic.exitOpacity, 0);
  assert.equal(automatic.x, 0); assert.ok(automatic.y > 0 && automatic.y < 6, 'automatic following floats upward rather than sliding sideways');
  await settled(page);
  const beforeFollowScroll = await page.evaluate(() => scrollY);
  await page.getByRole("button", { name: "Resume print", exact: false }).click();
  await expect.poll(() => current(page), { timeout: 20_000 }).toBeGreaterThan(paused + 20);
  assert.equal(await page.evaluate(() => scrollY), beforeFollowScroll, "auto-follow cannot scroll the whole page");
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await page.getByRole("button", { name: "Print studio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume print", exact: false })).toBeVisible();
  assert.ok(await current(page) >= paused, "session survives gallery navigation");
  await expect(page.locator(".memory-counter")).toContainText("/2000");

  await page.getByRole("button", { name: "Finish print", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save this work", exact: true })).toBeVisible({ timeout: 20_000 });
  const stopped = await current(page);
  assert.equal(stopped, memoryIndexAtStep(await nodes(page), 2000, TOTAL_STEPS));
  assert.ok(stopped < 1500, "early finishing does not jump to the last memory");
  await expect(page.getByRole("button", { name: "Replace", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save this work", exact: true }).click();
  await page.getByLabel("Work title").fill("Memory feature test work");
  await page.getByRole("button", { name: "Add to gallery", exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("Test memory")), false);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export record", exact: true }).click();
  const record = await readFile(await (await downloadEvent).path(), "utf8");
  assert.equal(record.includes("Test memory"), false, "work archives contain no imported text");
  assert.equal(record.includes("Test private name"), false);
  assert.ok(uploads.every(method => ['POST', 'DELETE'].includes(method)), "only explicitly authorized analysis uses writes");

  await page.getByRole('button', { name: 'About memories', exact: true }).click();
  await page.getByRole('button', { name: 'Clear memories', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print again', exact: true })).toBeDisabled();
  await upload(page, Array.from({ length: 2000 }, (_, index) => `Test memory ${index + 1}`));
  await page.getByRole("button", { name: "Print again", exact: true }).click();
  await page.getByRole("button", { name: "Pause print", exact: false }).click();
  assert.ok(await current(page) < stopped, "new print resets playback");
  await page.getByRole("button", { name: "Auto-follow on", exact: true }).click();
  await expect(page.getByRole("button", { name: "Auto-follow off", exact: true })).toBeVisible();

  // Reload forgets the imported file and reloads the public default collection, not storage.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('.memory-counter')).toHaveText('01/4');
  await expect(active(page).locator('p')).toHaveText(MEMORY_FIXTURE[0]);
  await page.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await mockDefaultMemories(phone.context());
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.equal(await phone.getByRole("dialog").count(), 0);
  await upload(phone, Array.from({ length: 10 }, (_, index) => `Test memory ${index + 1}. Fabricated reading sample for a small screen.`));
  await expect(phone.locator(".memory-counter")).toHaveText("01/10");
  await phone.locator(".print-actions").getByRole("button", { name: "Start print" }).click();
  await phone.getByRole("button", { name: "Pause print", exact: false }).click();
  await assertPanelLayout(phone);
  await expect(phone.getByRole("button", { name: "Resume print", exact: false })).toBeVisible();
  assert.equal(await active(phone).evaluate((slide) => getComputedStyle(slide).scrollBehavior), "auto");
  await phone.getByRole('button', { name: 'Read next memory', exact: true }).click();
  assert.equal(await animations(phone), 0, 'reduced motion skips actual Web Animations');
  await settled(phone);
  assert.equal(await active(phone).locator('p').evaluate((p) => parseFloat(getComputedStyle(p).fontSize)), 32);
  await phone.locator(".memory-playback").scrollIntoViewIfNeeded();
  await phone.screenshot({ path: new URL("memories-phone.png", output).pathname, fullPage: true });
  for (const width of [320, 768, 1024]) {
    await phone.setViewportSize({ width, height: 740 });
    await assertPanelLayout(phone);
  }
  await phone.close();
  // Fictional design fixtures only; never use personal memory text for screenshots.
  const design = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await mockDefaultMemories(design.context());
  design.on("pageerror", (error) => errors.push(error.message));
  const strandUrl = new URL(baseUrl);
  strandUrl.searchParams.set('physics', 'strand');
  await design.goto(strandUrl.href, { waitUntil: "domcontentloaded" });
  await expect(design.getByRole('combobox', { name: 'Print physics model' })).toHaveValue('strand');
  await expect(design.locator('.viewport .clay-scene')).toHaveAttribute('data-render-state', 'ready');
  await upload(design, [
    "The light stayed on\nlong after everyone had left.",
    "We took the longer way home.\nNeither of us asked why.",
    "Rain on the windows.\nAn unfinished conversation.",
    "For a moment,\nthere was nowhere else to be.",
  ]);
  await expect(design.locator(".memory-counter")).toHaveText("01/4");
  await assertPanelLayout(design);
  await design.setViewportSize({ width: 320, height: 844 });
  await assertPanelLayout(design);
  await design.setViewportSize({ width: 1440, height: 1000 });
  const readingType = await design.locator(".memory-panel").evaluate((panel) => {
    const size = (selector) => parseFloat(getComputedStyle(panel.querySelector(selector)).fontSize);
    return { memory: size('.memory-active[aria-current="step"] p'), emotion: size('.memory-playback > .memory-emotion-tags .memory-emotion-tag') };
  });
  assert.ok(readingType.memory >= 36 && readingType.memory >= readingType.emotion * 2,
    "the playing memory is larger than the emotion label");
  const tag = design.locator('.memory-playback > .memory-emotion-tags');
  const tagBefore = await tag.boundingBox();
  await design.getByRole("button", { name: "Read next memory", exact: true }).click();
  await expect(design.locator('.memory-outgoing')).toHaveCount(1);
  await expect(tag).toBeVisible();
  assert.equal(await design.locator('.memory-carousel .memory-emotion-tags').count(), 0, 'slides never duplicate or animate the current emotion');
  assert.equal(await tag.evaluate((node) => node.getAnimations({ subtree: true }).length), 0);
  assert.ok(Math.abs((await tag.boundingBox()).y - tagBefore.y) < 1, 'the tag does not move during a passage transition');
  await assertBounded(design);
  const transition = await design.locator('.memory-carousel').evaluate((carousel) => {
    const animations = carousel.getAnimations({ subtree: true });
    for (const animation of animations) { animation.pause(); animation.currentTime = 325; }
    const current = getComputedStyle(carousel.querySelector('.memory-active'));
    return { count: animations.length, opacity: Number(current.opacity), transform: current.transform };
  });
  assert.ok(transition.count >= 2 && transition.count <= 3);
  assert.ok(transition.opacity > 0 && transition.opacity < 1);
  assert.notEqual(transition.transform, 'none');
  const manualAxes = await design.locator('.memory-active').evaluate((node) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
  assert.ok(manualAxes.x > 0); assert.equal(manualAxes.y, 0, 'manual next moves horizontally');
  await design.screenshot({ path: new URL('memories-carousel-transition.png', output).pathname, fullPage: true });
  await design.locator('.memory-carousel').evaluate((node) => node.getAnimations({ subtree: true }).forEach((animation) => animation.play()));
  await settled(design);
  await assertPanelLayout(design);
  await design.screenshot({ path: new URL("memories-art-desktop.png", output).pathname, fullPage: true });
  await design.setViewportSize({ width: 390, height: 844 });
  await design.waitForTimeout(200);
  await assertPanelLayout(design);
  await design.locator('.memory-panel').evaluate((panel) => window.scrollTo(0, panel.getBoundingClientRect().top + scrollY - 16));
  await design.screenshot({ path: new URL("memories-art-phone.png", output).pathname });
  const lastLine = 'END OF ORIGINAL';
  const longOriginal = 'Long original.\n' + 'x'.repeat(10_000 - 16 - lastLine.length) + '\n' + lastLine;
  assert.equal(longOriginal.length, 10_000);
  await upload(design, [longOriginal, longOriginal, 'Third original.']);
  await expect(design.locator('.memory-counter')).toHaveText('01/3');
  await expect(design.locator('.memory-outgoing')).toHaveCount(0);
  assert.equal(await animations(design), 0, 'replacing a source starts at its first passage without a stale-index transition');
  await expect(design.getByRole('button', { name: 'Read previous memory', exact: true })).toBeDisabled();
  assert.equal(await active(design).locator('p').textContent(), longOriginal, 'the complete original is never summarized or truncated');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await design.setViewportSize({ width, height: 844 });
    await assertPanelLayout(design);
    assert.ok(await active(design).evaluate((slide) => slide.scrollHeight > slide.clientHeight));
    const bottom = await active(design).evaluate((slide) => {
      slide.scrollTop = slide.scrollHeight;
      const text = slide.querySelector('p').firstChild;
      const range = document.createRange();
      range.setStart(text, text.textContent.length - 15); range.setEnd(text, text.textContent.length);
      const end = range.getBoundingClientRect(), box = slide.getBoundingClientRect();
      return end.top >= box.top && end.bottom <= box.bottom + 1;
    });
    assert.equal(bottom, true, 'the final line remains reachable at every size');
  }
  await active(design).focus();
  const pageScroll = await design.evaluate(() => scrollY);
  const wasAtBottom = await active(design).evaluate((slide) => slide.scrollTop);
  await design.keyboard.press('ArrowUp');
  await expect.poll(() => active(design).evaluate((slide) => slide.scrollTop)).toBeLessThan(wasAtBottom);
  assert.equal(await displayed(design), 0, 'up/down read long text rather than change slides');
  await expect(design.getByRole('button', { name: 'Auto-follow off', exact: true })).toBeVisible();
  await design.waitForTimeout(250);
  const heldScroll = await active(design).evaluate((slide) => slide.scrollTop);
  await design.getByRole('button', { name: 'Auto-follow off', exact: true }).click();
  assert.equal(await active(design).evaluate((slide) => slide.scrollTop), heldScroll, 'same-index follow retains reading position');
  assert.equal(await animations(design), 0, 'same-index follow cannot replay the transition');
  await active(design).focus();
  await design.keyboard.press('ArrowRight');
  await expect(active(design)).toHaveAttribute('data-memory-index', '1');
  assert.equal(await active(design).evaluate((slide) => slide.scrollTop), 0);
  assert.equal(await design.locator('.memory-outgoing').evaluate((slide) => slide.scrollTop), heldScroll);
  assert.equal(await design.evaluate(() => scrollY), pageScroll);
  assert.equal(await active(design).evaluate((slide) => document.activeElement === slide), true, 'keyboard focus stays on the current reader');
  await design.emulateMedia({ reducedMotion: 'reduce' });
  await settled(design);
  assert.equal(await animations(design), 0, 'changing motion preference cancels the running transition');
  await design.keyboard.press('ArrowRight');
  await expect(design.getByRole('button', { name: 'Read next memory', exact: true })).toBeDisabled();
  await design.keyboard.press('ArrowRight');
  assert.equal(await displayed(design), 2, 'the last entry does not wrap');
  await design.emulateMedia({ reducedMotion: 'no-preference' });
  for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowLeft']) {
    await design.keyboard.press(key);
    await assertBounded(design);
  }
  await settled(design);
  assert.equal(await displayed(design), 1, 'stale completions cannot undo rapid navigation');
  await design.keyboard.press('ArrowLeft');
  await upload(design, ['Only replacement original.']);
  await expect(design.locator('.memory-counter')).toHaveText('01/1');
  await settled(design);
  await expect(active(design).locator('p')).toHaveText('Only replacement original.');
  await expect(design.getByRole('button', { name: 'Read previous memory', exact: true })).toBeDisabled();
  await expect(design.getByRole('button', { name: 'Read next memory', exact: true })).toBeDisabled();
  await design.emulateMedia({ forcedColors: 'active' });
  await expect(active(design)).toBeVisible();
  await assertPanelLayout(design);
  await design.getByRole('button', { name: 'About memories', exact: true }).click();
  await design.getByRole('button', { name: 'Clear memories', exact: true }).click();
  await expect(design.locator('.memory-slide')).toHaveCount(0);
  await expect(design.getByRole('button', { name: 'Load memories', exact: true })).toBeVisible();
  await design.close();
  assert.deepEqual(errors, []);
  console.log("[memories] Default loading, empty-print gates, failure/retry/import races, auto float/manual slide, full original reading, privacy and print-linked pacing passed.");
} finally {
  await browser.close();
}
