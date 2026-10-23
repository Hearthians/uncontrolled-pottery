import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";

await mkdir("artifacts", { recursive: true });
const palms = (await readFile("tests/fixtures/right_hands.jpg")).toString(
  "base64",
);
const fist = (await readFile("tests/fixtures/fist.jpg")).toString("base64");
const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const errors = [];
const log = (message) => console.log("[gestures]", message);
const baseUrl = process.env.POTTERY_URL || "http://127.0.0.1:5173";
async function dismissGuide(page) {
  const close = page.getByRole("button", { name: "关闭引导", exact: true });
  if (await close.count()) await close.click();
}

async function fakeCamera(page) {
  await page.addInitScript(
    async ({ palms, fist }) => {
      const fixture = (window.cameraFixture = { mode: "palms", tracks: [] });
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      const open = new Image();
      open.src = `data:image/jpeg;base64,${palms}`;
      const closed = new Image();
      closed.src = `data:image/jpeg;base64,${fist}`;
      const loaded = Promise.all([open.decode(), closed.decode()]);
      const activeTracks = [];
      function draw() {
        if (fixture.mode === "frozen") return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#eee";
        ctx.fillRect(0, 0, 640, 480);
        if (fixture.mode !== "blank") {
          const closedMode = fixture.mode === "fists";
          const img = closedMode ? closed : open;
          const sx = closedMode ? 0 : 360;
          const sw = closedMode ? img.width : 360;
          ctx.drawImage(img, sx, 0, sw, img.height, 15, 60, 285, 350);
          if (fixture.mode !== "single") {
            ctx.setTransform(-1, 0, 0, 1, 640, 0);
            ctx.drawImage(img, sx, 0, sw, img.height, 15, 60, 285, 350);
          }
        }
      activeTracks.filter((track) => track.readyState === "live").forEach((track) => track.requestFrame());
      }
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          await loaded;
          draw();
          const stream = canvas.captureStream(0);
          activeTracks.push(stream.getVideoTracks()[0]);
          fixture.tracks.push(...stream.getTracks());
          return stream;
        },
      });
      await loaded;
      setInterval(draw, 70);
    },
    { palms, fist },
  );
}

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await fakeCamera(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await dismissGuide(page);
  await page.getByRole("button", { name: "手势控制", exact: true }).click();
  await page.locator(".gesture-console.tracking").waitFor({ timeout: 60000 });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".gesture-channels .connected").length === 2,
    { timeout: 15000 },
  );
  log("Local MediaPipe model detected both hands from camera frames.");
  await page
    .getByRole("button", { name: "暂停打印" })
    .waitFor({ timeout: 15000 });
  await page.screenshot({
    path: "artifacts/gesture-desktop.png",
    fullPage: true,
  });
  log("Both open palms started a print through the real detection pipeline.");
  await page.evaluate(() => {
    window.cameraFixture.mode = "single";
  });
  await page.waitForFunction(
    () =>
      document.querySelector('input[aria-label="供料中断"]').value === "100",
  );
  assert.equal(
    await page.getByRole("slider", { name: "供料波动" }).inputValue(),
    "35",
    "the known right-hand fixture must control interruption, preserving anatomical handedness",
  );
  await page.getByRole("button", { name: "交换左右手", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('input[type="range"]')].every(
      (el) => el.value === "100",
    ),
  );
  log(
    "Single-hand aperture controls and left/right swapping changed both live parameters.",
  );

  await page.evaluate(() => {
    window.cameraFixture.mode = "fists";
  });
  await page
    .getByRole("button", { name: "继续打印" })
    .waitFor({ timeout: 15000 });
  log("Both fists paused the print through real landmark classification.");
  await page.evaluate(() => {
    window.cameraFixture.mode = "palms";
  });
  await page
    .getByRole("button", { name: "暂停打印" })
    .waitFor({ timeout: 15000 });
  await page.evaluate(() => {
    window.cameraFixture.mode = "blank";
  });
  await page
    .getByRole("button", { name: "继续打印" })
    .waitFor({ timeout: 15000 });
  await page.evaluate(() => {
    window.cameraFixture.mode = "single";
  });
  await page.waitForTimeout(1200);
  assert.equal(await page.getByRole("button", { name: "继续打印" }).count(), 1);
  log(
    "Tracking loss paused deposition and reacquiring one hand did not resume it.",
  );

  await page.getByRole("button", { name: "继续打印" }).click();
  await page.evaluate(() => {
    window.cameraFixture.mode = "frozen";
  });
  await page
    .getByRole("button", { name: "继续打印" })
    .waitFor({ timeout: 10000 });
  log("Frozen camera frames also paused deposition.");
  await page.getByRole("button", { name: "结束本次", exact: true }).click();
  await page.evaluate(() => {
    window.cameraFixture.mode = "palms";
  });
  await page.waitForTimeout(1600);
  assert.equal(
    await page
      .getByRole("button", { name: "收藏这件作品", exact: true })
      .count(),
    1,
  );
  await page.getByRole("button", { name: "收藏这件作品", exact: true }).click();
  await page.getByLabel("作品名称").fill("手势试作");
  await page.getByRole("button", { name: "加入作品画廊", exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("uncontrolled-pottery-v1")),
  );
  assert.equal(saved.length, 1);
  assert.ok(saved[0].events.some((event) => event.fluctuation === 100));
  assert.ok(saved[0].events.some((event) => event.interruption === 100));
  await page.getByRole("button", { name: "鼠标控制", exact: true }).click();
  await page.waitForFunction(() =>
    window.cameraFixture.tracks.every((track) => track.readyState === "ended"),
  );
  assert.equal(await page.locator(".gesture-console").count(), 0);
  assert.equal(
    await page.getByRole("slider", { name: "供料波动" }).isEnabled(),
    true,
  );
  log(
    "Completed works survived command poses; parameter history saved and camera tracks released.",
  );
  await page.getByRole("button", { name: "手势控制", exact: true }).click();
  await page.locator(".gesture-console.tracking").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "鼠标控制", exact: true }).click();
  await page.waitForFunction(() =>
    window.cameraFixture.tracks.every((track) => track.readyState === "ended"),
  );
  log("Reopening gesture mode reused the downloaded assets and recreated the detector.");
  await page.close();

  for (const width of [768, 390, 360]) {
    const mobile = await browser.newPage({ viewport: { width, height: 844 } });
    mobile.on("pageerror", (error) => errors.push(error.message));
    await fakeCamera(mobile);
    await mobile.goto(baseUrl, { waitUntil: "networkidle" });
    await dismissGuide(mobile);
    await mobile.evaluate(() => {
      window.cameraFixture.mode = "single";
    });
    await mobile.getByRole("button", { name: "手势控制", exact: true }).click();
    await mobile
      .locator(".gesture-console.tracking")
      .waitFor({ timeout: 60000 });
    await mobile.waitForFunction(
      () =>
        document.querySelectorAll(".gesture-channels .connected").length > 0,
    );
    const layout = await mobile.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      buttonOverflow: [...document.querySelectorAll("button")]
        .filter((el) => el.clientWidth && el.scrollWidth > el.clientWidth + 2)
        .map((el) => el.getAttribute("aria-label")),
      camera: document
        .querySelector(".gesture-console")
        .getBoundingClientRect()
        .toJSON(),
      tools: document
        .querySelector(".viewport-bottom")
        .getBoundingClientRect()
        .toJSON(),
      scene: document
        .querySelector(".viewport")
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.equal(layout.overflow, false);
    assert.deepEqual(layout.buttonOverflow, []);
    assert.ok(
      layout.camera.bottom <= layout.tools.top ||
        layout.camera.top >= layout.scene.bottom,
      `camera overlaps tools at ${width}: ${JSON.stringify(layout)}`,
    );
    await mobile.screenshot({
      path: `artifacts/gesture-${width}.png`,
      fullPage: true,
    });
    await mobile
      .getByRole("button", { name: "关闭摄像头", exact: true })
      .click();
    await mobile.waitForFunction(() =>
      window.cameraFixture.tracks.every(
        (track) => track.readyState === "ended",
      ),
    );
    await mobile.close();
    log(
      `Gesture interface at ${width}px has no overflowing controls or overlapping tools.`,
    );
  }

  const denied = await browser.newPage();
  await denied.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        Promise.reject(new DOMException("Denied", "NotAllowedError")),
    });
  });
  await denied.goto(baseUrl, { waitUntil: "networkidle" });
  await dismissGuide(denied);
  await denied.getByRole("button", { name: "手势控制", exact: true }).click();
  await denied
    .getByRole("status")
    .filter({ hasText: "摄像头权限未开启" })
    .waitFor();
  await denied.getByRole("button", { name: "鼠标控制", exact: true }).click();
  await denied.getByRole("slider", { name: "供料波动" }).fill("65");
  await denied.getByRole("button", { name: "暂停打印" }).waitFor();
  await denied.close();
  log("Camera denial leaves a working mouse fallback.");
  assert.deepEqual(errors, []);
  log("All gesture browser checks passed.");
} catch (error) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      console.log(await page.locator(".gesture-console").allTextContents());
      await page.screenshot({
        path: "artifacts/gesture-failure.png",
        fullPage: true,
      });
    }
  }
  throw error;
} finally {
  await browser.close();
}
