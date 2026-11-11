import { chromium, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import assert from "node:assert/strict";

const executablePath = [
  process.env.BROWSER_PATH,
  chromium.executablePath(),
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find(p => p && existsSync(p));
if (!executablePath) throw new Error("No installed browser found. Set BROWSER_PATH to a Chromium executable.");
mkdirSync("artifacts", { recursive: true });
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true,
    args: ["--enable-webgl", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // Serve the real production files through request interception: no network/server required.
  if (!process.env.POTTERY_URL) await page.route("http://127.0.0.1:5190/**", async route => {
    const root = resolve("dist");
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + sep)) return route.fulfill({ status: 403 });
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[extname(file)];
    await route.fulfill({ body: await readFile(file), contentType: contentType || "application/octet-stream" });
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(process.env.POTTERY_URL || "http://127.0.0.1:5190/", { waitUntil: "networkidle" });

  await page.getByLabel("Base Shape").selectOption("bulbous");
  await page.getByLabel("Shape Seed").fill("123");
  await page.getByLabel("Model Height (mm)").fill("90");
  await page.getByLabel("Centreline radius (mm)").fill("30");
  await page.getByLabel("Feedrate (mm/min)").fill("12000");
  await page.getByLabel("Playback speed").selectOption("20");
  await page.getByRole("button", { name: "Contours", exact: true }).click();
  await page.getByLabel("Camera framing").selectOption("plate");
  for (const modifier of ["base", "soft-organic-fold", "twisted", "ribbed"]) {
    await page.getByLabel("Sculptural Family").selectOption(modifier === "base" ? "ribbed" : modifier);
    await page.getByLabel("Sculptural Intensity").fill(modifier === "base" ? "0" : "0.7");
    await page.getByRole("button", { name: "Apply and Reset" }).click();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("status")).toHaveText("Complete", { timeout: 60000 });
    await page.waitForTimeout(250);
    await page.locator("canvas").screenshot({ path: `artifacts/relief-${modifier}.png` });
    if (modifier === "ribbed") {
      await page.getByLabel("Camera framing").selectOption("vessel");
      await page.getByLabel("View").selectOption("top");
      await page.waitForTimeout(250);
      await page.locator("canvas").screenshot({ path: "artifacts/relief-ribbed-top.png" });
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS: four completed prints, identical 90 mm height / 30 mm radius / seed 123 / plate framing, plus ribbed top inspection.");
} finally { await browser?.close(); }
