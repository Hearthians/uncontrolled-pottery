import assert from "node:assert/strict";
import {generateGeometry, geometryToToolpath} from "../../src/geometry.ts";
import {createGeometryManifest} from "../../src/serialization.ts";
import {scheduleFromHeightIntervals} from "../../src/failureSchedule.ts";
import {beadBuffers} from "../../src/claySurface.ts";
import {simulateGaps} from "../../src/gapsSimulation.ts";
import {gapResultToToolpath} from "../../src/gaps.ts";
import {bulgeTiming, simulateBulges} from "../../src/bulges.ts";
import {simulateOffsets} from "../../src/offsets.ts";
import {simulateSagging} from "../../src/sagging.ts";
import {Playback} from "../../src/playback.ts";
import {MACHINE, requireBuildVolume} from "../../src/machine.ts";

// These settings also map to the studio controls described in HANDOFF.md.
const recipe = {
  geometry: {
    baseProfile: "cylinder", modifier: "soft-organic-fold", seed: 123,
    heightMm: 20, radiusMm: 15, parameters: {foldAmplitude: 0, sculpturalIntensity: 0},
  },
  sampling: {layerHeightMm: 1},
  printing: {beadWidthMm: 2, feedrateMmMin: 600},
};
const seed = 42;
const geometry = await generateGeometry(recipe);
const nominal = geometryToToolpath(geometry);
assert.equal(nominal.contours.length, 20);
nominal.contours.forEach((contour, i) => assert.equal(contour.zMm, i + 0.5));
const schedule = scheduleFromHeightIntervals(createGeometryManifest(geometry),
  [{start: 0, end: 1, failureType: "gaps", intensity: 0.7}], seed);

const scenarios = [
  ["Stable", 0, () => ({path: nominal, material: beadBuffers(nominal), events: 0})],
  ["Gaps", 0.7, async () => {
    const result = await simulateGaps(geometry, schedule, seed);
    const path = gapResultToToolpath(result.gaps);
    const interruptions = path.moves.filter(move => move.kind === "travel" && !move.extrude).length
      - nominal.moves.filter(move => move.kind === "travel").length;
    assert.ok(interruptions > 0);
    return {path, material: result.material, events: result.gaps.events.length, id: result.simulationId};
  }],
  ["Bulges", 0.5, async () => {
    const result = await simulateBulges(geometry, 0.5, seed);
    assert.ok(result.metrics.totalDwellS > 0);
    return {path: nominal, material: result.material, events: result.events.length,
      id: result.derivedId, timing: bulgeTiming(nominal, result)};
  }],
  ["Offsets (Combined)", 0.7, async () => {
    const result = await simulateOffsets(geometry, "combined", 0.7, seed);
    assert.ok(result.metrics.travelBoundaries > 0);
    return {path: result.path, material: result.material, events: result.events.length, id: result.derivedId};
  }],
  ["Sagging (Expressive)", 1, async () => {
    const result = await simulateSagging(geometry, 1, seed, "expressive");
    assert.equal(result.metrics.hangingLoops, 3);
    return {path: result.path, material: result.material, events: result.expressiveEvents.length, id: result.derivedId};
  }],
];

const summary = [];
for (const [name, intensity, run] of scenarios) {
  const result = await run();
  const repeat = await run();
  const {path, material, events, id, timing} = result;
  assert.equal(id, repeat.id, name);
  assert.deepEqual(path.moves, repeat.path.moves, name);
  assert.deepEqual(material, repeat.material, name);
  assert.equal(path.contours.length, nominal.contours.length, name);
  if (intensity) assert.ok(events > 0, name);
  requireBuildVolume(path.moves, path.buildVolume.safetyMarginMm);
  for (let i = 0; i < material.positions.length; i += 3) {
    const [x, y, z] = material.positions.subarray(i, i + 3);
    assert.ok(Math.hypot(x, y) <= MACHINE.diameterMm / 2 - path.buildVolume.safetyMarginMm + 1e-5, name);
    assert.ok(z >= -1e-5 && z <= MACHINE.heightMm - path.buildVolume.safetyMarginMm + 1e-5, name);
  }
  const player = new Playback(path, timing);
  player.play();
  const pausedAt = player.advance(player.durationS / 2);
  player.pause();
  assert.deepEqual(player.advance(1), pausedAt, name);
  assert.equal(player.elapsedS, player.durationS / 2, name);
  player.play();
  assert.equal(player.advance(player.durationS).elapsedS, player.durationS, name);
  player.reset();
  assert.equal(player.elapsedS, 0, name);
  summary.push({scenario: name, intensity, seed, events, layers: path.contours.length,
    durationS: Number(player.durationS.toFixed(2))});
}
console.log(geometry.geometryId);
console.table(summary);
