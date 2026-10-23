import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PRESETS as LEGACY_PRESETS } from "../src/simulation.ts";
import { createArchive } from "../src/archive.ts";
import { plannedNozzle } from "../src/materialSimulation.ts";

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
const upload = (page, data) => page.getByLabel("作品记录文件").setInputFiles({
  name: "pottery.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)),
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}${baseUrl.includes("?") ? "&" : "?"}profile=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "关闭引导", exact: true }).click();
  await page.getByRole("button", { name: "从工作台开始打印" }).click();
  await page.getByRole("slider", { name: "供料波动" }).fill("95");
  await page.getByRole("slider", { name: "供料中断" }).fill("65");
  await page.waitForTimeout(4500);
  await page.getByRole("button", { name: "暂停打印" }).click();
  const initialNodes = await nodes(page);
  assert.ok(initialNodes > 200 && initialNodes < 2400, "pending presets cannot overwrite a newly started print");

  for (let visit = 0; visit < 2; visit++) {
    const before = await nodes(page);
    await page.getByRole("button", { name: "作品画廊", exact: true }).click();
    await page.getByRole("button", { name: "打印工坊", exact: true }).click();
    if (visit === 0) await ready(page);
    await page.getByRole("button", { name: "继续打印" }).click();
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: "暂停打印" }).click();
    assert.ok(await nodes(page) > before, "resume survives a pending reconstruction and reuses current process data");
  }
  const finalNodes = await nodes(page);
  await page.getByRole("button", { name: "作品画廊", exact: true }).click();
  await page.getByRole("button", { name: "打印工坊", exact: true }).click();
  await ready(page);
  assert.equal(await nodes(page), finalNodes, "repeated remount must not reuse an earlier live geometry cache");
  const pose = await page.locator(".viewport canvas").evaluate((canvas) => ({
    x: Number(canvas.dataset.nozzleX), y: Number(canvas.dataset.nozzleY), z: Number(canvas.dataset.nozzleZ),
  }));
  const planned = plannedNozzle(finalNodes);
  for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(pose[axis] - planned[axis]) < 0.00002);
  log("Fixed nozzle path and repeated pause/gallery/resume reconstruction verified.");

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

  await page.getByRole("button", { name: "结束本次", exact: true }).click();
  await page.getByRole("button", { name: "收藏这件作品", exact: true }).click();
  await page.getByLabel("作品名称").fill("材料回放测试");
  await page.getByRole("button", { name: "加入作品画廊", exact: true }).click();
  const recorded = await page.evaluate(() => JSON.parse(localStorage.getItem("uncontrolled-pottery-v1"))[0]);
  assert.equal(recorded.simulation.version, 2);
  assert.ok(recorded.simulation.pulses.length > 0);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出记录", exact: true }).click();
  const exported = JSON.parse(await readFile(await (await downloadEvent).path(), "utf8"));
  assert.equal(exported.version, 2);
  assert.ok(exported.simulation.playbackRate > 1);

  await page.evaluate(() => localStorage.removeItem("uncontrolled-pottery-v1"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "作品画廊", exact: true }).click();
  await upload(page, exported);
  await ready(page, ".detail-scene");
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("uncontrolled-pottery-v1"))[0]);
  assert.deepEqual(restored, { ...recorded, preset: false });
  await page.screenshot({ path: "artifacts/material-reimport.png", fullPage: true });
  await page.getByRole("button", { name: "关闭作品", exact: true }).click();
  const legacy = { ...LEGACY_PRESETS[0], id: "legacy-roundtrip", title: "旧版兼容测试" };
  await upload(page, createArchive(legacy));
  await ready(page, ".detail-scene");
  assert.equal(await page.locator(".detail-scene .clay-scene").getAttribute("data-engine"), "1");
  await page.getByRole("button", { name: "关闭作品", exact: true }).click();
  await upload(page, { ...exported, version: 999 });
  await page.getByRole("status").filter({ hasText: "无法导入" }).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("uncontrolled-pottery-v1")).length), 2);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "作品画廊", exact: true }).click();
  await page.getByRole("button", { name: "查看作品：材料回放测试" }).click();
  await ready(page, ".detail-scene");
  assert.equal(await page.locator(".detail-scene .clay-scene").getAttribute("data-engine"), "2");
  log("V2 export/import/reload and V1 import verified; unknown versions leave collection intact.");
  assert.deepEqual(errors, []);
  await writeFile("artifacts/material-performance.json", `${JSON.stringify(report, null, 2)}\n`);
  log("All material browser checks passed.");
} finally {
  await browser.close();
}
