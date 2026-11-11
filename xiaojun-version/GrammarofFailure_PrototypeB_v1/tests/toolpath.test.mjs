import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_PARAMETERS, generateToolpath, sampleToolpath } from "../src/toolpath.ts";
import { Playback } from "../src/playback.ts";
import { beadBuffers, writeBead, FLOATS_PER_MOVE, INDICES_PER_MOVE } from "../src/beadGeometry.ts";

const build = (overrides = {}) => generateToolpath({ ...DEFAULT_PARAMETERS, ...overrides });
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

for (const height of [20, 35]) {
  test(`${height} mm at 1 mm produces ${height} closed horizontal contours`, () => {
    const path = build({ heightMm: height });
    assert.equal(path.contours.length, height);
    path.contours.forEach((contour, layerId) => {
      assert.equal(contour.layerId, layerId);
      assert.equal(contour.zMm, layerId + .5);
      assert.deepEqual(contour.points[0], contour.points.at(-1));
      for (const [x, y, z] of contour.points) {
        assert.equal(z, contour.zMm);
        close(Math.hypot(x, y), DEFAULT_PARAMETERS.radiusMm);
      }
    });
  });
}
test("fractional last layer stays within requested material height", () => {
  const last = build({ heightMm: 20.3 }).contours.at(-1);
  close(last.beadHeightMm, .3);
  close(last.zMm + last.beadHeightMm / 2, 20.3);
  assert.equal(build({ heightMm: 2.1, layerHeightMm: .3 }).contours.length, 7);
});
test("deterministic output and radius-dependent sampling", () => {
  assert.deepEqual(build(), build());
  assert.ok(build({ radiusMm: 30 }).contours[0].points.length > build().contours[0].points.length);
});
test("every move is connected; layer changes keep extrusion on", () => {
  const path = build();
  assert.equal(path.moves.filter(m => m.kind === "transition").length, 19);
  assert.equal(path.moves[0].kind, "travel");
  assert.equal(path.moves.at(-1).kind, "travel");
  for (let i = 0; i < path.moves.length; i++) {
    const move = path.moves[i];
    assert.ok(move.lengthMm > 0);
    assert.ok(Number.isInteger(move.layerId));
    assert.ok(move.beadWidthMm > 0 && move.beadHeightMm > 0);
    assert.equal(move.extrude, move.kind !== "travel");
    if (i) assert.deepEqual(move.start, path.moves[i - 1].end);
    if (move.kind === "transition") {
      assert.equal(move.start[0], move.end[0]);
      assert.equal(move.start[1], move.end[1]);
      close(move.end[2] - move.start[2], 1);
      assert.ok(path.moves[i - 1].extrude && path.moves[i + 1].extrude);
    }
  }
});
test("duration and interpolated nozzle position use length/feedrate", () => {
  const path = build();
  for (const move of path.moves) {
    close(move.endTimeS - move.startTimeS, move.lengthMm * 60 / move.feedrateMmMin);
    const midpoint = sampleToolpath(path, (move.startTimeS + move.endTimeS) / 2);
    midpoint.position.forEach((v, i) => close(v, (move.start[i] + move.end[i]) / 2));
  }
  const end = sampleToolpath(path, Infinity);
  assert.deepEqual(end.position, path.moves.at(-1).end);
  assert.equal(end.fraction, 1);
  const fast = build({ feedrateMmMin: 1200 });
  const travelTime = path.moves.filter(m => !m.extrude).reduce((s, m) => s + m.endTimeS - m.startTimeS, 0);
  close(fast.durationS - travelTime, (path.durationS - travelTime) / 2);
});
test("travel generates no clay; partial mesh endpoint matches nozzle centreline", () => {
  const path = build(), buffers = beadBuffers(path);
  assert.equal(buffers.indices.length, path.moves.filter(m => m.extrude).length * INDICES_PER_MOVE);
  assert.equal(buffers.indexBefore[0], 0);
  assert.equal(buffers.indexBefore.at(-1), buffers.indices.length);
  assert.ok(buffers.positions.every(Number.isFinite));
  assert.ok(buffers.normals.every(Number.isFinite));
  assert.ok(buffers.indices.every(i => i < buffers.positions.length / 3));
  const move = path.moves.find(m => m.extrude);
  const positions = new Float32Array(FLOATS_PER_MOVE), normals = new Float32Array(FLOATS_PER_MOVE);
  writeBead(move, .37, positions, normals);
  for (let axis = 0; axis < 3; axis++) {
    let mean = 0;
    for (let j = 0; j < 8; j++) mean += positions[(8 + j) * 3 + axis] / 8;
    close(mean, move.start[axis] + .37 * (move.end[axis] - move.start[axis]), 1e-6);
  }
});
test("pause/resume freezes and resumes exactly the same nozzle and deposited geometry", () => {
  const path = build(), player = new Playback(path), reference = new Playback(path);
  player.play(); reference.play(); player.advance(3.14159);
  player.pause();
  const before = player.sample();
  const renderState = sample => {
    const positions = new Float32Array(FLOATS_PER_MOVE), normals = new Float32Array(FLOATS_PER_MOVE);
    writeBead(path.moves[sample.moveIndex], sample.fraction, positions, normals);
    return { indices: beadBuffers(path).indexBefore[sample.moveIndex], positions };
  };
  const beforeGeometry = renderState(before);
  player.advance(500);
  assert.deepEqual(player.sample(), before);
  assert.deepEqual(renderState(player.sample()), beforeGeometry);
  player.play(); assert.deepEqual(player.sample(), before);
  player.advance(.125); reference.advance(3.14159 + .125);
  assert.deepEqual(player.sample(), reference.sample());
  player.advance(path.durationS); assert.equal(player.playing, false);
  player.reset(); assert.equal(player.elapsedS, 0); assert.equal(player.playing, false);
  assert.deepEqual(player.sample().position, path.moves[0].start);
});
test("rejects invalid or unbounded input before allocating geometry", () => {
  for (const heightMm of [0, -1, NaN, Infinity, 401]) assert.throws(() => build({ heightMm }));
  assert.throws(() => build({ radiusMm: undefined }));
  assert.throws(() => build({ feedrateMmMin: 0 }));
  assert.throws(() => build({ radiusMm: .5 }));
  assert.throws(() => build({ heightMm: 200, radiusMm: 100, layerHeightMm: .1 }));
});
test("core modules have no renderer or browser imports", () => {
  for (const file of ["toolpath.ts", "playback.ts", "beadGeometry.ts", "shapes.ts", "machine.ts", "geometry.ts", "geometryValidation.ts"]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'](?:three|react)|\b(?:window|document)\./);
  }
});
