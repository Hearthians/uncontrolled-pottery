// Studio integration check; imported memory text is fabricated and stays local.
import { chromium, expect } from "@playwright/test";
import { mockDefaultMemories } from "./memory-fixture.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { TOTAL_STEPS } from "../src/simulation.ts";
import { HEIGHTFIELD_PROFILE } from "../src/heightfieldSimulation.ts";
import { generateMaterial } from "../src/pottery.ts";
import { emotionAtStep } from "../src/emotionTrajectory.ts";

const url = new URL(process.env.POTTERY_URL || "http://127.0.0.1:5173");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
url.searchParams.set("physics", "heightfield");
url.searchParams.set("profile", "1");
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const report = {};
const ready = (page, scope = ".viewport") => expect(page.locator(`${scope} .clay-scene`)).toHaveAttribute("data-render-state", "ready", { timeout: 60_000 });
const field = (page, scope = ".viewport") => page.locator(`${scope} canvas`).evaluate((canvas) => ({
  mode: canvas.dataset.surface, nodes: Number(canvas.dataset.nodes), triangles: Number(canvas.dataset.triangles),
  volume: Number(canvas.dataset.volumeMm3), peak: Number(canvas.dataset.peakMm),
}));
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await mockDefaultMemories(page.context());
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  const select = page.getByRole("combobox", { name: "Print physics model" });
  await expect(select).toHaveValue("heightfield");
  await expect(page.locator(".physics-note")).toContainText("no overhangs or fracture");
  await page.getByLabel("Memories JSON file").setInputFiles({ name: "fictional.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([
      "The light stayed on\nlong after everyone had left.",
      "We took the longer way home.\nNeither of us asked why.",
      "Rain on the windows.\nAn unfinished conversation.",
      "For a moment,\nthere was nowhere else to be.",
    ])) });
  await expect(page.locator(".memory-counter")).toHaveText("01/4");
  await page.getByRole("button", { name: "Start printing from the workbench", exact: true }).click();
  await expect(select).toBeDisabled();
  await expect(page.locator(".viewport .clay-scene")).toHaveAttribute("data-engine", "4");
  await expect.poll(async () => (await field(page)).nodes, { timeout: 30_000 }).toBeGreaterThan(800);
  await page.getByRole("button", { name: "Pause print", exact: false }).click();
  const paused = await field(page);
  assert.equal(paused.mode, "heightfield");
  assert.ok(paused.volume > 0 && paused.peak > 0 && paused.triangles > 0);
  const memory = await page.locator(".memory-playback").getAttribute("data-current-index");
  const passage = await page.locator(".memory-playback").getAttribute("data-displayed-index");
  await page.waitForTimeout(300);
  assert.deepEqual(await field(page), paused, "pause freezes the material, not just the UI");
  await expect(page.locator(".memory-playback")).toHaveAttribute("data-current-index", memory);
  await expect(page.locator(".memory-playback")).toHaveAttribute("data-displayed-index", passage);
  await expect(select).toBeDisabled();
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await page.getByRole("button", { name: "Print studio", exact: true }).click();
  await ready(page);
  assert.deepEqual(await field(page), paused, "worker rebuilds the same surface after gallery navigation");
  await page.getByRole("button", { name: "Resume print", exact: false }).click();
  await expect.poll(async () => (await field(page)).nodes, { timeout: 30_000 }).toBeGreaterThan(paused.nodes + 100);
  await page.getByRole("button", { name: "Finish print", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save this work", exact: true })).toBeVisible({ timeout: 30_000 });
  const stopped = await field(page);
  assert.ok(stopped.nodes < TOTAL_STEPS / 2);
  assert.equal(await page.locator(".memory-active .emotion-stage h3").textContent(), emotionAtStep(stopped.nodes - 1).label);
  await page.getByRole("button", { name: "Save this work", exact: true }).click();
  await page.getByLabel("Work title").fill("Experimental field test");
  await page.getByRole("button", { name: "Add to gallery", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export record", exact: true }).click();
  const archive = JSON.parse(await readFile(await (await download).path(), "utf8"));
  assert.equal(archive.version, 4);
  assert.equal(archive.simulation.id, HEIGHTFIELD_PROFILE.id);
  assert.equal(archive.pottery.steps, stopped.nodes);
  assert.ok(!JSON.stringify(archive).includes("The light stayed on"));
  const reconstructed = generateMaterial(archive.pottery);
  const volume = reconstructed.surface.height.reduce((sum, h) => sum + h * reconstructed.surface.cellMm ** 2, 0);
  assert.ok(Math.abs(stopped.volume - volume) < Math.max(1, volume) * 1e-10, "browser and Node replay agree within floating-point precision");
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await page.getByLabel("Work archive file").setInputFiles({ name: "field.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(archive)) });
  await ready(page, ".detail-scene");
  assert.deepEqual(await field(page, ".detail-scene"), stopped);
  await expect(page.getByText("V4 · experimental height field", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close work", exact: true }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await page.getByRole("button", { name: "View work: Experimental field test", exact: true }).click();
  await ready(page, ".detail-scene");
  assert.deepEqual(await field(page, ".detail-scene"), stopped, "saved V4 remains V4 on reload");
  await page.getByRole("button", { name: "Close work", exact: true }).click();
  await page.getByRole("button", { name: "Print studio", exact: true }).click();
  await page.getByLabel("Memories JSON file").setInputFiles({ name: "fictional.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(["We took the longer way home.\nNeither of us asked why.", "For a moment,\nthere was nowhere else to be."])) });
  await expect(page.locator(".memory-counter")).toHaveText("01/2");
  await page.getByRole("button", { name: "Start printing from the workbench", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save this work", exact: true })).toBeVisible({ timeout: 150_000 });
  const completed = await field(page);
  assert.equal(completed.nodes, TOTAL_STEPS);
  assert.ok(completed.volume > stopped.volume);
  await page.getByRole("button", { name: "Read previous memory", exact: true }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "artifacts/heightfield-studio-desktop.png", fullPage: true });
  report.completed = completed;
  report.timing = await page.evaluate(() => {
    const values = performance.getEntriesByName("pottery:deposition").map((entry) => entry.duration).sort((a, b) => a - b);
    return { count: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length, p95Ms: values[Math.floor(values.length * .95)] };
  });
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (width === 390) await page.screenshot({ path: "artifacts/heightfield-studio-phone.png", fullPage: true });
  }
  await select.selectOption("strand");
  await page.getByRole("button", { name: "Print again", exact: true }).click();
  await expect(page.locator(".viewport .clay-scene")).toHaveAttribute("data-engine", "3");
  await expect.poll(async () => (await field(page)).mode).toBe("strand");
  await page.getByRole("button", { name: "Pause print", exact: false }).click();
  assert.deepEqual(errors, []);
  await writeFile("artifacts/heightfield-studio-report.json", JSON.stringify(report, null, 2));
  console.log("[heightfield] Live surface, pause/resume, early stop, full print, memories, worker replay, archive/reload and V3 switch passed.");
  console.log(`[heightfield] ${JSON.stringify(report)}`);
} finally {
  await browser.close();
}
