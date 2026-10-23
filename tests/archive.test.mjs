import test from "node:test";
import assert from "node:assert/strict";
import { createArchive, parseArchive } from "../src/archive.ts";
import { PRESETS as LEGACY_PRESETS } from "../src/simulation.ts";
import { PRESETS } from "../src/pottery.ts";

test("both simulation generations survive JSON export and import without changing process data", () => {
  for (const pottery of [LEGACY_PRESETS[0], PRESETS[0]]) {
    const archive = createArchive(pottery);
    assert.equal(archive.version, pottery.simulation ? 2 : 1);
    assert.deepEqual(parseArchive(JSON.stringify(archive)), { ...pottery, preset: false });
  }
});

test("malformed and unsupported archives are rejected before reconstruction", () => {
  const archive = createArchive(PRESETS[0]);
  for (const invalid of [null, {}, { ...archive, version: 3 },
    { ...archive, version: 1 }, { ...archive, pottery: { ...PRESETS[0], events: [null] } },
    { ...archive, pottery: { ...PRESETS[0], simulation: { ...PRESETS[0].simulation, version: 99 } } }]) {
    assert.throws(() => parseArchive(JSON.stringify(invalid)));
  }
});
