import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMemoryPrintPlan } from '../src/memoryPrintPlan.ts';
import { LAYERS, SEGMENTS } from '../src/simulation.ts';

const zero = () => ({ calm: 0, anxiety: 0, anger: 0, stress: 0, sadness: 0 });
const memory = (scores = zero(), demoScores = false) => ({ scores, demoScores });
const event = (step, fluctuation, interruption) => ({ step, fluctuation, interruption, sag: true });

test('rejects empty, incomplete, invalid, or incorrectly sourced memories', () => {
  assert.throws(() => compileMemoryPrintPlan([], 'analyzed'));
  assert.throws(() => compileMemoryPrintPlan([memory()], 'other'));
  for (const scores of [undefined, null, {}, { ...zero(), calm: -1 }, { ...zero(), calm: 6 },
    { ...zero(), anxiety: 1.5 }, { ...zero(), anger: NaN }, { ...zero(), extra: 0 }]) {
    assert.throws(() => compileMemoryPrintPlan([{ scores }], 'analyzed'));
  }
  assert.throws(() => compileMemoryPrintPlan([memory(), null], 'analyzed'));
  assert.throws(() => compileMemoryPrintPlan([memory(), memory(zero(), true)], 'analyzed'));
  assert.throws(() => compileMemoryPrintPlan([memory(zero(), true), memory()], 'demo'));
  assert.throws(() => compileMemoryPrintPlan([{ scores: zero(), demoScores: 'true' }], 'analyzed'));
  assert.doesNotThrow(() => compileMemoryPrintPlan([{ scores: zero() }], 'analyzed'));
  assert.doesNotThrow(() => compileMemoryPrintPlan([memory(zero(), true)], 'demo'));
});

test('formula uses all five normalized scores, rounding only at the end', () => {
  const cases = [
    [zero(), 12, 2],
    [{ ...zero(), calm: 5 }, 4, 0],
    [{ ...zero(), anxiety: 5 }, 30, 10],
    [{ ...zero(), anger: 5 }, 38, 6],
    [{ ...zero(), stress: 5 }, 26, 14],
    [{ ...zero(), sadness: 5 }, 16, 16],
    [{ calm: 1, anxiety: 2, anger: 3, stress: 4, sadness: 5 }, 48, 31],
    [{ calm: 0, anxiety: 5, anger: 5, stress: 5, sadness: 5 }, 74, 40],
  ];
  for (const [scores, fluctuation, interruption] of cases) {
    const { events } = compileMemoryPrintPlan([memory(scores)], 'analyzed');
    assert.deepEqual(events, Array.from({ length: LAYERS }, (_, i) => event(i * SEGMENTS, fluctuation, interruption)));
  }
});

test('1-2-1 smoothing clamps edges and operates on scores before mapping', () => {
  const memories = Array.from({ length: LAYERS }, () => memory());
  memories[0] = memory({ ...zero(), anger: 5 });
  memories[LAYERS - 1] = memory({ ...zero(), sadness: 5 });
  const { events, contributions, blendedScores } = compileMemoryPrintPlan(memories, 'analyzed');
  assert.equal(blendedScores[0].anger, 3.75);
  assert.equal(blendedScores[1].anger, 1.25);
  assert.equal(blendedScores[63].sadness, 3.75);
  assert.deepEqual(events[0], event(0, 32, 5));
  assert.deepEqual(events[1], event(SEGMENTS, 19, 3));
  assert.deepEqual(events[2], event(2 * SEGMENTS, 12, 2));
  assert.deepEqual(events[LAYERS - 2], event((LAYERS - 2) * SEGMENTS, 13, 6));
  assert.deepEqual(events[LAYERS - 1], event((LAYERS - 1) * SEGMENTS, 15, 13));
  assert.deepEqual(contributions[0], { start: 0, end: 1 });
  assert.deepEqual(contributions[LAYERS - 1], { start: 63, end: 64 });
});

test('overlap weights include partial memories and smooth across layer boundaries', () => {
  const memories = Array.from({ length: 65 }, () => memory());
  memories[1] = memory({ ...zero(), anger: 5 });
  const { events, contributions } = compileMemoryPrintPlan(memories, 'analyzed');
  assert.deepEqual(contributions.slice(0, 3), [{ start: 0, end: 2 }, { start: 1, end: 3 }, { start: 2, end: 4 }]);
  // Raw anger is 1/65, 63/65, 0 in the first three layers.
  assert.deepEqual(events[0], event(0, 19, 3));
  assert.deepEqual(events[1], event(SEGMENTS, 25, 4));
  assert.deepEqual(events[2], event(2 * SEGMENTS, 18, 3));
  assert.deepEqual(events[3], event(3 * SEGMENTS, 12, 2));
});

test('each memory has positive overlap for 10, 64, 65, and 2000 entries', () => {
  for (const count of [1, 10, 64, 65, 2000]) {
    const memories = Array.from({ length: count }, (_, i) => memory({ ...zero(), anxiety: i % 6 }));
    const snapshot = structuredClone(memories);
    const plan = compileMemoryPrintPlan(memories, 'analyzed');
    assert.deepEqual(plan, compileMemoryPrintPlan(memories, 'analyzed'));
    assert.deepEqual(memories, snapshot);
    assert.equal(plan.events.length, LAYERS);
    assert.equal(plan.contributions.length, LAYERS);
    const seen = Array(count).fill(false);
    for (let layer = 0; layer < LAYERS; layer++) {
      const { start, end } = plan.contributions[layer];
      assert.equal(start, Math.floor(layer * count / LAYERS));
      assert.equal(end, Math.ceil((layer + 1) * count / LAYERS));
      assert.ok(start >= 0 && end <= count && end > start);
      for (let i = start; i < end; i++) {
        const overlap = Math.min((layer + 1) * count, (i + 1) * LAYERS) - Math.max(layer * count, i * LAYERS);
        assert.ok(overlap > 0);
        seen[i] = true;
      }
      const e = plan.events[layer];
      assert.equal(e.step, layer * SEGMENTS);
      assert.equal(e.sag, true);
      assert.ok(Number.isInteger(e.fluctuation) && e.fluctuation >= 0 && e.fluctuation <= 100);
      assert.ok(Number.isInteger(e.interruption) && e.interruption >= 0 && e.interruption <= 100);
    }
    assert.ok(seen.every(Boolean));
  }
});
