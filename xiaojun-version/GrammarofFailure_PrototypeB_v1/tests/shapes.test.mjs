import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PARAMETERS, cylinderContours, generateToolpath, sampleToolpath } from "../src/toolpath.ts";
import { SHAPE_FAMILIES, shapeFromSeed, resolveShape, vesselPoint } from "../src/shapes.ts";
import { Playback } from "../src/playback.ts";
import { beadBuffers, INDICES_PER_MOVE } from "../src/claySurface.ts";
const build = (family, seed, dimensions = {}, extra = {}) => generateToolpath(
  { ...DEFAULT_PARAMETERS, ...dimensions }, { family, seed, parameters: { foldAmplitude: .6 }, ...extra });

for (const family of SHAPE_FAMILIES) {
  test(`${family}: 20 seeds produce positive, closed, horizontal simple contours`, () => {
    for (let seed = 0; seed < 20; seed++) {
      const path = build(family, seed, { heightMm: seed % 2 ? 35 : 20 });
      assert.equal(path.contours.length, seed % 2 ? 35 : 20);
      for (const contour of path.contours) {
        assert.deepEqual(contour.points[0], contour.points.at(-1));
        const count = contour.points.length - 1;
        for (let i = 0; i < count; i++) {
          const a = contour.points[i], b = contour.points[i + 1];
          assert.ok(a.every(Number.isFinite));
          assert.equal(a[2], contour.zMm);
          assert.ok(Math.hypot(a[0], a[1]) > 0);
          // Positive radii in monotonically ordered angular wedges guarantee a simple polygon.
          const theta = i / count * Math.PI * 2;
          assert.ok(Math.abs(a[0] * Math.sin(theta) - a[1] * Math.cos(theta)) < 1e-9);
          assert.ok(a[0] * b[1] - a[1] * b[0] > 0);
        }
      }
    }
  });
  test(`${family}: deterministic paths, meaningful seeds, descriptor replay and full playback`, () => {
    const path = build(family, 173);
    assert.deepEqual(path, build(family, 173));
    const variant = build(family, 174);
    const maxDifference = Math.max(...path.contours.flatMap((c, i) => c.points.slice(0, -1).map((p, j) => {
      const other = variant.contours[i].points[j];
      return Math.hypot(p[0] - other[0], p[1] - other[1]);
    })));
    assert.ok(maxDifference > .3);
    assert.deepEqual(path, build(family, 173, {}, { parameters: path.shape.parameters }));
    assert.deepEqual(path.shape, JSON.parse(JSON.stringify(path.shape)));
    path.shape.layers.forEach((layer, i) => {
      assert.equal(layer.layerId, i); assert.equal(layer.zMm, i + .5);
      assert.equal(layer.normalizedHeight, layer.zMm / 20);
      const points = path.contours[i].points;
      const length = points.slice(1).reduce((s, p, j) => s + Math.hypot(p[0] - points[j][0], p[1] - points[j][1]), 0);
      assert.ok(Math.abs(length - layer.contourLengthMm) < 1e-9);
    });
    const playback = new Playback(path);
    playback.play();
    for (let i = 0; i < path.moves.length; i++) {
      const move = path.moves[i];
      if (i) assert.deepEqual(move.start, path.moves[i - 1].end);
      assert.equal(move.extrude, move.kind !== "travel");
      const sample = sampleToolpath(path, (move.startTimeS + move.endTimeS) / 2);
      sample.position.forEach((v, axis) => assert.ok(Math.abs(v - (move.start[axis] + move.end[axis]) / 2) < 1e-8));
    }
    playback.advance(path.durationS);
    assert.equal(playback.playing, false);
    assert.deepEqual(playback.sample().position, path.moves.at(-1).end);
    const mesh = beadBuffers(path);
    assert.ok(mesh.positions.every(Number.isFinite)); assert.ok(mesh.normals.every(Number.isFinite));
    assert.equal(mesh.indices.length, path.moves.filter(m => m.extrude).length * INDICES_PER_MOVE);
  });
}

test("cylinder baseline, explicit resolved parameters and layer conventions are unchanged", () => {
  const path = generateToolpath(DEFAULT_PARAMETERS);
  assert.deepEqual(path.contours, cylinderContours(DEFAULT_PARAMETERS));
  assert.deepEqual(path, build("cylinder", 0, {}, { parameters: path.shape.parameters }));
  assert.equal(build("bulbous", 1, { heightMm: 20.3 }).contours.length, 21);
});
test("threshold warnings expose unsupported shifts without silently altering geometry", () => {
  const permissive = build("bulbous", 52, {}, { maxLayerDisplacementMm: 10 });
  const strict = build("bulbous", 52, {}, { maxLayerDisplacementMm: .001 });
  assert.deepEqual(permissive.moves, strict.moves);
  assert.ok(strict.shape.warnings.some(w => w.code === "layer-displacement" && w.measuredMm > w.limitMm));
  assert.ok(strict.shape.layers[0].maxLateralDisplacementMm === 0);
  assert.throws(() => build("bulbous", -1));
  assert.throws(() => build("bulbous", 1, {}, { maxLayerDisplacementMm: 0 }));
  assert.throws(() => build("cylinder", 1, {}, { parameters: { foldCount: 3.5 } }));
  assert.throws(() => build("tapered", 1, {}, { parameters: { foldAmplitude: Infinity } }));
});
test("neutral presets have distinct continuous silhouettes and support both taper directions", () => {
  const shapes = SHAPE_FAMILIES.map(f => build(f, 123, {}, { parameters: { foldAmplitude: 0 } }));
  const radius = (path, layer) => Math.hypot(...path.contours.at(layer).points[0].slice(0, 2));
  assert.equal(radius(shapes[0], 0), radius(shapes[0], -1));
  assert.ok(radius(shapes[1], -1) > radius(shapes[1], 0));
  const decreasing = build("tapered", 123, {}, { parameters: { taper: -.3 } });
  assert.ok(radius(decreasing, -1) < radius(decreasing, 0));
  assert.ok(radius(shapes[2], 10) > radius(shapes[2], 0));
  assert.ok(Math.abs(radius(shapes[2], 0) - radius(shapes[2], -1)) < 1e-9);
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++)
    assert.notDeepEqual(shapes[i].contours, shapes[j].contours);
});

test("zero fold intensity exactly restores each neutral shape regardless of seed or asymmetry", () => {
  for (const family of SHAPE_FAMILIES) {
    const neutral = generateToolpath(DEFAULT_PARAMETERS, { family, seed: 1 });
    const disabled = build(family, 9123, {}, { parameters: {
      foldAmplitude: 0, foldCount: 4, foldPosition: 2.1, foldHeight: .7, foldSpread: .2, asymmetry: .6,
    } });
    assert.deepEqual(disabled.contours, neutral.contours);
    assert.deepEqual(disabled.moves, neutral.moves);
  }
});

test("increasing intensity produces visible bounded folds with smooth interlayer transitions", () => {
  for (const family of SHAPE_FAMILIES) {
    const neutral = build(family, 27, {}, { parameters: { foldAmplitude: 0 } });
    let previous = 0;
    for (const foldAmplitude of [.25, .5, 1]) {
      const path = build(family, 27, {}, { parameters: { foldAmplitude } });
      let max = 0;
      path.contours.forEach((c, i) => c.points.forEach((p, j) => {
        const base = neutral.contours[i].points[j];
        const difference = Math.hypot(p[0] - base[0], p[1] - base[1]);
        assert.ok(difference <= Math.hypot(base[0], base[1]) * .18 * foldAmplitude + 1e-9);
        max = Math.max(max, difference);
      }));
      assert.ok(max > previous && max > .15);
      assert.ok(path.shape.layers.every(layer => layer.maxLateralDisplacementMm < 1));
      // Derivatives of P(theta,z) are continuous; no finite jumps at sampled heights.
      const p = resolveShape({ family, seed: 27, parameters: { foldAmplitude } });
      for (let z = .1; z < 20; z += .2) {
        const a = vesselPoint(.7, z, DEFAULT_PARAMETERS, p);
        const b = vesselPoint(.7, z + 1e-5, DEFAULT_PARAMETERS, p);
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4);
      }
      previous = max;
    }
  }
});

test("maximum bounded deformation stays valid at small, tall and wide dimensions", () => {
  for (const family of SHAPE_FAMILIES) for (const dimensions of [
    { heightMm: 1, radiusMm: 2 }, { heightMm: 200, radiusMm: 2 }, { heightMm: 20, radiusMm: 70 },
  ]) {
    const path = build(family, 3, dimensions, { parameters: {
      foldAmplitude: 1, foldCount: 4, asymmetry: .6, foldSpread: .2,
    } });
    for (const contour of path.contours) for (const point of contour.points) {
      assert.ok(point.every(Number.isFinite));
      assert.ok(Math.hypot(point[0], point[1]) >= dimensions.radiusMm * .65 * .82 - 1e-9);
    }
    assert.ok(path.moves.every(m => m.lengthMm > 0 && Number.isFinite(m.endTimeS)));
  }
  assert.ok(build("tapered", 0, { radiusMm: 2 }).shape.warnings.some(w => w.code === "minimum-radius"));
  for (const foldAmplitude of [-.1, 1.1, NaN])
    assert.throws(() => build("cylinder", 1, {}, { parameters: { foldAmplitude } }));
});

test("initial family selection is reproducible from a seed and covers all base shapes", () => {
  const families = new Set();
  for (let seed = 0; seed < 3000; seed += 17) {
    assert.deepEqual(shapeFromSeed(seed), shapeFromSeed(seed));
    families.add(shapeFromSeed(seed).family);
  }
  assert.equal(families.size, 3);
});
