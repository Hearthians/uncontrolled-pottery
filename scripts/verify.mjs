import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { mockDefaultMemories } from "./memory-fixture.mjs";

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
await mockDefaultMemories(context);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const log = (message) => console.log(`[verify] ${message}`);
const baseUrl = process.env.POTTERY_URL || "http://127.0.0.1:5173";
async function dismissGuide(page) {
  const close = page.getByRole("button", { name: "Close guide", exact: true });
  if (await close.count()) await close.click();
}

async function assertReferenceCylinder(page) {
  const scene = page.locator(".viewport .clay-scene");
  const show = page.getByRole("button", { name: "Show reference cylinder", exact: true });
  assert.equal(await show.getAttribute("aria-pressed"), "false");
  assert.equal(await scene.getAttribute("data-reference-visible"), "false");
  assert.equal(await scene.getAttribute("data-reference-center"), "0,0,0");
  await show.click();
  const hide = page.getByRole("button", { name: "Hide reference cylinder", exact: true });
  assert.equal(await hide.getAttribute("aria-pressed"), "true");
  await page.locator('.viewport .clay-scene[data-reference-visible="true"]').waitFor();
  assert.equal(await scene.getAttribute("data-reference-center"), "0,0,0");
  await hide.click();
  await page.locator('.viewport .clay-scene[data-reference-visible="false"]').waitFor();
  assert.equal(await show.getAttribute("aria-pressed"), "false");
}

async function canvasStats(page, selector = ".viewport canvas") {
  return page
    .locator(selector)
    .first()
    .evaluate(async (source) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
  assert.equal(await page.title(), "Uncontrolled Studio");
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.getByRole("dialog").count(), 0, "guidance is on demand, not an opening wall of text");
  await page.getByRole("button", { name: "How it works", exact: true }).last().click();
  assert.match(await page.locator(".guide-steps").innerText(), /with names removed/);
  assert.match(await page.locator(".guide-method-note").last().innerText(), /Both physics modes are uncalibrated/);
  assert.match(await page.locator(".guide-method-note").last().innerText(), /Experimental V4/);
  for (const selector of ['.topbar', '.nav-rail', '.guide-modal', '.print-actions'])
    assert.doesNotMatch(await page.locator(selector).innerText(), /\p{Script=Han}/u,
      'interface labels are English; original memory language is not constrained');
  await dismissGuide(page);
  await page.locator(".viewport canvas").waitFor();
  await page.locator('.viewport .clay-scene[data-render-state="ready"]').waitFor();
  assert.equal(await page.locator(".webgl-error").count(), 0);
  await assertReferenceCylinder(page);
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
    await page.getByRole("button", { name: "Auto-rotate", exact: true }).click();
    await page.waitForTimeout(700);
    const rotated = await canvasStats(page);
    assert.notEqual(
      initial.sum,
      rotated.sum,
      "rotation should change canvas pixels",
    );
    await page.getByRole("button", { name: "Auto-rotate", exact: true }).click();
    assert.equal(await page.getByRole("slider").count(), 0, "manual sliders are removed");
    await page.getByRole("button", { name: "Start printing from the workbench" }).click();
    await page.getByRole("button", { name: "Pause print" }).waitFor();
    await page.waitForTimeout(11000);
    await page.screenshot({ path: "artifacts/printing.png", fullPage: true });
    await page.getByRole("button", { name: "Pause print" }).click();
    const paused = await page.locator(".time-code").textContent();
    await page.waitForTimeout(800);
    assert.equal(
      await page.locator(".time-code").textContent(),
      paused,
      "pause must stop deposition",
    );
    await page.getByRole("button", { name: "Resume print" }).click();
    log(
      "Automatic emotion trajectory and pause/resume verified; waiting for 55-second completion.",
    );
    await page
      .getByRole("button", { name: "Save this work" })
      .waitFor({ timeout: 85000 });
    await page.screenshot({ path: "artifacts/completed.png", fullPage: true });
    await page.getByRole("button", { name: "Save this work" }).click();
    await page.getByLabel("Work title").fill("下粗上稳 · 实验 001");
    await page
      .getByRole("button", { name: "Add to gallery", exact: true })
      .click();
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("uncontrolled-pottery-v1")),
    );
    assert.equal(stored.length, 1);
    assert.equal(stored[0].title, "下粗上稳 · 实验 001", "custom titles retain their original language");
    assert.equal(stored[0].steps, 10240);
    assert.equal(stored[0].events.length, 64);
    assert.equal(stored[0].emotionPlan.memoryCount, 1910);
    assert.equal(stored[0].emotionPlan.mappingVersion, "emotion-behavior-2");
    assert.ok(stored[0].events.every((event) => event.sag === true), "emotion changes supply, not material behavior");
    assert.ok(stored[0].events.some((event) => event.interruption > 40));
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export record", exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "下粗上稳 · 实验 001-process.json");
    const exported = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.equal(exported.pottery.id, stored[0].id);
    assert.equal(exported.version, 3);
    assert.equal(stored[0].simulation.version, 3);
    assert.equal(exported.simulation.id, "pneumatic-clay-plastic-1");
    assert.equal(exported.simulation.material, "viscoplastic-strand-prototype");
    assert.equal(exported.simulation.id, stored[0].simulation.profile);
    assert.ok(Array.isArray(stored[0].simulation.pulses));
    log(
      `V3 prototype completed and collected ${stored[0].steps} deposition steps; export contains ${stored[0].events.length} supply events and matching profile metadata.`,
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Gallery", exact: true }).click();
    await page
      .getByRole("button", { name: "View work: 下粗上稳 · 实验 001" })
      .click();
    await page.locator(".detail-scene canvas").waitFor();
    await page.locator('.detail-scene .clay-scene[data-render-state="ready"]').waitFor();
    assert.equal(await page.locator(".detail-scene .clay-scene").getAttribute("data-engine"), "3");
    const detail = await canvasStats(page, ".detail-scene canvas");
    assert.ok(detail.max - detail.min > 40);
    await page.screenshot({
      path: "artifacts/collection-detail.png",
      fullPage: true,
    });
    const imageDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save image" }).click();
    assert.ok((await imageDownload).suggestedFilename().endsWith(".webp"));
    await page.getByRole("button", { name: "Close work", exact: true }).click();
    await page.getByRole("button", { name: "My collection 1", exact: true }).click();
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
    await mockDefaultMemories(mobile.context());
    await mobile.goto(baseUrl, { waitUntil: "networkidle" });
    await dismissGuide(mobile);
    await mobile.locator('.viewport .clay-scene[data-render-state="ready"]').waitFor();
    await assertReferenceCylinder(mobile);
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
      await mobile.getByRole("button", { name: "Start printing from the workbench" }).click();
      await mobile.waitForTimeout(1800);
      await mobile.getByRole("button", { name: "Pause print" }).click();
      await mobile.getByRole("button", { name: "Finish print" }).click();
      await mobile.getByRole("button", { name: "Save this work" }).click();
      await mobile.getByLabel("Work title").fill("移动端试作");
      await mobile
        .getByRole("button", { name: "Add to gallery", exact: true })
        .click();
      await mobile
        .getByRole("button", { name: "Gallery", exact: true })
        .click();
      await mobile
        .getByRole("button", { name: "View work: 移动端试作" })
        .click();
      await assertLayout(mobile, "mobile detail");
      await mobile.locator('.detail-scene .clay-scene[data-render-state="ready"]').waitFor();
      const imagePromise = mobile.waitForEvent("download");
      await mobile.getByRole("button", { name: "Save image" }).click();
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
