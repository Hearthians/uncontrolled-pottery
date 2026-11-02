import test from "node:test";
import assert from "node:assert/strict";
import { DepositionLab, LAB_DT, labMetrics } from "../src/depositionLab.ts";

function complete(kind = "single", config = {}) {
  const model = new DepositionLab(kind, config);
  model.advanceTo(model.endTick);
  return model;
}

test("all small experiments conserve injected volume and keep nonnegative finite cells", () => {
  for (const kind of ["single", "layers", "restart"]) {
    const model = complete(kind);
    const metrics = labMetrics(model.snapshot());
    assert.ok(Math.abs(metrics.massErrorPercent) < 1e-8);
    assert.ok(model.height.every((h) => Number.isFinite(h) && h >= 0));
    assert.ok(metrics.peakMm < 12);
    assert.ok(model.layers.every((layer) => layer.every((h) => Number.isFinite(h) && h >= 0)));
    for (let i = 0; i < model.height.length; i++)
      assert.ok(Math.abs(model.layers.reduce((s, layer) => s + layer[i], 0) - model.height[i]) < 1e-12);
  }
});

test("fixed ticks reproduce exactly and paused advancement has no effect", () => {
  const direct = complete("layers"), split = new DepositionLab("layers");
  for (let tick = 47; tick < split.endTick; tick += 47) split.advanceTo(tick);
  split.advanceTo(split.endTick);
  assert.deepEqual(split.snapshot(), direct.snapshot());
  const before = split.snapshot(); split.advanceTo(split.tick);
  assert.deepEqual(split.snapshot(), before);
});

test("smaller nozzle clearance spreads the same amount into a lower wider bead", () => {
  const narrow = labMetrics(complete("single", { clearanceMm: 1.5 }).snapshot());
  const tall = labMetrics(complete("single", { clearanceMm: 3 }).snapshot());
  assert.ok(Math.abs(narrow.volumeMm3 - tall.volumeMm3) < 1e-8);
  assert.ok(narrow.widthMm > tall.widthMm);
  assert.ok(narrow.peakMm < tall.peakMm * 0.85);
});

test("three passes each supply the same volume and earlier material moves during later passes", () => {
  const model = new DepositionLab("layers");
  model.advanceTo(Math.round(3.95 / LAB_DT));
  const before = model.layers[0].slice();
  model.advanceTo(model.endTick);
  const cellArea = model.config.cellMm ** 2;
  const expected = 36 / 10 * 120;
  for (const layer of model.layers)
    assert.ok(Math.abs(layer.reduce((sum, h) => sum + h * cellArea, 0) - expected) < 1e-8);
  assert.ok(model.layers[0].some((h, i) => Math.abs(h - before[i]) > 1e-4));
});

test("stop/restart preserves a low-material interval and cannot spend untracked reservoir mass", () => {
  const model = complete("restart");
  const columnHeight = (x) => {
    const i = Math.floor((x + model.nx * model.config.cellMm / 2) / model.config.cellMm);
    return Math.max(...Array.from({ length: model.nz }, (_, j) => model.height[j * model.nx + i]));
  };
  assert.ok(columnHeight(1) < 0.05, "cut interval is not joined by meshing or a forced cap");
  assert.ok(columnHeight(-10) > 1 && columnHeight(10) > 1);
  assert.ok(model.injectedMm3 < 320 && model.injectedMm3 > 300);
});

test("coarse-grid check is reported as sensitivity, not claimed as physical validation", () => {
  const fine = labMetrics(complete("single", { cellMm: 0.5 }).snapshot());
  const coarse = labMetrics(complete("single", { cellMm: 1 }).snapshot());
  assert.ok(Math.abs(fine.peakMm - coarse.peakMm) / fine.peakMm < 0.15);
  assert.ok(Math.abs(coarse.massErrorPercent) < 1e-8);
  assert.throws(() => new DepositionLab("single", { feedMm3S: NaN }));
  assert.throws(() => new DepositionLab("single", { cellMm: 0.0001 }));
});
