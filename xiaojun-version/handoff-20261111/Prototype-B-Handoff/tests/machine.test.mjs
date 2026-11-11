import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MACHINE, validateBuildVolume, BuildVolumeError } from "../src/machine.ts";
import { createBuildPlate, MM_TO_SCENE } from "../src/buildPlate.ts";
import { DEFAULT_PARAMETERS, generateToolpath, randomValidShape } from "../src/toolpath.ts";
import { SHAPE_FAMILIES, shapeFromSeed } from "../src/shapes.ts";
import { beadBuffers, writeBead, FLOATS_PER_MOVE } from "../src/claySurface.ts";

const build = (dimensions = {}, shape = { family: "cylinder", seed: 0 }, margin = 5) =>
  generateToolpath({ ...DEFAULT_PARAMETERS, ...dimensions }, shape, margin);
const move = (start, end, extrude = true, kind = "deposition") => ({
  start, end, extrude, kind, beadWidthMm: 2, beadHeightMm: 1,
});

test("plate is a fixed 200 mm machine part at Z=0 for every shape configuration", () => {
  for (const family of SHAPE_FAMILIES) for (const seed of [0, 173]) for (const foldAmplitude of [0, 1]) {
    const path = build({ heightMm: seed ? 35 : 20 }, { family, seed, parameters: { foldAmplitude } });
    const before = structuredClone(path), plate = createBuildPlate();
    const body = plate.getObjectByName("Build plate surface");
    const box = new THREE.Box3().setFromObject(body), size = box.getSize(new THREE.Vector3());
    assert.equal(size.x / MM_TO_SCENE, 200);
    assert.equal(size.z / MM_TO_SCENE, 200);
    assert.ok(Math.abs(box.max.y) < 1e-7);
    assert.ok(Math.abs(size.y - .13) < 1e-7);
    assert.equal(body.position.x, 0); assert.equal(body.position.z, 0);
    assert.deepEqual(body.scale.toArray(), [1, 1, 1]);
    assert.equal(body.material.color.getHexString(), "d9d2c6");
    assert.deepEqual(path, before);
    assert.doesNotMatch(JSON.stringify(path), /build plate|platform|CylinderGeometry/i);
    plate.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  assert.equal(2 * DEFAULT_PARAMETERS.radiusMm / MACHINE.diameterMm, .15);
  assert.ok(build().buildVolume.deposited.radiusMm / (MACHINE.diameterMm / 2) < .17);
});

test("cylindrical limits include XY offsets, bead width and travel without travel deposition", () => {
  assert.equal(validateBuildVolume([move([75, 75, .5], [75, 76, .5])], 0).valid, false);
  const offset = build().moves.map(m => ({ ...m, start: [m.start[0] + 86, m.start[1], m.start[2]],
    end: [m.end[0] + 86, m.end[1], m.end[2]] }));
  assert.equal(validateBuildVolume(offset, 0).valid, false);
  const edge = move([99.5, 0, .5], [99.5, .1, .5]);
  const rejected = validateBuildVolume([edge], 0);
  assert.ok(rejected.nozzle.radiusMm < 100);
  assert.ok(rejected.deposited.radiusMm > 100);
  assert.equal(rejected.valid, false);
  assert.equal(validateBuildVolume([{ ...edge, extrude: false, kind: "travel" }], 0).valid, true);
  assert.equal(validateBuildVolume([move([101, 0, 1], [101, 0, 5], false, "travel")], 0).valid, false);
  assert.throws(() => build({ radiusMm: 99.5 }, undefined, 0), BuildVolumeError);
  assert.throws(() => build({ radiusMm: 84 }, { family: "bulbous", seed: 1 }), /nominal radius/);
});

test("margin is separate from nominal limits and leaves the bed available", () => {
  const shape = { family: "cylinder", seed: 0 };
  assert.equal(build({ radiusMm: 94 }, shape, 0).buildVolume.valid, true);
  assert.throws(() => build({ radiusMm: 94 }, shape), /safety radius/);
  assert.deepEqual(build({}, shape, 0).moves, build({}, shape, 5).moves);
  assert.equal(build().buildVolume.deposited.min[2], 0);
  for (const margin of [-1, NaN, Infinity, 100]) assert.throws(() => validateBuildVolume([], margin));
});

test("height checks include clay thickness, below-bed geometry and the unchanged final lift", () => {
  assert.throws(() => build({ heightMm: 401 }), /nominal height 400/);
  assert.throws(() => build({ heightMm: 400 }, undefined, 0), /Nozzle path.*nominal height/);
  assert.equal(build({ heightMm: 395 }, undefined, 0).contours.length, 395);
  assert.throws(() => build({ heightMm: 395 }), /safety height/);
  assert.equal(build({ heightMm: 390 }).buildVolume.valid, true);
  for (const z of [.49, 399.6]) {
    const check = validateBuildVolume([move([0, 0, z], [1, 0, z])], 0);
    assert.equal(check.valid, false);
    assert.ok(check.issues.some(issue => issue.startsWith("Deposited clay")));
  }
  assert.equal(validateBuildVolume([move([NaN, 0, 1], [0, 0, 1])]).valid, false);
  assert.equal(validateBuildVolume([]).valid, false);
});

test("swept envelope includes rendered surface and every partial transition", () => {
  for (const family of SHAPE_FAMILIES) {
    const path = build({ heightMm: 35, radiusMm: 60 }, { family, seed: 123, parameters: { foldAmplitude: 1 } });
    const box = path.buildVolume.deposited;
    const partial = [];
    for (const move of path.moves.filter(m => m.kind === "transition")) for (const fraction of [.1, .5, .9]) {
      const positions = new Float32Array(FLOATS_PER_MOVE), normals = new Float32Array(FLOATS_PER_MOVE);
      writeBead(move, fraction, positions, normals); partial.push(...positions);
    }
    const positions = [...beadBuffers(path).positions, ...partial];
    for (let i = 0; i < positions.length; i += 3) {
      assert.ok(Math.hypot(positions[i], positions[i + 1]) <= box.radiusMm + 1e-5);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(positions[i + axis] >= box.min[axis] - 1e-5);
        assert.ok(positions[i + axis] <= box.max[axis] + 1e-5);
      }
    }
  }
});

test("random retries are bounded, deterministic and preserve dimensions without rescaling", () => {
  const parameters = { ...DEFAULT_PARAMETERS, radiusMm: 85 };
  let retried = false;
  for (let seed = 0; seed < 30; seed++) {
    const shape = randomValidShape(parameters, seed);
    assert.deepEqual(shape, randomValidShape(parameters, seed));
    assert.deepEqual(shape, shapeFromSeed(shape.seed));
    const path = generateToolpath(parameters, shape);
    assert.deepEqual(path, generateToolpath(parameters, shape));
    assert.deepEqual(path.parameters, parameters);
    assert.equal(path.buildVolume.valid, true);
    if (shape.seed !== seed) retried = true;
  }
  // Find a seed whose first candidate is a wider family, forcing an actual retry.
  const first = randomValidShape(parameters, 1000);
  retried ||= first.seed !== 1000;
  assert.ok(retried);
  assert.throws(() => randomValidShape({ ...parameters, radiusMm: 99 }, 123), /after 24 attempts/);
});
