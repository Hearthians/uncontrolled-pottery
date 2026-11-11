import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { projectPca1, cluster1d, cosineSummary } from '../scripts/lib/memory-projection.mjs';
import { compileRegionLayers, decodeRegionPosition, regionPottery, validateRegionStudy, REGION_EXPERIMENT } from '../src/memoryRegions.ts';
import { SEGMENTS, TOTAL_STEPS } from '../src/simulation.ts';
import { RUNOUT_STEPS } from '../src/materialSimulation.ts';

test('PCA recovers a known principal axis and is invariant to embedding magnitude', () => {
  const rows = [[1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const result = projectPca1(rows);
  assert.ok(Math.abs(result.explainedVariance - 2 / 3) < 1e-10);
  assert.ok(Math.abs(result.loading[0] - 1) < 1e-9);
  assert.ok(result.residual < 1e-8);
  assert.ok(Math.abs(result.scores[0] - 1) < 1e-9);
  assert.ok(Math.abs(result.scores[1] + 1) < 1e-9);
  assert.deepEqual(result, projectPca1(rows.map(row => row.map(v => v * 3))));
  assert.deepEqual(rows, [[1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);
});

test('degenerate data does not fabricate separate clusters', () => {
  const result = projectPca1([[1, 2], [1, 2], [1, 2]]);
  assert.equal(result.explainedVariance, 0);
  assert.deepEqual(result.scores, [0, 0, 0]);
  assert.equal(cluster1d(result.scores, 4).regions.length, 1);
  assert.throws(() => projectPca1([[0, 0], [1, 0]]));
  assert.throws(() => projectPca1([[1, NaN], [1, 0]]));
});

test('1D clustering finds the known optimum, preserves original indices, and keeps duplicates together', () => {
  const result = cluster1d([10, -10, 9, -9], 2);
  assert.equal(result.sumSquaredError, 1);
  assert.deepEqual(result.regions.map(r => r.indices), [[1, 3], [0, 2]]);
  assert.deepEqual(result.regions.map(r => r.center), [-9.5, 9.5]);
  const duplicates = cluster1d([0, 0, 1, 1, 1], 4);
  assert.equal(duplicates.regions.length, 2);
  assert.deepEqual(duplicates.regions.map(r => r.indices), [[0, 1], [2, 3, 4]]);
  assert.equal(duplicates.sumSquaredError, 0);
  assert.throws(() => cluster1d([0, NaN], 2));
});

test('pairwise cosine statistic agrees with independent pair enumeration', () => {
  const rows = [[1, 0], [0, 1], [1, 1], [-1, 0]];
  let sum = 0, count = 0;
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    sum += rows[i].reduce((dot, x, d) => dot + x * rows[j][d], 0) / Math.hypot(...rows[i]) / Math.hypot(...rows[j]);
    count++;
  }
  assert.ok(Math.abs(cosineSummary(rows, [0, 1, 2, 3]).meanPairwiseCosine - sum / count) < 1e-12);
});

test('all memories receive equal height coverage, with a separate identical foundation', () => {
  const bodySteps = TOTAL_STEPS - RUNOUT_STEPS - REGION_EXPERIMENT.foundationLayers * SEGMENTS;
  for (const count of [1, 7, 62, 65, 601, 1910]) {
    const positions = Array.from({ length: count }, (_, i) => i / Math.max(1, count - 1));
    const layers = compileRegionLayers(positions.map((_, i) => i), positions);
    const weights = new Float64Array(count);
    for (const layer of layers) {
      if (layer.layer < 2) { assert.equal(layer.position, null); assert.equal(layer.interruption, 0); continue; }
      assert.ok(Math.abs(layer.contributions.reduce((sum, p) => sum + p.weight, 0) - 1) < 1e-12);
      for (const part of layer.contributions) weights[part.memoryIndex] += part.weight * layer.activeSteps;
    }
    for (const weight of weights) assert.ok(Math.abs(weight - bodySteps / count) < 1e-9);
  }
});

test('decoder has one global scale and preserves group differences without changing the base or seed', () => {
  const low = compileRegionLayers([0, 1], [0.2, 0.2]);
  const high = compileRegionLayers([0, 1], [0.8, 0.8]);
  assert.ok(low.slice(2).every(layer => Math.abs(layer.position - 0.2) < 1e-12 && layer.interruption === 4));
  assert.ok(high.slice(2).every(layer => Math.abs(layer.position - 0.8) < 1e-12 && layer.interruption === 58));
  const a = regionPottery('low', low), b = regionPottery('high', high), control = regionPottery('control');
  assert.equal(a.seed, b.seed);
  assert.equal(a.seed, control.seed);
  assert.deepEqual(a.simulation, b.simulation);
  assert.equal(a.steps, b.steps);
  assert.ok([...a.events, ...b.events].every(event => event.fluctuation === 0));
  assert.equal(control.events[0].interruption, 0);
  assert.throws(() => decodeRegionPosition(NaN));
  assert.throws(() => decodeRegionPosition(1.01));
  assert.throws(() => compileRegionLayers([0, 0], [0.2]));
});

test('generated artifact is bound to the public corpus and partitions every memory exactly once', async () => {
  const corpus = await readFile(new URL('../public/memories.json', import.meta.url));
  const artifact = JSON.parse(await readFile(new URL('../public/memory-regions.json', import.meta.url), 'utf8'));
  const count = JSON.parse(corpus.toString('utf8')).length;
  const data = validateRegionStudy(artifact, count);
  assert.equal(data.corpusSha256, createHash('sha256').update(corpus).digest('hex'));
  assert.equal(data.embedding.dimensions, 3072);
  assert.equal(data.regions.reduce((sum, region) => sum + region.indices.length, 0), count);
  const tampered = structuredClone(data);
  tampered.regions[0].indices.push(tampered.regions[1].indices[0]);
  assert.throws(() => validateRegionStudy(tampered, count));
  const missing = structuredClone(data);
  missing.regions[0].indices.pop();
  assert.throws(() => validateRegionStudy(missing, count));
  assert.throws(() => validateRegionStudy(data, count + 1));
});
