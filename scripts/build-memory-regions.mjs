import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { projectPca1, cluster1d, cosineSummary } from './lib/memory-projection.mjs';

const root = resolve(import.meta.dirname, '..');
const corpus = await readFile(resolve(root, 'public/memories.json'));
const texts = JSON.parse(corpus.toString('utf8'));
// Read only this entry; never extract the archive's names, credentials or environment.
const input = JSON.parse(execFileSync('unzip', ['-p', resolve(root, 'embeddings_lab_updated.zip'),
  'embeddings_lab_updated/embeddings_lab/output_1.json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
if (input.length !== texts.length || !input.every((row, index) => row.activity.trim() === texts[index]))
  throw new Error('The supplied embeddings do not match the public corpus in order');
const embeddings = input.map(row => row.embeddings);
const projection = projectPca1(embeddings);
const low = Math.min(...projection.scores), high = Math.max(...projection.scores);
const positions = projection.scores.map(value => high > low ? (value - low) / (high - low) : 0.5);
const clusters = cluster1d(positions, 4);
const baseline = cosineSummary(embeddings, positions.map((_, index) => index));
const study = {
  version: 1, corpusSha256: createHash('sha256').update(corpus).digest('hex'), count: texts.length,
  embedding: { source: 'supplied-archive', model: 'text-embedding-3-large', dimensions: projection.dimensions },
  projection: { method: 'pca-1d', normalization: 'l2', orientation: 'largest-loading-positive',
    explainedVariance: projection.explainedVariance, iterations: projection.iterations, residual: projection.residual,
    rawRange: [low, high] },
  clustering: { method: 'optimal-1d-kmeans', requestedK: 4, sumSquaredError: clusters.sumSquaredError },
  baselineMeanCosine: baseline.meanPairwiseCosine,
  positions,
  regions: clusters.regions.map((region, index) => ({
    id: `region-${index + 1}`, indices: region.indices, center: region.center, min: region.min, max: region.max,
    ...cosineSummary(embeddings, region.indices),
  })),
};
await writeFile(resolve(root, 'public/memory-regions.json'), `${JSON.stringify(study, null, 2)}\n`);
console.log(JSON.stringify({ count: study.count, dimensions: projection.dimensions,
  explainedVariance: projection.explainedVariance, iterations: projection.iterations,
  residual: projection.residual, baselineMeanCosine: study.baselineMeanCosine,
  regions: study.regions.map(({ id, indices, center, min, max, meanPairwiseCosine, representatives }) =>
    ({ id, count: indices.length, center, min, max, meanPairwiseCosine,
      examples: representatives.map(index => ({ index, text: texts[index] })) })),
}, null, 2));
