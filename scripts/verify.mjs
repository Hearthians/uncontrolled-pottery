import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const log = (message) => console.log(`[verify] ${message}`);
const baseUrl = process.env.POTTERY_URL || "http://127.0.0.1:5173";
async function dismissGuide(page) {
  const close = page.getByRole("button", { name: "关闭引导", exact: true });
  if (await close.count()) await close.click();
}

async function canvasStats(page, selector = ".viewport canvas") {
  return page
    .locator(selector)
    .first()
    .evaluate((source) => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 160;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(source, 0, 0, 160, 160);
      const data = ctx.getImageData(0, 0, 160, 160).data;
      let min = 255,
        max = 0,
        sum = 0,
        dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        min = Math.min(min, data[i]);
        max = Math.max(max, data[i]);
        sum += data[i] + data[i + 1] + data[i + 2];
        if (data[i] < 190) dark++;
      }
      return {
        min,
        max,
        sum,
        dark,
        width: source.width,
        height: source.height,
      };
    });
}

async function assertLayout(page, label) {
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll("button")]
      .filter((el) => el.clientWidth && el.scrollWidth > el.clientWidth + 2)
      .map((el) => el.textContent?.trim()),
    panelOverflow: (() => {
      const panel = document.querySelector(".control-panel");
      const actions = document.querySelector(".print-actions");
      return panel && actions
        ? actions.getBoundingClientRect().bottom +
            parseFloat(getComputedStyle(panel).paddingBottom) -
            panel.getBoundingClientRect().bottom
        : 0;
    })(),
  }));
  assert.ok(
    layout.scrollWidth <= layout.width + 1,
    `${label}: horizontal overflow ${JSON.stringify(layout)}`,
  );
  assert.deepEqual(layout.overflow, [], `${label}: overflowing controls`);
  assert.ok(
    layout.panelOverflow <= 1,
    `${label}: control panel overlaps progress monitor`,
  );
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await dismissGuide(page);
  await page.locator(".viewport canvas").waitFor();
  await page.waitForTimeout(1600);
  assert.equal(await page.locator(".webgl-error").count(), 0);
  await assertLayout(page, "desktop");
  const initial = await canvasStats(page);
  assert.ok(
    initial.max - initial.min > 40 && initial.dark > 80,
    `blank canvas: ${JSON.stringify(initial)}`,
  );
  await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
  log(`Desktop scene rendered: ${JSON.stringify(initial)}`);

  if (!process.argv.includes("--layout-only")) {
    const canvasBounds = await page.locator(".viewport canvas").boundingBox();
    await page.mouse.move(
      canvasBounds.x + canvasBounds.width * 0.5,
      canvasBounds.y + canvasBounds.height * 0.45,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvasBounds.x + canvasBounds.width * 0.65,
      canvasBounds.y + canvasBounds.height * 0.4,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.waitForTimeout(350);
    assert.notEqual(
      initial.sum,
      (await canvasStats(page)).sum,
      "dragging the pottery changes the view",
    );
    await page.getByRole("button", { name: "自动旋转", exact: true }).click();
    await page.waitForTimeout(700);
    const rotated = await canvasStats(page);
    assert.notEqual(
      initial.sum,
      rotated.sum,
      "rotation should change canvas pixels",
    );
    await page.getByRole("button", { name: "自动旋转", exact: true }).click();
    const flowSlider = page.getByRole("slider", { name: "供料波动" });
    const sliderBounds = await flowSlider.boundingBox();
    assert.ok(
      sliderBounds.height >= 22,
      "slider has an accessible pointer target",
    );
    await page.mouse.click(
      sliderBounds.x + 6 + (sliderBounds.width - 12) * 0.9,
      sliderBounds.y + sliderBounds.height / 2,
    );
    assert.equal(await flowSlider.inputValue(), "90");
    await page.getByRole("button", { name: "暂停打印" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "从工作台开始打印" }).count(),
      0,
      "first slider interaction starts a new print",
    );
    await page.getByRole("slider", { name: "供料中断" }).fill("40");
    await page.waitForTimeout(11000);
    await page.screenshot({ path: "artifacts/printing.png", fullPage: true });
    await page.getByRole("button", { name: "暂停打印" }).click();
    const paused = await page.locator(".time-code").textContent();
    await page.waitForTimeout(800);
    assert.equal(
      await page.locator(".time-code").textContent(),
      paused,
      "pause must stop deposition",
    );
    await page.getByRole("slider", { name: "供料波动" }).fill("8");
    await page.getByRole("slider", { name: "供料中断" }).fill("0");
    await page.getByRole("switch", { name: "局部下垂" }).click();
    await page.getByRole("button", { name: "继续打印" }).click();
    log(
      "Live supply changes and pause/resume verified; waiting for 55-second completion.",
    );
    await page
      .getByRole("button", { name: "收藏这件作品" })
      .waitFor({ timeout: 85000 });
    await page.screenshot({ path: "artifacts/completed.png", fullPage: true });
    await page.getByRole("button", { name: "收藏这件作品" }).click();
    await page.getByLabel("作品名称").fill("下粗上稳 · 实验 001");
    await page
      .getByRole("button", { name: "加入作品画廊", exact: true })
      .click();
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("uncontrolled-pottery-v1")),
    );
    assert.equal(stored.length, 1);
    assert.equal(stored[0].steps, 10240);
    assert.ok(stored[0].events.length >= 2);
    assert.ok(
      stored[0].events.some(
        (event) => event.fluctuation === 90 && event.interruption === 40,
      ),
    );
    assert.ok(stored[0].events.at(-1).fluctuation === 8);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出记录", exact: true }).click();
    const download = await downloadPromise;
    const exported = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.equal(exported.pottery.id, stored[0].id);
    log(
      `Completed and collected ${stored[0].steps} deposition steps; export contains ${stored[0].events.length} process events.`,
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "作品画廊", exact: true }).click();
    await page
      .getByRole("button", { name: "查看作品：下粗上稳 · 实验 001" })
      .click();
    await page.locator(".detail-scene canvas").waitFor();
    await page.waitForTimeout(500);
    const detail = await canvasStats(page, ".detail-scene canvas");
    assert.ok(detail.max - detail.min > 40);
    await page.screenshot({
      path: "artifacts/collection-detail.png",
      fullPage: true,
    });
    const imageDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "保存作品图像" }).click();
    assert.ok((await imageDownload).suggestedFilename().endsWith(".webp"));
    await page.getByRole("button", { name: "关闭作品", exact: true }).click();
    await page.getByRole("button", { name: "我的收藏 1", exact: true }).click();
    assert.equal(await page.locator(".gallery-item").count(), 1);
    log("Collection survived reload; detail scene and image export verified.");
  }

  await page.close();
  for (const width of [1920, 1440, 1024, 768, 390, 360]) {
    const mobile = await browser.newPage({
      viewport: { width, height: 844 },
      deviceScaleFactor: 1,
      isMobile: width < 600,
      hasTouch: width < 600,
    });
    mobile.on("pageerror", (error) => errors.push(error.message));
    await mobile.goto(baseUrl, { waitUntil: "networkidle" });
    await dismissGuide(mobile);
    await mobile.waitForTimeout(900);
    await assertLayout(mobile, `viewport ${width}`);
    const pixels = await canvasStats(mobile);
    assert.ok(
      pixels.max - pixels.min > 40 && pixels.dark > 40,
      `blank scene at ${width}: ${JSON.stringify(pixels)}`,
    );
    await mobile.locator(".gallery-band").scrollIntoViewIfNeeded();
    await mobile.waitForFunction(
      () => document.querySelectorAll(".pottery-thumbnail").length >= 3,
    );
    const thumbnailSizes = await mobile
      .locator(".pottery-thumbnail")
      .evaluateAll((images) =>
        images.map((image) => [image.naturalWidth, image.naturalHeight]),
      );
    assert.ok(
      thumbnailSizes.every(
        ([width, height]) => width === height && width > 100,
      ),
      "gallery thumbnails preserve their proportions",
    );
    await mobile.evaluate(() => window.scrollTo(0, 0));
    await mobile.screenshot({
      path: `artifacts/viewport-${width}.png`,
      fullPage: true,
    });
    if (width === 390) {
      await mobile.getByRole("button", { name: "从工作台开始打印" }).click();
      await mobile.getByRole("slider", { name: "供料中断" }).fill("70");
      await mobile.waitForTimeout(1800);
      await mobile.getByRole("button", { name: "暂停打印" }).click();
      await mobile.getByRole("button", { name: "结束本次" }).click();
      await mobile.getByRole("button", { name: "收藏这件作品" }).click();
      await mobile.getByLabel("作品名称").fill("移动端试作");
      await mobile
        .getByRole("button", { name: "加入作品画廊", exact: true })
        .click();
      await mobile
        .getByRole("button", { name: "作品画廊", exact: true })
        .click();
      await mobile
        .getByRole("button", { name: "查看作品：移动端试作" })
        .click();
      await assertLayout(mobile, "mobile detail");
      const imagePromise = mobile.waitForEvent("download");
      await mobile.getByRole("button", { name: "保存作品图像" }).click();
      const imageFile = await imagePromise;
      const imageData = (await readFile(await imageFile.path())).toString(
        "base64",
      );
      const dimensions = await mobile.evaluate(async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, `data:image/webp;base64,${imageData}`);
      assert.deepEqual(
        dimensions,
        [480, 480],
        "image export preserves the pottery proportions",
      );
      await mobile.screenshot({
        path: "artifacts/mobile-detail.png",
        fullPage: true,
      });
    }
    await mobile.close();
    log(`Viewport ${width}px rendered without overflow.`);
  }
  assert.deepEqual(errors, [], "browser runtime errors");
  log("All browser checks passed.");
} finally {
  await context.close();
  await browser.close();
}
