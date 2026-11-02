import test from "node:test";
import assert from "node:assert/strict";
import { ClayStrand, PlasticSimulation, PLASTIC_PROFILE } from "../src/plasticSimulation.ts";
import { BASE_RADIUS, LAYER_HEIGHT, SEGMENTS, TOTAL_STEPS } from "../src/simulation.ts";
import { MATERIAL_TICKS, MATERIAL_PROFILE, RUNOUT_STEPS } from "../src/materialSimulation.ts";
import { emotionPlanToEvents } from "../src/emotionTrajectory.ts";

const ds = 2 * Math.PI * BASE_RADIUS / SEGMENTS;
const volume = Math.PI * (MATERIAL_PROFILE.nozzleMm * 0.55 / MATERIAL_PROFILE.millimetersPerUnit) * LAYER_HEIGHT / 2 * ds;
const stable = [{ step: 0, fluctuation: 0, interruption: 0, sag: true }];
const settle = (body, ticks = 180) => { for (let i = 0; i < ticks; i++) body.step(); };

function assertBounded(simulation) {
  assert.ok(simulation.deposits.every((p) =>
    [p.x, p.y, p.z, p.thickness, p.halfHeight, p.volume].every(Number.isFinite)));
  for (const p of simulation.deposits.filter((p) => !p.gap)) {
    assert.ok(Math.abs(p.x) < 5 && Math.abs(p.z) < 5 && p.y < 4 && p.y > -0.3);
    assert.ok(p.thickness > 0 && p.thickness < 1);
  }
  const deposited = simulation.deposits.reduce((sum, p) => sum + p.volume, 0);
  assert.ok(Math.abs(deposited + simulation.tipVolume - simulation.deliveredVolume) < 1e-9);
}

test("a dropped strand settles on contact, widens plastically and conserves its volume", () => {
  const body = new ClayStrand(() => 0);
  const p = body.add(0, 0.12, 0, volume, 0, false);
  const beforeHeight = p.halfHeight;
  const beforeWidth = p.thickness;
  settle(body);
  assert.ok(p.halfHeight < beforeHeight * 0.7);
  assert.ok(p.thickness > beforeWidth * 1.5);
  assert.ok(Math.abs(p.y - p.halfHeight) < 1e-5);
  assert.ok(Math.abs(Math.PI * p.thickness * p.halfHeight * ds - volume) < 1e-12);
  const shape = [p.halfHeight, p.thickness];
  settle(body);
  assert.deepEqual([p.halfHeight, p.thickness], shape, "plastic contact is not elastic rebound");
});

test("a larger unsupported span sags more than a short bridge under the same material law", () => {
  function bridge(halfGap) {
    const body = new ClayStrand((x) => Math.abs(x) > halfGap ? 0.3 : 0);
    for (let i = 0; i < 31; i++) body.add((i - 15) * ds, 0.34, 0, volume, i);
    settle(body);
    return body;
  }
  const short = bridge(0.07), long = bridge(0.25);
  assert.ok(short.deposits[15].y > 0.29, "short bridge retains support from the ends");
  assert.ok(long.deposits[15].y < short.deposits[15].y - 0.1);
  assert.ok(long.deposits.every((p) => p.y - p.halfHeight >= -1e-6));
  assert.ok(long.deposits.some((p) => Math.abs(p.bendY) > 0.01), "yield changes rest curvature permanently");
});

test("overstretched material disconnects instead of producing an unbounded tube", () => {
  const body = new ClayStrand(() => 0);
  for (let i = 0; i < 3; i++) body.add(i * ds, 0.1, 0, volume, i);
  body.deposits[2].x = 0.7;
  body.step();
  assert.equal(body.deposits[2].breakBefore, true);
  assert.ok(body.deposits.every((p) => p.volume === volume));
});

test("spatial contact permits lateral motion without a cylindrical path constraint", () => {
  const body = new ClayStrand(() => 0);
  const lower = body.add(0, 0.022, 0, volume * 2, 0, false);
  settle(body);
  const upper = body.add(0.21, 0.07, 0, volume, 100, false);
  const before = upper.x;
  settle(body);
  assert.ok(upper.x > before + 0.005, "an offset deposit slides down the contact normal");
  assert.ok(upper.y >= upper.halfHeight - 1e-6);
  assert.ok(Math.hypot((upper.x - lower.x) / (upper.thickness + lower.thickness),
    (upper.y - lower.y) / (upper.halfHeight + lower.halfHeight)) > 0.97);
});

test("disconnected neighboring samples still collide, including coincident deposits", () => {
  const body = new ClayStrand(() => 0);
  body.add(0, 0.06, 0, volume, 0, false);
  body.add(0, 0.06, 0, volume, 1, false);
  settle(body);
  const [a, b] = body.deposits;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 0.03);
  assert.ok(a.y >= a.halfHeight && b.y >= b.halfHeight);
});

test("overfeeding creates a wider deposited section and load can wake resting clay", () => {
  const body = new ClayStrand(() => 0);
  const ordinary = body.add(0, 0.1, 0, volume, 0, false);
  const excess = body.add(1, 0.1, 0, volume * 2.5, 100, false);
  settle(body);
  assert.ok(excess.thickness > ordinary.thickness * 2);
  assert.ok(!body.awake.has(0));
  const height = ordinary.halfHeight;
  ordinary.load = volume * 2000;
  body.awake.add(0);
  settle(body, 30);
  assert.ok(ordinary.halfHeight < height, "load beyond the yield point leaves permanent compression");
});

test("v3 uses fixed steps independent of display batching and ignores legacy sag toggles", () => {
  const a = new PlasticSimulation(63), b = new PlasticSimulation(63);
  const events = [{ step: 0, fluctuation: 65, interruption: 60, sag: true }];
  a.advanceTo(1800, events);
  for (let step = 37; step < 1800; step += 37) b.advanceTo(step, [{ ...events[0], sag: false }]);
  b.advanceTo(1800, [{ ...events[0], sag: false }]);
  assert.deepEqual(b.deposits, a.deposits);
  assert.deepEqual(b.record(), a.record());
  const before = JSON.stringify(a.deposits);
  a.advanceTo(1800, events);
  assert.equal(JSON.stringify(a.deposits), before, "pause advances neither gravity nor flow");
  a.stop();
  a.advanceTo(MATERIAL_TICKS, events);
  assert.equal(a.deposits.length, 1800 + RUNOUT_STEPS);
  const replay = new PlasticSimulation(63, a.record());
  replay.advanceTo(a.tick, events);
  assert.deepEqual(replay.deposits, a.deposits);
  assertBounded(a);
});

test("a full stable cylinder stands and an emotion-driven run remains finite and volume-tracked", () => {
  const cylinder = new PlasticSimulation(19);
  cylinder.advanceTo(MATERIAL_TICKS, stable);
  assert.equal(cylinder.complete, true);
  assert.equal(cylinder.deposits.length, TOTAL_STEPS);
  assertBounded(cylinder);
  const solid = cylinder.deposits.filter((p) => !p.gap);
  assert.ok(Math.max(...solid.map((p) => p.y)) > 2.5);
  assert.ok(solid.every((p) => Math.abs(p.radius - BASE_RADIUS) < 0.03));
  const emotional = new PlasticSimulation(19);
  emotional.advanceTo(MATERIAL_TICKS, emotionPlanToEvents());
  assertBounded(emotional);
  assert.ok(emotional.pulses.length > 0);
  assert.ok(emotional.deposits.some((p) => !p.gap && p.birthY - p.y > LAYER_HEIGHT * 2));
  assert.equal(emotional.record().profile, PLASTIC_PROFILE.id);
});
