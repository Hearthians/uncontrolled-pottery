import test from "node:test";
import assert from "node:assert/strict";
import { generateGeometry, GEOMETRY_SCHEMA_VERSION, GEOMETRY_GENERATOR_VERSION } from "../src/geometry.ts";
import { generateToolpath } from "../src/toolpath.ts";
import { SHAPE_FAMILIES } from "../src/shapes.ts";
import { consumeGeometry, example } from "../examples/geometry-consumer.ts";

const request = (baseProfile = "cylinder", heightMm = 20) => ({
  geometry: { baseProfile, seed: 123, heightMm, radiusMm: 15, parameters: { foldAmplitude: .6 } },
  sampling: { layerHeightMm: 1 }, printing: { beadWidthMm: 2, feedrateMmMin: 600 },
});

for (const family of SHAPE_FAMILIES) test(`${family}: contract preserves legacy paths and layer metadata`, async () => {
  for (const height of [20, 35, 20.3]) {
    const input = request(family, height), result = await generateGeometry(input);
    const legacy = generateToolpath({ heightMm: height, radiusMm: 15, ...input.sampling, ...input.printing },
      { family, seed: 123, parameters: input.geometry.parameters });
    assert.equal(result.schemaVersion, GEOMETRY_SCHEMA_VERSION);
    assert.equal(result.generatorVersion, GEOMETRY_GENERATOR_VERSION);
    assert.deepEqual(result.descriptor, legacy.shape);
    assert.deepEqual(result.toolpath.moves, legacy.moves);
    assert.equal(result.toolpath.durationS, legacy.durationS);
    assert.equal(result.toolpath.lengthMm, legacy.lengthMm);
    assert.deepEqual(result.validation.buildVolume, legacy.buildVolume);
    assert.equal(result.contours.length, Math.ceil(height));
    result.contours.forEach((layer, i) => {
      assert.deepEqual(layer, { ...legacy.contours[i], ...legacy.shape.layers[i] });
      assert.equal(layer.layerId, i);
      assert.equal(layer.normalizedHeight, layer.zMm / height);
      assert.deepEqual(layer.points[0], layer.points.at(-1));
    });
    assert.equal(result.validation.machine.diameterMm, 200);
    assert.equal(result.validation.machine.heightMm, 400);
    assert.equal(result.validation.buildVolume.safetyMarginMm, 5);
    assert.equal(result.coordinates.units, "mm");
    assert.equal(result.coordinates.upAxis, "Z");
    assert.doesNotMatch(JSON.stringify(result), /CylinderGeometry|platform/);
  }
});

test("geometry identity is deterministic, canonical and independent of printing/validation", async () => {
  const input = request(), original = await generateGeometry(input);
  assert.deepEqual(original, await generateGeometry(input));
  const reordered = { ...input, geometry: { ...input.geometry,
    parameters: Object.fromEntries(Object.entries(original.geometry.parameters).reverse()) } };
  assert.deepEqual(original, await generateGeometry(reordered));
  const otherSettings = await generateGeometry({ ...input,
    printing: { beadWidthMm: 3, feedrateMmMin: 1200 },
    validation: { safetyMarginMm: 0, maxLayerDisplacementMm: .001 },
  });
  assert.equal(otherSettings.geometryId, original.geometryId);
  assert.deepEqual(otherSettings.contours, original.contours);
  assert.notEqual(otherSettings.toolpath.durationS, original.toolpath.durationS);
  assert.equal(otherSettings.validation.status, "valid-with-warnings");
  for (const changed of [
    { ...input, geometry: { ...input.geometry, seed: 124 } },
    { ...input, geometry: { ...input.geometry, heightMm: 35 } },
    { ...input, geometry: { ...input.geometry, parameters: { foldAmplitude: .9 } } },
    { ...input, sampling: { layerHeightMm: .5 } },
  ]) assert.notEqual((await generateGeometry(changed)).geometryId, original.geometryId);
  assert.match(original.geometryId, /^gof-geometry-1\.1\.1-[a-f0-9]{64}$/);
});

test("result is recursively immutable without freezing caller-owned inputs", async () => {
  const input = request(), before = structuredClone(input);
  const pending = generateGeometry(input);
  input.geometry.parameters.foldAmplitude = .2;
  const result = await pending;
  assert.equal(result.geometry.parameters.foldAmplitude, before.geometry.parameters.foldAmplitude);
  assert.equal(Object.isFrozen(input), false);
  const frozen = value => {
    if (value && typeof value === "object") {
      assert.equal(Object.isFrozen(value), true);
      Object.values(value).forEach(frozen);
    }
  };
  frozen(result);
  assert.throws(() => { result.contours[0].points[0][0] = 999; }, TypeError);
  assert.throws(() => { result.toolpath.moves[0].end[2] = 999; }, TypeError);
  assert.throws(() => result.descriptor.layers.push({}), TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("zero folds, validation failures and isolated consumer schedule obey the contract", async () => {
  const input = request();
  const neutral = await generateGeometry({ ...input, geometry: { ...input.geometry, parameters: { foldAmplitude: 0 } } });
  assert.equal(neutral.geometry.modifier, "none");
  assert.equal(neutral.validation.status, "valid");
  const geometry = await generateGeometry(request("bulbous", 35));
  const before = JSON.stringify(geometry), consumed = consumeGeometry(geometry);
  assert.equal(consumed.schedule.geometryId, geometry.geometryId);
  assert.equal(consumed.layerCount, 35);
  assert.deepEqual(consumed.schedule.entries.map(entry => entry.layerId),
    geometry.contours.filter(l => l.normalizedHeight >= .25 && l.normalizedHeight < .75).map(l => l.layerId));
  assert.equal(JSON.stringify(geometry), before);
  assert.deepEqual(await example(), consumed);
  await assert.rejects(generateGeometry({ ...input, geometry: { ...input.geometry, heightMm: 401 } }), /Build-volume rejected/);
  await assert.rejects(generateGeometry({ ...input, geometry: { ...input.geometry, radiusMm: 99 } }), /Build-volume rejected/);
  await assert.rejects(generateGeometry({ ...input, sampling: { layerHeightMm: 0 } }), /positive/);
});

// Pin version 1 so formula/policy changes cannot silently retain the same identity contract.
test("generator 1.1.1 fixture pins identity and representative numeric output", async () => {
  const result = await generateGeometry(request("bulbous", 35));
  assert.equal(result.geometryId, "gof-geometry-1.1.1-8aa136bfc24dcd10acd8d256cc95ff19147fb667b82f8edf8a3b801903f6fb9e");
  const expected = [13.137358317089488, 13.356396426590226, 17.5];
  result.contours[17].points[12].forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9));
  assert.ok(Math.abs(result.contours[17].contourLengthMm - 113.68323423116752) < 1e-9);
  assert.ok(Math.abs(result.toolpath.durationS - 367.29542136067664) < 1e-9);
});
