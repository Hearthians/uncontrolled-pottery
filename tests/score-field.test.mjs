import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFieldShape } from '../src/scoreFieldTrial.ts';
import { makeScoreBase, SCORE_STUDY } from '../src/scoreStudyCore.ts';

const sectionArea = p => p.width * p.height;
const renderedWidth = p => p.gap ? 0 : p.width;
const renderedHeight = p => p.gap ? 0 : p.height;

test('continuous field preserves the common specimen and a sound foundation', () => {
  const base = makeScoreBase();
  assert.deepEqual(generateFieldShape(0).points, base);
  for (const score of [0.05, 0.2, 0.5, 0.8, 1]) {
    assert.deepEqual(generateFieldShape(score).points.slice(0, 2 * SCORE_STUDY.segments + 1),
      base.slice(0, 2 * SCORE_STUDY.segments + 1));
  }
  for (const invalid of [-0.1, 1.1, NaN, Infinity]) assert.throws(() => generateFieldShape(invalid));
});

test('the severe field is repeatable, pronounced, localized and bounded', () => {
  const result = generateFieldShape(1);
  assert.deepEqual(result, generateFieldShape(1));
  assert.ok(result.metrics.missingFraction > 0.03 && result.metrics.missingFraction < 0.12);
  assert.ok(result.metrics.maxDropMm > 35 && result.metrics.maxDropMm <= 50);
  assert.ok(result.metrics.maxOutwardMm > 35 && result.metrics.maxOutwardMm <= 45.01);
  assert.ok(result.points.every(p => [p.x, p.y, p.z, p.width, p.height].every(Number.isFinite)
    && p.width > 0 && p.height > 0 && p.y >= 0));
  // A neck shrinks both halfaxes together; it does not degenerate into a ribbon.
  assert.ok(result.points.filter(p => !p.gap).every(p => p.width / p.height < 4));
  const gapRuns = [];
  let length = 0;
  for (const p of result.points) {
    if (p.gap) length++;
    else if (length) { gapRuns.push(length); length = 0; }
  }
  assert.ok(gapRuns.length > 5 && gapRuns.length < 40);
  assert.ok(gapRuns.every(run => run >= 3), 'openings remain contiguous spans');
  const hanging = result.points.filter(p => !p.gap && p.sourceY - p.y > 10);
  assert.ok(hanging.length > 60);
  assert.ok(hanging.every(p => p.path > 18), 'settling stays above the designated roof bands');
});

test('bulges accumulate substantial clay on intact wall throughout the score range', () => {
  const base = makeScoreBase(), final = generateFieldShape(1);
  const moundIndex = final.points.reduce((best, p, i, points) =>
    !p.gap && sectionArea(p) > sectionArea(points[best]) ? i : best, 0);
  const original = base[moundIndex], end = final.points[moundIndex];
  assert.ok(sectionArea(end) > 4 * sectionArea(original));
  assert.ok(Math.hypot(end.x, end.z) - Math.hypot(end.sourceX, end.sourceZ) > 15);
  let previousArea = sectionArea(original);
  for (const score of [0.1, 0.2, 0.4, 0.6, 0.8, 1]) {
    const p = generateFieldShape(score).points[moundIndex];
    assert.equal(p.gap, false, 'the accumulation mound must remain independent of openings');
    assert.ok(sectionArea(p) > previousArea);
    assert.ok(Math.abs(p.width - (original.width + score * (end.width - original.width))) < 1e-10);
    assert.ok(Math.abs(p.height - (original.height + score * (end.height - original.height))) < 1e-10);
    previousArea = sectionArea(p);
  }
  const broadMound = final.points.filter((p, i) => !p.gap
    && sectionArea(p) > 2 * sectionArea(base[i])
    && Math.hypot(p.x, p.z) - Math.hypot(p.sourceX, p.sourceZ) > 12);
  assert.ok(broadMound.length > 80, 'accumulation occupies a multi-turn patch, not one stray bead');
});

test('centerline deformation grows linearly over the entire range without stage plateaus', () => {
  const base = makeScoreBase(), end = generateFieldShape(1);
  let previousDrop = 0;
  for (let step = 1; step <= 20; step++) {
    const score = step / 20, shape = generateFieldShape(score);
    assert.ok(Object.values(shape.channels).every(weight => weight === score));
    assert.ok(shape.metrics.maxDropMm > previousDrop, 'low and middle scores also keep developing');
    previousDrop = shape.metrics.maxDropMm;
    for (let i = 0; i < shape.points.length; i++) {
      const p = shape.points[i], a = base[i], b = end.points[i];
      for (const coordinate of ['x', 'y', 'z']) {
        assert.ok(Math.abs(p[coordinate] - (a[coordinate] + score * (b[coordinate] - a[coordinate]))) < 1e-10,
          `point ${i}, score ${score}, ${coordinate}`);
      }
      assert.equal(p.sourceX, a.sourceX); assert.equal(p.sourceY, a.sourceY); assert.equal(p.sourceZ, a.sourceZ);
    }
  }
});

test('all 300 video samples neck smoothly before a connection disappears', () => {
  let before = generateFieldShape(0);
  for (let frame = 1; frame < 300; frame++) {
    const after = generateFieldShape(frame / 299);
    for (let i = 0; i < before.points.length; i++) {
      const a = before.points[i], b = after.points[i];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.23, 'no support-induced centerline jump');
      assert.ok(Math.abs(renderedWidth(a) - renderedWidth(b)) < 0.05, 'no whole-bead width pop');
      assert.ok(Math.abs(renderedHeight(a) - renderedHeight(b)) < 0.03, 'no whole-bead height pop');
      if (!a.gap && b.gap) {
        assert.ok(a.width < 0.05 && a.height < 0.03, 'a connection must be almost zero before it separates');
      }
    }
    before = after;
  }
});
