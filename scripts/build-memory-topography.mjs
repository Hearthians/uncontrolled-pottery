import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { clusterEmbeddings, orderCentroids } from './lib/memory-clustering.mjs';
import { cosineSummary } from './lib/memory-projection.mjs';

const root = resolve(import.meta.dirname, '..');
const corpus = await readFile(resolve(root, 'public/memories.json'));
const texts = JSON.parse(corpus.toString('utf8'));
const input = JSON.parse(execFileSync('unzip', ['-p', resolve(root, 'embeddings_lab_updated.zip'),
  'embeddings_lab_updated/embeddings_lab/output_1.json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
if (input.length !== texts.length || !input.every((row, index) => row.activity.trim() === texts[index]))
  throw new Error('Embeddings and public texts do not match');
const embeddings = input.map(row => row.embeddings);
const clusters = clusterEmbeddings(embeddings, 4, { onProgress: result => console.error(JSON.stringify(result)) });
const ordering = orderCentroids(clusters.groups.map(group => group.center));
const regions = ordering.order.map((index, order) => {
  const group = clusters.groups[index];
  const summary = cosineSummary(embeddings, group.indices);
  return { id: `region-${order + 1}`, indices: group.indices,
    share: group.indices.length / texts.length, meanPairwiseCosine: summary.meanPairwiseCosine,
    diversity: Math.max(0, 1 - summary.meanPairwiseCosine), representatives: summary.representatives };
});
const data = {
  version: 2, corpusSha256: createHash('sha256').update(corpus).digest('hex'), count: texts.length,
  embedding: { source: 'supplied-archive', model: 'text-embedding-3-large', dimensions: clusters.dimensions },
  clustering: { method: 'spherical-kmeans', dimensions: clusters.dimensions, requestedK: 4,
    seed: clusters.seed, restarts: clusters.restarts, selectedRestart: clusters.restart,
    iterations: clusters.iterations, objective: clusters.objective },
  ordering: { method: 'shortest-centroid-cosine-path', totalDistance: ordering.totalDistance,
    neighborDistances: ordering.neighborDistances, direction: 'original-index-tie-break' },
  diversityMetric: 'mean-pairwise-cosine-distance',
  baselineMeanCosine: cosineSummary(embeddings, texts.map((_, i) => i)).meanPairwiseCosine,
  regions,
};
await writeFile(resolve(root, 'public/memory-topography.json'), `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify({ count: data.count, clustering: data.clustering, ordering: data.ordering,
  regions: regions.map(region => ({ id: region.id, count: region.indices.length, share: region.share,
    diversity: region.diversity, examples: region.representatives.map(i => texts[i]) })) }, null, 2));
