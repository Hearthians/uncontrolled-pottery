import test from "node:test";
import assert from "node:assert/strict";
import { createArchive, parseArchive } from "../src/archive.ts";
import { DURATION, PRESETS as LEGACY_PRESETS, generateDeposits as legacyDeposits } from "../src/simulation.ts";
import { PRESETS, generateDeposits, isPottery } from "../src/pottery.ts";
import { MaterialSimulation, MATERIAL_PROFILE, MATERIAL_TICKS } from "../src/materialSimulation.ts";
import { PlasticSimulation, PLASTIC_PROFILE } from "../src/plasticSimulation.ts";
import { COLLECTIVE_EMOTION_PLAN, emotionPlanToEvents } from "../src/emotionTrajectory.ts";

function plasticFixture() {
  const events = emotionPlanToEvents();
  const simulation = new PlasticSimulation(19);
  simulation.advanceTo(480, events);
  simulation.stop();
  simulation.advanceTo(MATERIAL_TICKS, events);
  const pottery = {
    ...LEGACY_PRESETS[0],
    id: "plastic-roundtrip",
    steps: simulation.deposits.length,
    duration: simulation.tick / MATERIAL_TICKS * DURATION,
    events,
    simulation: simulation.record(),
    emotionPlan: structuredClone(COLLECTIVE_EMOTION_PLAN),
  };
  return { pottery, simulation };
}

test("all three simulation generations preserve process data and matching archive metadata", () => {
  const { pottery: plastic } = plasticFixture();
  for (const pottery of [LEGACY_PRESETS[0], PRESETS[0], plastic]) {
    assert.equal(isPottery(pottery), true);
    const archive = createArchive(pottery);
    assert.equal(archive.version, pottery.simulation?.version ?? 1);
    const profile = pottery.simulation?.version === 3 ? PLASTIC_PROFILE : MATERIAL_PROFILE;
    if (pottery.simulation) {
      assert.equal(archive.simulation.id, pottery.simulation.profile);
      for (const [key, value] of Object.entries(profile)) {
        assert.deepEqual(archive.simulation[key], value);
      }
    } else {
      assert.equal(archive.simulation.id, undefined);
    }
    assert.deepEqual(parseArchive(JSON.stringify(archive)), { ...pottery, preset: false });
  }
});

test("v3 archive replay preserves stopped geometry, supply history, and emotion provenance", () => {
  const { pottery, simulation } = plasticFixture();
  const restored = parseArchive(JSON.stringify(createArchive(pottery)));
  assert.deepEqual(generateDeposits(restored), simulation.deposits);
  assert.deepEqual(restored.simulation.pulses, simulation.record().pulses);
  assert.deepEqual(restored.emotionPlan, COLLECTIVE_EMOTION_PLAN);
  assert.equal(restored.emotionPlan.mappingVersion, "emotion-behavior-2");
});

test("v1 and v2 archive dispatch retains exact original geometry without migrating presets", () => {
  for (const pottery of LEGACY_PRESETS) {
    const restored = parseArchive(JSON.stringify(createArchive(pottery)));
    assert.equal(restored.simulation, undefined);
    assert.deepEqual(generateDeposits(restored), legacyDeposits(pottery));
  }
  for (const pottery of PRESETS) {
    assert.equal(pottery.simulation.version, 2);
    assert.equal(pottery.simulation.profile, MATERIAL_PROFILE.id);
    const simulation = new MaterialSimulation(pottery.seed, pottery.simulation);
    simulation.advanceTo(pottery.simulation.ticks, pottery.events);
    const restored = parseArchive(JSON.stringify(createArchive(pottery)));
    assert.equal(restored.simulation.version, 2);
    assert.deepEqual(generateDeposits(restored), simulation.deposits);
  }
});

test("an older emotion mapping and its recorded sag events are not recompiled on import", () => {
  const pottery = {
    ...PRESETS[0],
    events: [{ step: 0, fluctuation: 12, interruption: 3, sag: false }],
    emotionPlan: { ...structuredClone(COLLECTIVE_EMOTION_PLAN), mappingVersion: "emotion-behavior-1" },
  };
  assert.deepEqual(parseArchive(JSON.stringify(createArchive(pottery))), { ...pottery, preset: false });
});

test("malformed and unsupported archives are rejected before reconstruction", () => {
  const archive = createArchive(PRESETS[0]);
  for (const invalid of [null, {}, { ...archive, version: 99 },
    { ...archive, version: 1 },
    { ...archive, pottery: { ...PRESETS[0], events: [null] } },
    { ...archive, pottery: { ...PRESETS[0], simulation: { ...PRESETS[0].simulation, version: 99 } } }]) {
    assert.throws(() => parseArchive(JSON.stringify(invalid)));
  }
});

test("v2 and v3 imports reject wrapper, profile, timing, and record mismatches", () => {
  const { pottery: plastic } = plasticFixture();
  for (const pottery of [PRESETS[0], plastic]) {
    const archive = createArchive(pottery);
    const wrongProfile = pottery.simulation.version === 3 ? MATERIAL_PROFILE : PLASTIC_PROFILE;
    for (const invalid of [
      { ...archive, version: pottery.simulation.version === 3 ? 2 : 3 },
      { ...archive, simulation: undefined },
      { ...archive, simulation: { ...archive.simulation, id: wrongProfile.id } },
      { ...archive, simulation: { ...archive.simulation, material: wrongProfile.material } },
      { ...archive, simulation: { ...archive.simulation, fixedStepSeconds: 1 } },
      { ...archive, pottery: { ...pottery, simulation: { ...pottery.simulation, profile: wrongProfile.id } } },
      { ...archive, pottery: { ...pottery, simulation: { ...pottery.simulation, ticks: -1 } } },
      { ...archive, pottery: { ...pottery, simulation: { ...pottery.simulation, stopStep: 12 } } },
    ]) {
      assert.throws(() => parseArchive(JSON.stringify(invalid)));
    }
  }
});
