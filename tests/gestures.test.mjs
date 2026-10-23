import test from "node:test";
import assert from "node:assert/strict";
import { GestureController, readHands } from "../src/gestures.ts";

function hand(side = "left", amount = 30, pose = "adjust") {
  return { side, amount, pose, points: [] };
}
const palms = [hand("left", 100, "open"), hand("right", 100, "open")];
const fists = [hand("left", 0, "fist"), hand("right", 0, "fist")];

test("each hand owns one parameter and briefly detected hands cannot change it", () => {
  const controller = new GestureController();
  assert.deepEqual(controller.update([hand()], 0, "ready").values, {});
  assert.deepEqual(controller.update([hand()], 100, "ready").values, {});
  assert.deepEqual(controller.update([hand()], 200, "ready").values, {
    fluctuation: 30,
  });
  assert.deepEqual(
    controller.update([hand("right", 70)], 300, "ready").values,
    {},
  );
  assert.deepEqual(
    controller.update([hand("right", 70)], 500, "ready").values,
    { interruption: 70 },
  );
});

test("smoothing and a deadband reject small jitter without hiding deliberate changes", () => {
  const controller = new GestureController();
  controller.update([hand()], 0, "printing");
  controller.update([hand()], 200, "printing");
  assert.deepEqual(
    controller.update([hand("left", 31)], 300, "printing").values,
    {},
  );
  const value = controller.update([hand("left", 100)], 400, "printing").values
    .fluctuation;
  assert.ok(value > 30 && value < 100);
  assert.deepEqual(controller.update([], 500, "printing").values, {});
  assert.deepEqual(
    controller.update([hand("left", 10)], 600, "printing").values,
    {},
  );
  assert.deepEqual(
    controller.update([hand("left", 10)], 800, "printing").values,
    { fluctuation: 10 },
  );
});

test("two open palms must dwell continuously and trigger only once until released", () => {
  const controller = new GestureController();
  const commands = [];
  for (let t = 0; t <= 1500; t += 100) {
    const result = controller.update(palms, t, "ready");
    assert.deepEqual(result.values, {});
    if (result.command) commands.push([t, result.command]);
  }
  assert.deepEqual(commands, [[1000, "run"]]);
  controller.update([], 1600, "paused");
  controller.update(palms, 1700, "paused");
  for (let t = 1800; t < 2700; t += 100)
    assert.equal(controller.update(palms, t, "paused").command, undefined);
  assert.equal(controller.update(palms, 2700, "paused").command, "run");
});

test("after releasing a start command, both open hands can control the full parameter range", () => {
  const controller = new GestureController();
  for (let t = 0; t <= 1000; t += 100) controller.update(palms, t, "ready");
  assert.deepEqual(controller.update(palms, 1100, "printing").values, {});
  controller.update([], 1200, "printing");
  controller.update(palms, 1300, "printing");
  assert.deepEqual(controller.update(palms, 1500, "printing").values, {
    fluctuation: 100,
    interruption: 100,
  });
  assert.equal(controller.update(palms, 1600, "paused").hold, 0);
});

test("tracking gaps and changing poses cancel a pending command", () => {
  const controller = new GestureController();
  for (let t = 0; t <= 800; t += 100) controller.update(palms, t, "ready");
  controller.update([palms[0]], 900, "ready");
  assert.equal(controller.update(palms, 1000, "ready").hold, 0);
  assert.equal(controller.update(palms, 2100, "ready").hold, 0);
});

test("two fists pause, one fist does not issue a command", () => {
  const controller = new GestureController();
  for (let t = 0; t <= 1000; t += 100)
    assert.equal(
      controller.update([fists[0]], t, "printing").command,
      undefined,
    );
  for (let t = 1100; t < 2100; t += 100)
    assert.equal(controller.update(fists, t, "printing").command, undefined);
  assert.equal(controller.update(fists, 2100, "printing").command, "pause");
});

test("brief tracking loss freezes parameters; two seconds pauses once without resuming", () => {
  const controller = new GestureController();
  controller.update([hand()], 0, "printing");
  assert.equal(controller.update([], 1900, "printing").command, undefined);
  const result = controller.update([], 2000, "printing");
  assert.equal(result.command, "pause");
  assert.equal(result.reason, "lost");
  assert.equal(controller.update([], 2100, "printing").command, undefined);
  assert.equal(controller.update([hand()], 2200, "paused").command, undefined);
});

test("completed works ignore parameter changes and command poses", () => {
  const controller = new GestureController();
  for (const pose of [palms, fists, [hand("left", 80)]]) {
    controller.reset();
    for (let t = 0; t <= 1500; t += 100) {
      const result = controller.update(pose, t, "complete");
      assert.equal(result.command, undefined);
      assert.deepEqual(result.values, {});
    }
  }
});

const points = [
  [0.5, 0.9],
  [0.43, 0.78],
  [0.35, 0.67],
  [0.28, 0.6],
  [0.2, 0.54],
  [0.38, 0.63],
  [0.38, 0.48],
  [0.38, 0.35],
  [0.38, 0.21],
  [0.47, 0.6],
  [0.47, 0.44],
  [0.47, 0.3],
  [0.47, 0.15],
  [0.56, 0.62],
  [0.56, 0.48],
  [0.56, 0.34],
  [0.56, 0.23],
  [0.65, 0.68],
  [0.65, 0.57],
  [0.65, 0.48],
  [0.65, 0.39],
].map(([x, y]) => ({ x, y }));
function result(landmarks = points, score = 0.99) {
  return {
    landmarks: [landmarks],
    handedness: [[{ categoryName: "Left", score }]],
  };
}

test("landmark mapping distinguishes open palms, pinches and fists at different scales", () => {
  assert.equal(readHands(result())[0].pose, "open");
  const pinch = points.map((p) => ({ ...p }));
  pinch[4] = { ...pinch[8] };
  const mapped = readHands(result(pinch))[0];
  assert.equal(mapped.amount, 0);
  assert.equal(mapped.pose, "adjust");
  const scaled = pinch.map((p) => ({
    x: 0.5 + (p.x - 0.5) * 0.7,
    y: 0.5 + (p.y - 0.5) * 0.7,
  }));
  assert.equal(readHands(result(scaled))[0].amount, mapped.amount);
  const folded = points.map((p) => ({ ...p }));
  for (const tip of [8, 12, 16, 20]) folded[tip].y = 0.74;
  folded[4] = { ...folded[8] };
  assert.equal(readHands(result(folded))[0].pose, "fist");
  assert.equal(readHands(result(), 4 / 3, true)[0].side, "right");
  assert.deepEqual(readHands(result(points, 0.5)), []);
  assert.deepEqual(readHands(result(points.slice(1))), []);
});
