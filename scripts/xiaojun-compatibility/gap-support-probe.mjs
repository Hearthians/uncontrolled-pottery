import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { generateGeometry } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/geometry.ts';
import { createGeometryManifest } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/serialization.ts';
import { scheduleFromHeightIntervals } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/failureSchedule.ts';
import { simulateGaps } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/gapsSimulation.ts';
import { compileTopography } from '../../src/memoryTopography.ts';

const artifacts = new URL('../../artifacts/xiaojun-compatibility/', import.meta.url);
const report = JSON.parse(await readFile(new URL('report.json', artifacts), 'utf8'));
const data = JSON.parse(await readFile(new URL('../../public/memory-topography.json', import.meta.url), 'utf8'));
const plan = compileTopography(data), source = await generateGeometry(report.recipe);
const schedule = scheduleFromHeightIntervals(createGeometryManifest(source), plan.bands.map(band => ({
  start: band.startLayer / 64, end: band.endLayer / 64, failureType: 'gaps', intensity: band.intensity,
})), 42);
const started = performance.now();
let result;
try {
  const simulation = await simulateGaps(source, schedule, 42);
  assert.ok(simulation.material.positions.every(Number.isFinite));
  const sum = key => simulation.support.layerAccounting.reduce((total, row) => total + row[key], 0);
  result = { ok: true, elapsedMs: Math.round(performance.now() - started),
    geometryId: source.geometryId, simulationId: simulation.simulationId,
    targetedLayers: simulation.targetedLayerCount, gapMetrics: simulation.gaps.metrics,
    supportMetrics: simulation.support.metrics,
    materialVertices: simulation.material.positions.length / 3,
    supportRemovedMm: sum('supportRemovedMm'), renderOmittedMm: sum('renderOmittedMm'),
    limitations: 'Nominal closed-layer path and upstream display cross-section; no continuous-helix or ellipse adapter applied.' };
} catch (error) {
  result = { ok: false, elapsedMs: Math.round(performance.now() - started), error: error.message };
}
await writeFile(new URL('gap-support-report.json', artifacts), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
