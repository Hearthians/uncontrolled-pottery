import test from "node:test";
import assert from "node:assert/strict";
import { TOTAL_STEPS, PRESETS as LEGACY_PRESETS, generateDeposits as legacyDeposits } from "../src/simulation.ts";
import { MaterialSimulation, MATERIAL_TICKS, RUNOUT_STEPS, plannedNozzle } from "../src/materialSimulation.ts";
import { DEFAULT_SETTINGS, PRESETS, generateDeposits, isPottery } from "../src/pottery.ts";

function run(events, seed = 19, end = MATERIAL_TICKS, batches = [end]) {
  const simulation = new MaterialSimulation(seed);
  for (const target of batches) simulation.advanceTo(Math.min(end, target), events);
  return simulation;
}

const stableEvents = [{ step: 0, ...DEFAULT_SETTINGS }];

test("zero perturbation follows a fixed toolpath and produces compressed, continuous clay", () => {
  const simulation = run(stableEvents);
  assert.equal(simulation.complete, true);
  assert.equal(simulation.deposits.length, TOTAL_STEPS);
  assert.ok(simulation.deposits.slice(0, TOTAL_STEPS - RUNOUT_STEPS).every((p) => !p.gap));
  assert.ok(simulation.deposits.slice(500, 900).every((p) => p.thickness > p.halfHeight * 2));
  assert.deepEqual(simulation.pulses, []);
  const other = run(stableEvents, 820);
  assert.deepEqual(simulation.deposits, other.deposits, "a seed cannot distort a zero-perturbation cylinder");
});

test("supply pulses have duration, a flow response, and recorded replay", () => {
  const events = [{ step: 0, ...DEFAULT_SETTINGS, interruption: 85 }];
  const simulation = run(events);
  assert.ok(simulation.pulses.length > 3);
  assert.ok(simulation.deposits.some((p) => p.gap));
  const pulse = simulation.pulses[0];
  const onset = run(events, 19, pulse.start + 1);
  assert.ok(onset.flow > 0.5 && onset.flow < 1, "the material cannot disappear on the interruption command");
  const pottery = { ...PRESETS[0], events, simulation: simulation.record() };
  assert.equal(isPottery(pottery), true);
  assert.deepEqual(generateDeposits(JSON.parse(JSON.stringify(pottery))), simulation.deposits);
});

test("display batching does not change geometry, supply history or volume", () => {
  const events = [
    { step: 0, fluctuation: 85, interruption: 65, sag: true },
    { step: 5100, fluctuation: 0, interruption: 0, sag: true },
  ];
  const continuous = run(events);
  const batches = [];
  for (let tick = 1; tick < MATERIAL_TICKS; tick += 71) batches.push(tick);
  batches.push(MATERIAL_TICKS);
  const batched = run(events, 19, MATERIAL_TICKS, batches);
  assert.deepEqual(batched.deposits, continuous.deposits);
  assert.deepEqual(batched.record(), continuous.record());
  const volume = batched.deposits.reduce((sum, p) => sum + p.volume, 0);
  assert.ok(Math.abs(volume + batched.tipVolume - batched.deliveredVolume) < 1e-10);
});

test("supply changes do not move the nozzle or rewrite deposited mass", () => {
  const simulation = run(stableEvents, 19, 1200);
  const mass = simulation.deposits.map((p) => p.volume);
  const events = [...stableEvents, { step: 1200, fluctuation: 100, interruption: 100, sag: true }];
  simulation.advanceTo(3000, events);
  assert.deepEqual(simulation.deposits.slice(0, 1200).map((p) => p.volume), mass);
  const planned = plannedNozzle(3000);
  assert.equal(simulation.nozzle.x, planned.x);
  assert.equal(simulation.nozzle.z, planned.z);
  assert.ok(simulation.deposits.slice(1300).some((p) => p.gap));
});

test("unsupported material settles progressively and contacts lower clay", () => {
  const events = [{ step: 0, fluctuation: 0, interruption: 80, sag: true }];
  const simulation = run(events, 63, 2600);
  const candidate = simulation.deposits.findIndex((p) => !p.gap && p.birthY - p.y > 0.005);
  assert.ok(candidate >= 0, "a missing support must affect deposition");
  const point = simulation.deposits[candidate];
  assert.ok(point.y >= 0.0325, "material stays above the platform");
  assert.ok(simulation.deposits.every((p) =>
    [p.x, p.y, p.z, p.thickness, p.halfHeight, p.volume].every(Number.isFinite)));
});

test("early stop runs out the supply and settles, with no clock movement while paused", () => {
  const simulation = run(stableEvents, 19, 500);
  const before = JSON.stringify(simulation.deposits);
  simulation.advanceTo(500, stableEvents);
  assert.equal(JSON.stringify(simulation.deposits), before);
  simulation.stop();
  simulation.advanceTo(MATERIAL_TICKS, stableEvents);
  assert.equal(simulation.complete, true);
  assert.equal(simulation.deposits.length, 500 + RUNOUT_STEPS);
  assert.ok(simulation.flow < 0.01);
  const saved = { ...PRESETS[0], steps: simulation.deposits.length, events: stableEvents, simulation: simulation.record() };
  assert.equal(isPottery(saved), true);
  assert.deepEqual(generateDeposits(saved), simulation.deposits);
});

test("legacy collections keep their original geometry and unknown material versions are rejected", () => {
  for (const pottery of LEGACY_PRESETS) {
    assert.equal(isPottery(pottery), true);
    assert.deepEqual(generateDeposits(pottery), legacyDeposits(pottery));
  }
  assert.equal(isPottery({ ...PRESETS[0], simulation: { ...PRESETS[0].simulation, version: 3 } }), false);
  assert.equal(isPottery({ ...PRESETS[0], simulation: { ...PRESETS[0].simulation, ticks: -1 } }), false);
  assert.equal(isPottery({ ...PRESETS[0], simulation: { ...PRESETS[0].simulation, stopStep: 12 } }), false);
  assert.equal(isPottery({ ...PRESETS[0], simulation: { ...PRESETS[0].simulation, pulses: [{ start: 300, end: 10 }] } }), false);
});
