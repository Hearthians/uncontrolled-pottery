import test from "node:test";
import assert from "node:assert/strict";
import {
  SEGMENTS,
  TOTAL_STEPS,
  DEFAULT_SETTINGS,
  PRESETS,
  createDeposit,
  generateDeposits,
  isPottery,
  meanSettings,
} from "../src/simulation.ts";

test("saved process records reproduce identical deposited geometry", () => {
  for (const pottery of PRESETS) {
    const restored = JSON.parse(JSON.stringify(pottery));
    assert.equal(isPottery(restored), true);
    assert.deepEqual(generateDeposits(pottery), generateDeposits(restored));
  }
});

test("changing supply parameters preserves all material already deposited", () => {
  const pottery = {
    ...PRESETS[0],
    steps: 1500,
    events: [{ step: 0, ...DEFAULT_SETTINGS }],
  };
  const before = generateDeposits(pottery);
  const after = generateDeposits({
    ...pottery,
    steps: 2200,
    events: [
      ...pottery.events,
      { step: 1500, fluctuation: 100, interruption: 100, sag: true },
    ],
  });
  assert.deepEqual(after.slice(0, 1500), before);
  assert.ok(after.slice(1500).some((p) => p.gap));
});

test("continuous supply creates no gaps and interrupted supply leaves local voids", () => {
  const stable = generateDeposits({
    ...PRESETS[0],
    events: [{ step: 0, fluctuation: 0, interruption: 0, sag: false }],
  });
  const interrupted = generateDeposits({
    ...PRESETS[0],
    events: [{ step: 0, fluctuation: 0, interruption: 100, sag: false }],
  });
  assert.ok(stable.every((p) => !p.gap));
  assert.ok(stable.every((p) => p.radius === 1.12 && p.thickness === 0.031));
  assert.ok(
    interrupted.slice(SEGMENTS * 2).filter((p) => p.gap).length >
      TOTAL_STEPS * 0.4,
  );
  assert.ok(interrupted.slice(0, SEGMENTS * 2).every((p) => !p.gap));
});

test("local sag responds to missing support while keeping the deformation bounded", () => {
  const previous = Array.from({ length: SEGMENTS }, () => ({
    x: 0,
    y: 0.055,
    z: 0,
    radius: 1.12,
    thickness: 0.031,
    gap: true,
  }));
  const without = createDeposit(
    SEGMENTS,
    { ...DEFAULT_SETTINGS, sag: false },
    19,
    previous,
  );
  const withSag = createDeposit(
    SEGMENTS,
    { ...DEFAULT_SETTINGS, sag: true },
    19,
    previous,
  );
  assert.ok(withSag.y < without.y);
  assert.ok(without.y - withSag.y <= 0.1);
  assert.deepEqual(previous[0], {
    x: 0,
    y: 0.055,
    z: 0,
    radius: 1.12,
    thickness: 0.031,
    gap: true,
  });
});

test("record validation rejects invalid parameters and out of order changes", () => {
  assert.equal(isPottery({ ...PRESETS[0], events: [] }), false);
  assert.equal(isPottery({ ...PRESETS[0], steps: TOTAL_STEPS + 1 }), false);
  assert.equal(
    isPottery({
      ...PRESETS[0],
      events: [{ step: 0, ...DEFAULT_SETTINGS, interruption: -1 }],
    }),
    false,
  );
  assert.equal(
    isPottery({
      ...PRESETS[0],
      events: [
        { step: 0, ...DEFAULT_SETTINGS },
        { step: 5, ...DEFAULT_SETTINGS },
        { step: 2, ...DEFAULT_SETTINGS },
      ],
    }),
    false,
  );
});

test("summary parameters are weighted by deposited length", () => {
  const pottery = {
    ...PRESETS[0],
    steps: 100,
    events: [
      { step: 0, fluctuation: 100, interruption: 0, sag: false },
      { step: 25, fluctuation: 0, interruption: 100, sag: false },
    ],
  };
  assert.deepEqual(meanSettings(pottery), {
    fluctuation: 25,
    interruption: 75,
  });
});
