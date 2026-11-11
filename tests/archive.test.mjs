import test from "node:test";
import assert from "node:assert/strict";
import { createArchive, parseArchive } from "../src/archive.ts";
import { DURATION, PRESETS as LEGACY_PRESETS, generateDeposits as legacyDeposits } from "../src/simulation.ts";
import { PRESETS, generateDeposits, isPottery } from "../src/pottery.ts";
import { MaterialSimulation, MATERIAL_PROFILE, MATERIAL_TICKS } from "../src/materialSimulation.ts";
import { PlasticSimulation, PLASTIC_PROFILE } from "../src/plasticSimulation.ts";
import { HeightfieldSimulation, HEIGHTFIELD_PROFILE } from "../src/heightfieldSimulation.ts";
import { generateMaterial } from "../src/pottery.ts";
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

test("custom titles retain their original language across all archive versions", () => {
  const { pottery: plastic } = plasticFixture();
  for (const original of [LEGACY_PRESETS[0], PRESETS[0], plastic]) {
    const pottery = { ...original, title: "旧作 · 自定义名称" };
    const restored = parseArchive(JSON.stringify(createArchive(pottery)));
    assert.equal(restored.title, pottery.title);
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

test("v4 archive retains the experimental field, original plan and strict model metadata", () => {
  const events = emotionPlanToEvents();
  const engine = new HeightfieldSimulation(91);
  engine.advanceTo(320, events);
  engine.stop();
  engine.advanceTo(MATERIAL_TICKS, events);
  const pottery = { ...LEGACY_PRESETS[0], id: "heightfield-roundtrip", title: "Field study",
    seed: 91, events, steps: engine.deposits.length, duration: engine.tick / MATERIAL_TICKS * DURATION,
    simulation: engine.record(), emotionPlan: structuredClone(COLLECTIVE_EMOTION_PLAN) };
  assert.equal(isPottery(pottery), true);
  const archive = createArchive(pottery);
  assert.equal(archive.version, 4);
  for (const [key, value] of Object.entries(HEIGHTFIELD_PROFILE)) assert.deepEqual(archive.simulation[key], value);
  const restored = parseArchive(JSON.stringify(archive));
  assert.deepEqual(restored, { ...pottery, preset: false });
  const replay = generateMaterial(restored);
  assert.deepEqual(replay.surface.height, engine.surface.height);
  assert.deepEqual(replay.deposits, engine.deposits);
  assert.deepEqual(replay.nozzle, engine.nozzle);
  for (const invalid of [
    { ...archive, version: 3 },
    { ...archive, simulation: { ...archive.simulation, id: PLASTIC_PROFILE.id } },
    { ...archive, simulation: { ...archive.simulation, cellMm: 1 } },
    { ...archive, pottery: { ...pottery, simulation: { ...pottery.simulation, profile: PLASTIC_PROFILE.id } } },
  ]) assert.throws(() => parseArchive(JSON.stringify(invalid)));
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

test("optional memory print provenance round-trips without changing recorded-event replay across v1–v4", () => {
  const { pottery: plastic } = plasticFixture();
  const engine = new HeightfieldSimulation(91);
  const events = [{ step: 0, fluctuation: 13, interruption: 2, sag: true },
    { step: 160, fluctuation: 61, interruption: 17, sag: true }];
  engine.advanceTo(320, events);
  engine.stop();
  engine.advanceTo(MATERIAL_TICKS, events);
  const heightfield = { ...LEGACY_PRESETS[0], seed: 91, events,
    steps: engine.deposits.length, simulation: engine.record() };
  for (const original of [LEGACY_PRESETS[0], PRESETS[0], plastic, heightfield]) {
    for (const source of ["analyzed", "demo"]) {
      const memoryPrintPlan = { version: 1, mapping: "memory-supply-1", source, memoryCount: 2000 };
      const pottery = { ...original, memoryPrintPlan };
      const archive = createArchive(pottery);
      assert.equal(archive.version, original.simulation?.version ?? 1);
      const restored = parseArchive(JSON.stringify(archive));
      assert.deepEqual(restored, { ...pottery, preset: false });
      assert.deepEqual(restored.events, original.events);
      assert.deepEqual(generateMaterial(restored), generateMaterial(original));
      assert.deepEqual(Object.keys(archive.pottery.memoryPrintPlan).sort(),
        ["mapping", "memoryCount", "source", "version"]);
    }
  }
});

test("memory print provenance strictly rejects malformed or private fields on save and import", () => {
  const plan = { version: 1, mapping: "memory-supply-1", source: "analyzed", memoryCount: 1 };
  for (const invalid of [
    null, [], "plan", {},
    { ...plan, version: 2 }, { ...plan, version: "1" },
    { ...plan, mapping: "memory-supply-2" }, { ...plan, source: "random" },
    ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null].map(
      (memoryCount) => ({ ...plan, memoryCount })),
    { ...plan, text: "PRIVATE MEMORY" },
    { ...plan, scores: { calm: 5 } },
    { ...plan, memories: [{ text: "PRIVATE MEMORY", scores: [5] }] },
  ]) {
    const pottery = { ...PRESETS[0], memoryPrintPlan: invalid };
    assert.equal(isPottery(pottery), false);
    assert.throws(() => createArchive(pottery));
    const archive = { ...createArchive(PRESETS[0]), pottery };
    assert.throws(() => parseArchive(JSON.stringify(archive)));
  }
  const pottery = { ...PRESETS[0], memoryPrintPlan: plan };
  const serialized = JSON.stringify(createArchive(pottery));
  assert.equal(serialized.includes("PRIVATE MEMORY"), false);
  assert.equal(serialized.includes('"scores"'), false);
  assert.deepEqual(parseArchive(serialized).memoryPrintPlan, plan);
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
