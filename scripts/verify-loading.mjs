import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseUrl = process.env.POTTERY_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const errors = [];
const log = (message) => console.log(`[loading] ${message}`);
await mkdir("artifacts", { recursive: true });

async function prepare(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.cameraRequests = 0;
    window.loadProgress = [];
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        window.cameraRequests++;
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
    new MutationObserver(() => {
      const bar = document.querySelector('[aria-label="模型加载进度"]');
      if (bar) {
        const value = Number(bar.getAttribute("aria-valuenow"));
        if (window.loadProgress.at(-1) !== value) window.loadProgress.push(value);
      }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await prepare(page);
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 20,
    downloadThroughput: 2 * 1024 * 1024,
    uploadThroughput: -1,
  });
  const downloads = [];
  page.on("request", (request) => {
    if (/\.(task|wasm)$/.test(request.url())) downloads.push(request.url());
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("dialog", { name: "用双手塑形" }).waitFor();
  await page.waitForFunction(() => window.loadProgress.some((n) => n > 0 && n < 100));
  assert.equal(await page.evaluate(() => window.cameraRequests), 0);
  assert.equal(downloads.length, 2, "model and selected runtime start without any click");
  await page.screenshot({ path: "artifacts/model-loading-guide.png", fullPage: true });
  await page.getByRole("button", { name: "使用鼠标", exact: true }).click();
  await page.getByLabel("手势模型就绪", { exact: true }).waitFor({ timeout: 120000 });
  const progress = await page.evaluate(() => window.loadProgress);
  assert.ok(progress.some((n) => n > 0 && n < 100));
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every((n, i) => i === 0 || n >= progress[i - 1]));
  log(`Automatic preload reported ${progress.length} monotonic byte-progress updates and initialized without camera access.`);
  await page.getByRole("button", { name: "手势控制", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "摄像头权限未开启" }).waitFor();
  assert.equal(await page.evaluate(() => window.cameraRequests), 1);
  assert.equal(downloads.length, 2, "entering gesture mode does not download assets again");
  await page.getByRole("button", { name: "鼠标控制", exact: true }).click();
  const downloadsBeforeReload = downloads.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "手势控制", exact: true }).waitFor();
  await page.getByLabel("手势模型就绪", { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(downloads.length, downloadsBeforeReload, "persistent browser cache avoids model and runtime requests on reload");
  assert.equal(await page.getByRole("dialog").count(), 0, "dismissed guide stays dismissed");
  await page.locator(".topbar-tools").getByRole("button", { name: "操作引导" }).click();
  await page.getByRole("dialog", { name: "用双手塑形" }).waitFor();
  await page.getByRole("button", { name: "关闭引导", exact: true }).click();
  log("Camera permission remains explicit; guide persists, can be reopened, and browser cache avoids repeat asset downloads.");
  await page.close();

  if (!process.argv.includes("--smoke")) {
    const retry = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await prepare(retry);
    await retry.addInitScript(() => {
      window.caches.open = async () => { throw new DOMException("Blocked", "SecurityError"); };
    });
    let failOnce = true;
    await retry.route("**/hand_landmarker.task", async (route) => {
      if (failOnce) { failOnce = false; await route.abort("failed"); }
      else await route.continue();
    });
    await retry.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await retry.getByRole("button", { name: "关闭引导", exact: true }).click();
    await retry.getByRole("button", { name: "重试模型加载", exact: true }).waitFor();
    await retry.getByRole("slider", { name: "供料波动" }).fill("60");
    await retry.getByRole("button", { name: "暂停打印" }).click();
    await retry.getByRole("button", { name: "重试模型加载", exact: true }).click();
    await retry.getByLabel("手势模型就绪", { exact: true }).waitFor({ timeout: 120000 });
    await retry.locator(".topbar-tools").getByRole("button", { name: "操作引导" }).click();
    const layout = await retry.getByRole("dialog").evaluate((dialog) => ({
      width: dialog.getBoundingClientRect().width,
      scrollWidth: dialog.scrollWidth,
      screen: innerWidth,
    }));
    assert.ok(layout.width <= layout.screen && layout.scrollWidth <= layout.width + 1);
    await retry.screenshot({ path: "artifacts/model-guide-mobile.png", fullPage: true });
    await retry.close();
    log("Failed downloads can be retried with browser storage blocked; mouse controls remain usable and mobile guide fits.");
  }
  assert.deepEqual(errors, []);
  log("All loading and guide checks passed.");
} finally {
  await browser.close();
}
