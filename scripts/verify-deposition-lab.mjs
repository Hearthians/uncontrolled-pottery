import { chromium } from "@playwright/test";
import { mockDefaultMemories } from "./memory-fixture.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("artifacts", { recursive: true });
const base = process.env.POTTERY_URL || "http://127.0.0.1:5173/";
const url = new URL(base); url.searchParams.set("lab", "deposition");
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [], reports = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await mockDefaultMemories(page.context());
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url.href);
  await page.locator(".lab-surface canvas").waitFor();
  for (const [label, id] of [["One strand", "single"], ["Three layers", "layers"], ["Stop and restart", "restart"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByRole("button", { name: "Run sample", exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector(".lab-surface canvas")?.dataset.tick) > 20);
    await page.getByRole("button", { name: "Pause sample", exact: true }).click();
    await page.waitForTimeout(100);
    const paused = await page.locator(".lab-surface canvas").getAttribute("data-tick");
    await page.waitForTimeout(150);
    assert.equal(await page.locator(".lab-surface canvas").getAttribute("data-tick"), paused);
    await page.getByRole("button", { name: "Complete sample", exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector(".lab-surface canvas")?.dataset.triangles) > 500);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `artifacts/clay-lab-${id}.png`, fullPage: true });
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download numerical record", exact: false }).click();
    const file = await downloading;
    const record = JSON.parse(await readFile(await file.path(), "utf8"));
    assert.equal(record.kind, id); assert.equal(record.tick, record.endTick);
    assert.ok(Math.abs(record.metrics.massErrorPercent) < 1e-8);
    assert.ok(record.height.every((h) => h >= 0 && Number.isFinite(h)));
    reports.push({ case: id, ...record.metrics, profile: undefined });
  }
  await page.getByRole("button", { name: "One strand", exact: true }).click();
  await page.getByLabel("Nozzle clearance").selectOption("1.5");
  await page.getByRole("button", { name: "Complete sample", exact: true }).click();
  await page.screenshot({ path: "artifacts/clay-lab-low-clearance.png", fullPage: true });
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
    await page.screenshot({ path: `artifacts/clay-lab-${width}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "artifacts/clay-lab-dark.png", fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile("artifacts/clay-lab-metrics.json", JSON.stringify(reports, null, 2));
  console.log("Lab browser checks passed:", JSON.stringify(reports));
} finally { await browser.close(); }
