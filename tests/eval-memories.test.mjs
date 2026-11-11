import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sampleIndices, makeFrozen, evaluate, compare, runChunk, SOURCE } from '../scripts/eval-memories.ts';
import { REVIEWS } from '../scripts/eval-memories-rubric.ts';

const zero = () => ({ calm: 0, anxiety: 0, anger: 0, stress: 0, sadness: 0 });
const corpusRaw = await readFile(SOURCE, 'utf8');
const frozen = makeFrozen(corpusRaw);

test('stratification is deterministic, unique and includes 40 blind reviews', () => {
  const texts = JSON.parse(corpusRaw), indices = sampleIndices(texts);
  assert.equal(indices.length, 200);
  assert.equal(new Set(indices).size, 200);
  assert.deepEqual(sampleIndices(texts), indices);
  assert.ok(REVIEWS.every(x => indices.includes(x.index)));
  assert.ok(indices.some(i => /[㐀-鿿]/u.test(texts[i])));
  assert.equal(frozen.annotationStatus, 'independent-ai-draft-not-human-reviewed');
});

test('provisional scoring counts all independent dimensions and false positives', () => {
  const results = frozen.sample.map(x => ({ index: x.index, scores: zero() }));
  results.find(x => x.index === 1412).scores.anger = 3;
  const report = evaluate(frozen.sample, REVIEWS, results);
  assert.equal(report.valid, 200);
  assert.equal(report.assessed, 200);
  assert.equal(report.seriousFalsePositives, 1);
  assert.equal(report.perScale.anger.seriousFalsePositives, 1);
  const comparison = compare(frozen.sample, REVIEWS, results, results);
  assert.equal(comparison.withinFivePoints, true);
  assert.equal(comparison.selected, null);
  assert.throws(() => evaluate(frozen.sample, REVIEWS, [...results, results[0]]));
  assert.throws(() => evaluate(frozen.sample, REVIEWS, [{ index: results[0].index, scores: { ...zero(), stress: 6 } }]));
});

test('partial reviews cannot establish comparable acceptance', () => {
  const result = [{ index: frozen.sample[0].index, scores: zero() }];
  const comparison = compare(frozen.sample, REVIEWS, result, result);
  assert.equal(comparison.comparable, false);
  assert.equal(comparison.withinFivePoints, false);
});

test('chunk rejects duplicate, missing and malformed scores and bounds time', async () => {
  const items = [{ index: 1, text: 'synthetic' }, { index: 2, text: 'synthetic' }];
  const good = async () => ({ model: 'synthetic', usage: null, results: items.map(({ index }) => ({ index, scores: zero() })) });
  assert.equal((await runChunk(items, good)).response.results.length, 2);
  await assert.rejects(runChunk(items, async () => ({ model: 'synthetic', usage: null, results: [{ index: 1, scores: zero() }] })));
  await assert.rejects(runChunk(items, () => new Promise(() => {}), 10), /timeout/i);
});
