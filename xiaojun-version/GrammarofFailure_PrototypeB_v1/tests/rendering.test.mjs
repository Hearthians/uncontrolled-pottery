import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PARAMETERS, generateToolpath } from "../src/toolpath.ts";
import { beadBuffers, writeBead, SIDES, FLOATS_PER_MOVE, INDICES_PER_MOVE } from "../src/claySurface.ts";
import { createClayMaterial, createLdmHead } from "../src/clayAppearance.ts";
import * as THREE from "three";

test("visual clay is deterministic, finite, and never changes commanded moves", () => {
  const path = generateToolpath(DEFAULT_PARAMETERS), snapshot = structuredClone(path);
  const a = beadBuffers(path), b = beadBuffers(path);
  assert.deepEqual(a, b); assert.deepEqual(path, snapshot);
  assert.ok(a.positions.every(Number.isFinite)); assert.ok(a.normals.every(Number.isFinite));
  assert.ok(a.indices.every(i => i < a.positions.length / 3));
  assert.equal(a.indices.length, path.moves.filter(m => m.extrude).length * INDICES_PER_MOVE);
  assert.equal(a.indexBefore[0], 0);
  assert.equal(a.indexBefore.at(-1), a.indices.length);
  // Wrong winding reverses double-sided lighting despite otherwise valid buffers.
  for (let i = 0; i < a.indices.length; i += 3) {
    const [ia, ib, ic] = a.indices.slice(i, i + 3);
    const v = index => new THREE.Vector3().fromArray(a.positions, index * 3);
    const face = v(ib).sub(v(ia)).cross(v(ic).sub(v(ia)));
    const normal = new THREE.Vector3().fromArray(a.normals, ia * 3);
    assert.ok(face.dot(normal) > 0);
  }
});
test("flattened beads retain layer envelope, centred partial growth and aligned joints", () => {
  const path = generateToolpath(DEFAULT_PARAMETERS), move = path.moves[1];
  const p = new Float32Array(FLOATS_PER_MOVE), n = new Float32Array(FLOATS_PER_MOVE);
  writeBead(move, .37, p, n);
  for (let axis = 0; axis < 3; axis++) {
    let centre = 0;
    for (let j = 0; j < SIDES; j++) centre += p[(SIDES + j) * 3 + axis] / SIDES;
    assert.ok(Math.abs(centre - (move.start[axis] + .37 * (move.end[axis] - move.start[axis]))) < 1e-6);
  }
  assert.equal(Math.min(...p.filter((_, i) => i % 3 === 2)), 0);
  assert.equal(Math.max(...p.filter((_, i) => i % 3 === 2)), 1);
  const q = new Float32Array(FLOATS_PER_MOVE);
  writeBead(move, 1, p, n); writeBead(path.moves[2], 1, q, n);
  assert.deepEqual(p.slice(SIDES * 3), q.slice(0, SIDES * 3));
});
test("head outlet is at the path origin and clay uses nonmetallic rough PBR", () => {
  const head = createLdmHead(), nozzle = head.children[0];
  nozzle.geometry.computeBoundingBox(); head.updateMatrixWorld(true);
  const tip = new THREE.Vector3(0, nozzle.geometry.boundingBox.min.y, 0);
  nozzle.localToWorld(tip);
  assert.ok(tip.length() < 1e-7);
  const material = createClayMaterial();
  assert.equal(material.metalness, 0); assert.ok(material.roughness > .7);
  const color = material.color;
  assert.ok(color.r > color.g && color.g > color.b);
  head.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  material.dispose();
});

test("layer contact is broad and continuous without changing the layer envelope", () => {
  const path = generateToolpath(DEFAULT_PARAMETERS);
  const lower = path.moves.find(m => m.kind === "deposition" && m.layerId === 0);
  const upper = path.moves.find(m => m.kind === "deposition" && m.layerId === 1);
  const a = new Float32Array(FLOATS_PER_MOVE), b = new Float32Array(FLOATS_PER_MOVE);
  const normals = new Float32Array(FLOATS_PER_MOVE);
  writeBead(lower, 1, a, normals); writeBead(upper, 1, b, normals);
  const contact = data => Array.from({ length: SIDES }, (_, j) =>
    [...data.slice(j * 3, j * 3 + 3)]).filter(p => p[2] === 1);
  const top = contact(a), bottom = contact(b);
  assert.ok(top.length >= 5 && bottom.length >= 5);
  const span = points => [Math.min(...points.map(p => p[0])), Math.max(...points.map(p => p[0]))];
  const [amin, amax] = span(top), [bmin, bmax] = span(bottom);
  assert.ok(Math.min(amax, bmax) - Math.max(amin, bmin) > 1.5);
});

test("real extruding seam remains visible without the former doubled tangential thickness", () => {
  const path = generateToolpath(DEFAULT_PARAMETERS);
  const transition = path.moves.find(m => m.kind === "transition");
  assert.equal(transition.extrude, true);
  assert.deepEqual(transition.start, [15, 0, .5]);
  assert.deepEqual(transition.end, [15, 0, 1.5]);
  const p = new Float32Array(FLOATS_PER_MOVE), normals = new Float32Array(FLOATS_PER_MOVE);
  writeBead(transition, 1, p, normals);
  const ys = p.filter((_, i) => i % 3 === 1);
  assert.equal(Math.max(...ys) - Math.min(...ys), transition.beadHeightMm);
  const buffers = beadBuffers(path), index = path.moves.indexOf(transition);
  assert.equal(buffers.indexBefore[index + 1] - buffers.indexBefore[index], INDICES_PER_MOVE);
});
