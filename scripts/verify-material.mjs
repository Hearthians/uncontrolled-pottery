import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PRESETS as LEGACY_PRESETS } from "../src/simulation.ts";
import { createArchive } from "../src/archive.ts";
import { MATERIAL_PROFILE, plannedNozzle } from "../src/materialSimulation.ts";
import { PLASTIC_PROFILE } from "../src/plasticSimulation.ts";
import { PRESETS } from "../src/pottery.ts";
import { emotionAtStep, emotionPlanToEvents } from "../src/emotionTrajectory.ts";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const baseUrl = process.env.POTTERY_URL || "http://127.0.0.1:5173";
const errors = [];
const report = [];
const log = (message) => console.log(`[material] ${message}`);
const ready = (page, scope = ".viewport") => page.locator(`${scope} .clay-scene[data-render-state="ready"]`).waitFor();
const nodes = (page) => page.locator(".viewport canvas").evaluate((canvas) => Number(canvas.dataset.nodes));
const upload = (page, data) => page.getByLabel("Work archive file").setInputFiles({
  name: "pottery.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)),
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}${baseUrl.includes("?") ? "&" : "?"}profile=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Close guide", exact: true }).click();
  await page.getByRole("button", { name: "Start printing from the workbench" }).click();
  assert.equal(await page.getByRole("slider").count(), 0, "supply follows the emotion plan without manual sliders");
  await page.waitForTimeout(4500);
  await page.getByRole("button", { name: "Pause print" }).click();
  const initialNodes = await nodes(page);
  assert.ok(initialNodes > 200 && initialNodes < 2400, "pending presets cannot overwrite a newly started print");

  for (let visit = 0; visit < 2; visit++) {
    const before = await nodes(page);
    await page.getByRole("button", { name: "Gallery", exact: true }).click();
    await page.getByRole("button", { name: "Print studio", exact: true }).click();
    if (visit === 0) await ready(page);
    await page.getByRole("button", { name: "Resume print" }).click();
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: "Pause print" }).click();
    assert.ok(await nodes(page) > before, "resume survives a pending reconstruction and reuses current process data");
  }
  const finalNodes = await nodes(page);
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await page.getByRole("button", { name: "Print studio", exact: true }).click();
  await ready(page);
  assert.equal(await nodes(page), finalNodes, "repeated remount must not reuse an earlier live geometry cache");
  const pose = await page.locator(".viewport canvas").evaluate((canvas) => ({
    x: Number(canvas.dataset.nozzleX), y: Number(canvas.dataset.nozzleY), z: Number(canvas.dataset.nozzleZ),
  }));
  const planned = plannedNozzle(finalNodes);
  for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(pose[axis] - planned[axis]) < 0.00002);
  assert.equal(await page.locator(".emotion-stage h3").textContent(), emotionAtStep(finalNodes - 1).label);
  log("V3 fixed nozzle path, original-plan emotion progress, and repeated pause/gallery/resume reconstruction verified.");

  const timings = await page.evaluate(() => {
    const stats = (name) => {
      const values = performance.getEntriesByName(name).map((entry) => entry.duration).sort((a, b) => a - b);
      return { count: values.length, meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
        p95Ms: values[Math.floor(values.length * 0.95)], maxMs: values.at(-1) };
    };
    return { ...stats("pottery:deposition"), simulation: stats("pottery:simulation"), geometry: stats("pottery:geometry") };
  });
  assert.ok(timings.count > 20);
  report.push({ kind: "live-simulation-and-geometry", viewport: "1440x1000", ...timings });
  log(`Live simulation and geometry timings: ${JSON.stringify(timings)}`);

  await page.getByRole("button", { name: "Finish print", exact: true }).click();
  await page.getByRole("button", { name: "Save this work", exact: true }).click();
  await page.getByLabel("Work title").fill("V3 泥条回放测试");
  await page.getByRole("button", { name: "Add to gallery", exact: true }).click();
  const recorded = await page.evaluate(() => JSON.parse(localStorage.getItem("uncontrolled-pottery-v1"))[0]);
  assert.equal(recorded.simulation.version, 3);
  assert.equal(recorded.simulation.profile, PLASTIC_PROFILE.id);
  assert.ok(Array.isArray(recorded.simulation.pulses));
  assert.deepEqual(recorded.events, emotionPlanToEvents(recorded.emotionPlan));
  assert.equal(recorded.emotionPlan.mappingVersion, "emotion-behavior-2");
  const stoppedEmotion = emotionAtStep(recorded.steps - 1, recorded.emotionPlan);
  assert.ok(stoppedEmotion.position < 0.5, "early stop cannot traverse the remaining emotion arc");
  assert.equal(await page.locator(".emotion-stage h3").textContent(), stoppedEmotion.label);
  log(`V3 early stop saved ${recorded.steps} nodes and ${recorded.simulation.pulses.length} supply pulses; material properties stay fixed.`);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export record", exact: true }).click();
  const exported = JSON.parse(await readFile(await (await downloadEvent).path(), "utf8"));
  assert.equal(exported.version, 3);
  assert.equal(exported.simulation.id, PLASTIC_PROFILE.id);
  assert.equal(exported.simulation.material, PLASTIC_PROFILE.material);
  assert.ok(exported.simulation.playbackRate > 1);

  await page.evaluate(() => localStorage.removeItem("uncontrolled-pottery-v1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await upload(page, exported);
  await ready(page, ".detail-scene");
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("uncontrolled-pottery-v1"))[0]);
  assert.deepEqual(restored, { ...recorded, preset: false });
  assert.equal(await page.locator(".detail-scene .clay-scene").getAttribute("data-engine"), "3");
  await page.screenshot({ path: "artifacts/material-reimport.png", fullPage: true });
  await page.getByRole("button", { name: "Close work", exact: true }).click();
  const material = { ...PRESETS[0], id: "material-v2-roundtrip", title: "V2 材料兼容测试" };
  const legacy = { ...LEGACY_PRESETS[0], id: "legacy-roundtrip", title: "V1 旧版兼容测试" };
  for (const pottery of [material, legacy]) {
    const archive = createArchive(pottery);
    await upload(page, archive);
    await ready(page, ".detail-scene");
    assert.equal(await page.locator(".detail-scene .clay-scene").getAttribute("data-engine"), String(archive.version));
    const imported = await page.evaluate(() => JSON.parse(localStorage.getItem("uncontrolled-pottery-v1"))[0]);
    assert.deepEqual(imported, { ...pottery, preset: false }, "legacy process data must not migrate");
    const legacyDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export work archive", exact: true }).click();
    const reexported = JSON.parse(await readFile(await (await legacyDownload).path(), "utf8"));
    assert.equal(reexported.version, archive.version);
    assert.deepEqual(reexported.simulation, archive.simulation);
    assert.deepEqual(reexported.pottery, imported);
    await page.getByRole("button", { name: "Close work", exact: true }).click();
  }
  for (const invalid of [
    { ...exported, version: 99 },
    { ...exported, version: 2 },
    { ...exported, simulation: { ...exported.simulation, id: MATERIAL_PROFILE.id } },
  ]) {
    const importError = page.getByRole("status").filter({ hasText: "Import failed" });
    await importError.waitFor({ state: "hidden" });
    await upload(page, invalid);
    await importError.waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("uncontrolled-pottery-v1")).length), 3);
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await page.getByRole("button", { name: "View work: V3 泥条回放测试" }).click();
  await ready(page, ".detail-scene");
  assert.equal(await page.locator(".detail-scene .clay-scene").getAttribute("data-engine"), "3");
  log("V3 export/import/reload plus unchanged V2/V1 import/re-export verified; version/profile mismatches leave collection intact.");
  assert.deepEqual(errors, []);
  await writeFile("artifacts/material-performance.json", `${JSON.stringify(report, null, 2)}\n`);
  log("All material browser checks passed.");
} finally {
  await browser.close();
}
