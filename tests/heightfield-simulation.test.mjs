import test from "node:test";
import assert from "node:assert/strict";
import { hostname, userInfo } from "node:os";
import {
  HeightfieldSimulation, HEIGHTFIELD_PROFILE, validHeightfieldRecord,
} from "../src/heightfieldSimulation.ts";
import { DepositionLab, LAB_DEFAULTS, LAB_DT, labMetrics } from "../src/depositionLab.ts";
import { PlasticSimulation, PLASTIC_PROFILE, validPlasticRecord } from "../src/plasticSimulation.ts";
import {
  BASE_TOP, MATERIAL_DT, MATERIAL_PROFILE, RUNOUT_STEPS, SETTLE_STEPS, plannedNozzle,
} from "../src/materialSimulation.ts";
import { TOTAL_STEPS, SEGMENTS } from "../src/simulation.ts";

const stable = [{ step: 0, fluctuation: 0, interruption: 0, sag: true }];
const varied = [
  { step: 0, fluctuation: 65, interruption: 60, sag: true },
  { step: 431, fluctuation: 100, interruption: 15, sag: false },
  { step: 790, fluctuation: 10, interruption: 100, sag: true },
];
const scale = MATERIAL_PROFILE.millimetersPerUnit;
const volumeMm3 = (s) => s.surface.height.reduce((sum, h) => sum + h * s.surface.cellMm ** 2, 0);
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);

function assertBalanced(s) {
  assert.ok(s.surface.height.every((h) => Number.isFinite(h) && h >= 0));
  const deposited = s.deposits.reduce((sum, p) => sum + p.volume, 0);
  near(deposited, s.depositedVolume, 1e-11);
  near(s.depositedVolume + s.tipVolume, s.deliveredVolume, 1e-10);
  near(s.injectedMm3, s.depositedVolume * scale ** 3, 1e-6);
  near(volumeMm3(s), s.injectedMm3, Math.max(1e-8, s.injectedMm3 * 1e-10));
  for (const p of s.deposits) {
    assert.ok([p.x, p.y, p.z, p.radius, p.volume].every(Number.isFinite));
    assert.equal(p.thickness, 0);
    assert.equal(p.halfHeight, 0);
    assert.equal(p.breakBefore, true, "diagnostic path samples must not become strand geometry");
    assert.equal(p.gap, p.volume === 0);
  }
}

function snapshot(s) {
  return {
    record: s.record(), height: s.surface.height.slice(), deposits: structuredClone(s.deposits),
    nozzle: { ...s.nozzle }, flow: s.flow, pressure: s.pressure,
    delivered: s.deliveredVolume, deposited: s.depositedVolume, tip: s.tipVolume,
    injected: s.injectedMm3, boundary: s.boundaryVolumeMm3,
  };
}

// Deliberate finite-volume initial-condition probes. Zero supply lets us separate
// pressure-driven redistribution of existing mass from deposition of new mass.
function unforced() {
  const s = new HeightfieldSimulation(19, {
    version: 4, profile: HEIGHTFIELD_PROFILE.id, ticks: 0, stopStep: 0, pulses: [],
  });
  s.pressure = s.flow = 0;
  return s;
}
function cellAt(s, x, z) {
  const { nx, nz, cellMm } = s.surface;
  return Math.floor((z + nz * cellMm / 2) / cellMm) * nx + Math.floor((x + nx * cellMm / 2) / cellMm);
}

test("v4 exposes an empty stable live Cartesian field and frozen experimental lab material profile", () => {
  const s = new HeightfieldSimulation(19);
  const { nx, nz, cellMm, height } = s.surface;
  assert.equal(s.tick, 0);
  assert.equal(s.deposits.length, 0);
  assert.equal(height.length, nx * nz);
  assert.ok(height instanceof Float64Array && height.every((h) => h === 0));
  assert.equal(cellMm, 2);
  assert.ok(nx * cellMm >= 128 && nz * cellMm >= 128);
  assert.ok(Object.isFrozen(HEIGHTFIELD_PROFILE));
  assert.ok(Object.values(HEIGHTFIELD_PROFILE).every((value) => typeof value !== "object"));
  assert.equal(HEIGHTFIELD_PROFILE.id, "clay-heightfield-experiment-1");
  assert.equal(HEIGHTFIELD_PROFILE.diameterMm, 100);
  assert.equal(HEIGHTFIELD_PROFILE.substeps, Math.ceil(MATERIAL_DT / LAB_DT));
  assert.ok(HEIGHTFIELD_PROFILE.substepSeconds <= LAB_DT);
  near(HEIGHTFIELD_PROFILE.substepSeconds * HEIGHTFIELD_PROFILE.substeps, MATERIAL_DT, 1e-15);
  for (const key of ["yieldPa", "viscosityPaS", "squeezePaPerMm", "densityKgM3"])
    assert.equal(HEIGHTFIELD_PROFILE[key], LAB_DEFAULTS[key]);
  const surface = s.surface;
  s.advanceTo(1, stable);
  assert.strictEqual(s.surface, surface);
  assert.strictEqual(s.surface.height, height);
  assert.ok(height.some((h) => h > 0));
  assert.equal(s.deposits.length, 1);
  near(s.nozzle.x, plannedNozzle(1).x, 0);
  near(s.nozzle.z, plannedNozzle(1).z, 0);
  assert.ok(s.nozzle.contactY >= BASE_TOP);
  assertBalanced(s);
});

test("fixed batching, pause, rewind requests and legacy sag flags do not alter v4 physics", () => {
  const a = new HeightfieldSimulation(63), b = new HeightfieldSimulation(63);
  a.advanceTo(1000, varied);
  const toggledSag = varied.map((event) => ({ ...event, sag: !event.sag }));
  for (let tick = 37; tick < 1000; tick += 37) b.advanceTo(tick, toggledSag);
  b.advanceTo(1000, toggledSag);
  assert.deepEqual(snapshot(b), snapshot(a));
  const before = snapshot(a);
  a.advanceTo(a.tick, varied);
  a.advanceTo(0, varied);
  assert.deepEqual(snapshot(a), before);
  assert.equal(a.dirtyStart, a.deposits.length);
  assertBalanced(a);
});

test("supply noise, seed, pulses, thresholds and runout remain numerically identical to v3", () => {
  const historical = new PlasticSimulation(63), s = new HeightfieldSimulation(63);
  for (let tick = 1; tick <= 640; tick++) {
    historical.advanceTo(tick, varied);
    s.advanceTo(tick, varied);
    for (const key of ["flow", "pressure", "deliveredVolume", "depositedVolume", "tipVolume"])
      assert.equal(s[key], historical[key], `${key} at tick ${tick}`);
    assert.equal(s.deposits.at(-1).volume, historical.deposits.at(-1).volume);
    assert.deepEqual(s.pulses, historical.pulses);
  }
  historical.stop(); s.stop();
  historical.advanceTo(historical.endTick, varied);
  s.advanceTo(s.endTick, varied);
  for (const key of ["flow", "pressure", "deliveredVolume", "depositedVolume", "tipVolume"])
    assert.equal(s[key], historical[key]);
  assert.deepEqual(s.pulses, historical.pulses);
  assert.equal(historical.record().version, 3);
  assert.equal(historical.record().profile, PLASTIC_PROFILE.id);
  assertBalanced(s);
});

test("early stop, captured pulses and records without pulse lists replay exactly", () => {
  const live = new HeightfieldSimulation(63);
  live.advanceTo(800, varied);
  live.stop();
  const midRunout = live.tick + 21;
  live.advanceTo(midRunout, varied);
  const midRecord = live.record();
  const resumed = new HeightfieldSimulation(63, midRecord);
  resumed.advanceTo(midRecord.ticks, varied);
  assert.deepEqual(snapshot(resumed), snapshot(live));
  live.advanceTo(TOTAL_STEPS + SETTLE_STEPS, varied);
  assert.equal(live.pathEnd, 800 + RUNOUT_STEPS);
  assert.equal(live.endTick, live.pathEnd + SETTLE_STEPS);
  assert.equal(live.tick, live.endTick);
  assert.equal(live.complete, true);
  assert.equal(live.deposits.length, live.pathEnd);
  assert.equal(live.nozzle.flow, 0);
  assert.ok(live.pulses.length > 0);
  assert.ok(live.deposits.some((p) => p.gap));
  assert.ok(live.tipVolume > 0, "below-threshold residual supply stays accounted at the tip");
  const record = live.record();
  const replay = new HeightfieldSimulation(63, record);
  // Once recorded, pulse times override interruption settings; fluctuation/seed still apply.
  replay.advanceTo(record.ticks, varied.map((event) => ({ ...event, interruption: 0 })));
  assert.deepEqual(snapshot(replay), snapshot(live));
  const { pulses, ...withoutPulses } = record;
  const regenerated = new HeightfieldSimulation(63, withoutPulses);
  regenerated.advanceTo(record.ticks, varied);
  assert.deepEqual(snapshot(regenerated), snapshot(live));
  record.pulses[0].start = 0;
  assert.notEqual(live.pulses[0].start, 0, "record() returns independent pulse objects");
  assertBalanced(live);
});

test("nozzle pressure redistributes existing volume beyond the source without changing rheology", () => {
  const under = unforced(), away = unforced();
  const a = cellAt(under, 49, 1), b = cellAt(away, -49, 1);
  under.surface.height[a] = away.surface.height[b] = 5;
  under.advanceTo(1, stable); away.advanceTo(1, stable);
  assert.equal(under.injectedMm3, 0);
  assert.equal(away.surface.height[b], 5, "hydrostatic shear here is below the fixed yield threshold");
  assert.ok(under.surface.height[a] < 4.5, "the low nozzle produces meaningful lateral extrusion");
  assert.ok(under.surface.height.filter((h) => h > 0).length > 1);
  near(volumeMm3(under), 20, 1e-12);
  near(volumeMm3(away), 20, 1e-12);
  assert.ok(under.surface.height.every((h) => Number.isFinite(h) && h >= 0));
});

test("gravity yields a tall mound and closed boundaries conserve it without wraparound or clamping", () => {
  const s = unforced();
  s.surface.height[0] = 100;
  s.advanceTo(1, stable);
  assert.ok(s.surface.height[0] < 100);
  assert.ok(s.surface.height[1] > 0 && s.surface.height[s.surface.nx] > 0);
  assert.equal(s.surface.height[s.surface.nx - 1], 0, "a row boundary is not a neighbor face");
  assert.equal(s.surface.height.at(-1), 0, "no periodic wraparound");
  s.advanceTo(s.endTick, stable);
  near(volumeMm3(s), 400, 1e-9);
  assert.ok(s.boundaryVolumeMm3 > 0 && s.boundaryVolumeMm3 <= 400);
  assert.ok(s.surface.height.every((h) => Number.isFinite(h) && h >= 0));
});

test("record validation uses historical bounds but rejects every non-v4 or unknown profile", () => {
  const s = new HeightfieldSimulation(1);
  s.advanceTo(20, stable); s.stop(); s.advanceTo(s.endTick, stable);
  const valid = s.record();
  assert.ok(validHeightfieldRecord(valid, s.deposits.length));
  assert.equal(validPlasticRecord(valid, s.deposits.length), false);
  assert.equal(validHeightfieldRecord(null, 0), false);
  for (const invalid of [
    { ...valid, version: 3 }, { ...valid, profile: PLASTIC_PROFILE.id },
    { ...valid, ticks: NaN }, { ...valid, ticks: 0.5 }, { ...valid, ticks: -1 },
    { ...valid, ticks: s.endTick + 1 }, { ...valid, stopStep: -1 },
    { ...valid, stopStep: TOTAL_STEPS }, { ...valid, stopStep: 1.5 },
    { ...valid, pulses: [{ start: 2, end: 1 }] },
    { ...valid, pulses: [{ start: 20, end: 21 }] },
    { ...valid, pulses: [{ start: 1, end: TOTAL_STEPS + 201 }] },
    { ...valid, pulses: [{ start: 1, end: 10 }, { start: 9, end: 15 }] },
  ]) assert.equal(validHeightfieldRecord(invalid, s.deposits.length), false);
  assert.equal(validHeightfieldRecord(valid, s.deposits.length - 1), false);
  assert.ok(validHeightfieldRecord({ version: 4, profile: HEIGHTFIELD_PROFILE.id,
    ticks: 0, stopStep: TOTAL_STEPS - RUNOUT_STEPS }, 0));
});

test("historical lab and v3 numerical baselines stay unchanged", () => {
  const lab = new DepositionLab("single");
  lab.advanceTo(lab.endTick);
  const metrics = labMetrics(lab.snapshot());
  near(metrics.volumeMm3, 432.0000000000011, 1e-9);
  near(metrics.peakMm, 2.6484419465186235, 1e-12);
  near(metrics.centerHeightMm, 2.62201273839759, 1e-12);
  assert.equal(metrics.widthMm, 5);
  const old = new PlasticSimulation(63);
  old.advanceTo(640, [{ step: 0, fluctuation: 65, interruption: 60, sag: true }]);
  near(old.flow, 0.15474983207840878, 1e-14);
  near(old.pressure, 0.5394463685378834, 1e-14);
  near(old.deliveredVolume, 0.06900177075309007, 1e-14);
  assert.deepEqual(old.pulses, [
    { start: 138, end: 203 }, { start: 246, end: 297 },
    { start: 307, end: 366 }, { start: 564, end: 613 },
  ]);
});

test("one full-run CPU benchmark: finite conservative annular field, not an imposed tall cylinder", (t) => {
  const s = new HeightfieldSimulation(19);
  const started = performance.now();
  s.advanceTo(s.endTick, stable);
  const elapsedSeconds = (performance.now() - started) / 1000;
  assert.equal(s.complete, true);
  assert.equal(s.deposits.length, 10240);
  assert.equal(s.tick, TOTAL_STEPS + SETTLE_STEPS);
  assertBalanced(s);
  let innerVolume = 0, outerVolume = 0, peak = 0, peakRadius = 0;
  const { nx, nz, cellMm, height } = s.surface;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const radius = Math.hypot((i + 0.5) * cellMm - nx * cellMm / 2,
      (j + 0.5) * cellMm - nz * cellMm / 2);
    const h = height[j * nx + i];
    if (radius < 20) innerVolume += h * cellMm ** 2;
    if (radius > 55) outerVolume += h * cellMm ** 2;
    if (h > peak) { peak = h; peakRadius = radius; }
  }
  assert.ok(innerVolume < s.injectedMm3 * 0.01, "the source forms a hollow annular ridge, not a solid cylinder");
  assert.ok(peakRadius > 30 && peakRadius < 65);
  assert.ok(outerVolume > 0, "material can spread off the prescribed path");
  assert.ok(peak < MATERIAL_PROFILE.layerHeightMm * (TOTAL_STEPS / SEGMENTS),
    "there is no kinematic wall-height constraint");
  t.diagnostic(JSON.stringify({ host: hostname(), account: userInfo().username, pid: process.pid,
    elapsedSeconds, ticks: s.tick, millisecondsPerTick: elapsedSeconds * 1000 / s.tick,
    playbackBudgetSeconds: 55, injectedMm3: s.injectedMm3,
    massErrorMm3: volumeMm3(s) - s.injectedMm3, peakMm: peak, peakRadiusMm: peakRadius,
    innerVolumeMm3: innerVolume, outerVolumeMm3: outerVolume,
    boundaryVolumeMm3: s.boundaryVolumeMm3,
    boundaryFraction: s.boundaryVolumeMm3 / s.injectedMm3,
  }));
});
