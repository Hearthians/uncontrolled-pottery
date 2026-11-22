import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePathShape } from '../src/scorePathTrial.ts';
import { makeScoreBase, SCORE_STUDY } from '../src/scoreStudyCore.ts';

test('the path decoder has an unchanged zero-input specimen and deterministic seeds', () => {
  assert.deepEqual(generatePathShape(0).points, makeScoreBase());
  assert.deepEqual(generatePathShape(.8), generatePathShape(.8));
  assert.notDeepEqual(generatePathShape(.6, 43).points, generatePathShape(.6, 42).points);
  for (const invalid of [-.1, 1.1, NaN, Infinity]) assert.throws(() => generatePathShape(invalid));
});

test('different controls produce distinct geometric evidence across the score range', () => {
  const shape = Object.fromEntries([.2, .4, .6, .8, 1].map(score => [score, generatePathShape(score)]));
  assert.equal(shape[.2].metrics.missingFraction, 0);
  assert.ok(shape[.4].metrics.missingFraction > 0);
  assert.ok(shape[.6].metrics.maxOutwardMm > shape[.4].metrics.maxOutwardMm + 3);
  assert.ok(shape[.8].metrics.maxLayerShiftMm > shape[.6].metrics.maxLayerShiftMm + 3);
  assert.ok(shape[.6].metrics.maxDropMm < 10, 'bulges should remain readable before severe settling');
  assert.ok(shape[.8].metrics.maxDropMm < 10, 'misalignment should remain readable before severe settling');
  assert.ok(shape[1].metrics.maxDropMm > shape[.8].metrics.maxDropMm + 12);
});

test('the whole score sweep keeps coherent gaps, plump strands and the foundation', () => {
  const original = makeScoreBase();
  for (const score of SCORE_STUDY.scores) {
    const shape = generatePathShape(score);
    assert.ok(shape.metrics.missingFraction < .16);
    assert.ok(shape.metrics.minY >= 0);
    assert.deepEqual(shape.points.slice(0, SCORE_STUDY.segments * 2 + 1), original.slice(0, SCORE_STUDY.segments * 2 + 1));
    const deposited = shape.points.filter(point => !point.gap);
    assert.ok(deposited.every(point => point.height / point.width >= .5 && point.height / point.width <= .85));
    const missing = shape.points.filter(point => point.gap).length;
    if (missing) assert.ok(missing / (shape.metrics.depositedRuns - 1) > 5, 'gaps must form sustained windows rather than isolated specks');
  }
});
