import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { generateGeometry as oldGenerate } from '../../xiaojun-version/GrammarofFailure_PrototypeB_v1/src/geometry.ts';
import { generateGeometry, geometryToToolpath } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/geometry.ts';
import { createGeometryManifest } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/serialization.ts';
import { scheduleFromHeightIntervals } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/failureSchedule.ts';
import { applyGaps } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/gaps.ts';
import { simulateBulges } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/bulges.ts';
import { simulateOffsets } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/offsets.ts';
import { simulateSagging } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/sagging.ts';
import { writeBead, SIDES, FLOATS_PER_MOVE } from '../../xiaojun-version/handoff-20261111/Prototype-B-Handoff/src/claySurface.ts';
import { compileTopography, TOPOGRAPHY } from '../../src/memoryTopography.ts';
import { generateTopographyForm } from '../../src/topographyForm.ts';

const root = new URL('../../', import.meta.url);
const artifacts = new URL('artifacts/xiaojun-compatibility/', root);
await mkdir(artifacts, { recursive: true });
const recipe = {
  geometry: { heightMm: 256, radiusMm: 48, baseProfile: 'bulbous', modifier: 'soft-organic-fold', seed: 42,
    parameters: { taper: -0.24, bulge: 0.32, foldAmplitude: 0.45, foldHeight: 0.58, foldSpread: 0.28 } },
  sampling: { layerHeightMm: 4 }, printing: { beadWidthMm: 6.8, feedrateMmMin: 1500 },
  validation: { safetyMarginMm: 5, maxLayerDisplacementMm: 1.4 },
};
const plan = compileTopography(JSON.parse(await readFile(new URL('public/memory-topography.json', root), 'utf8')));
const source = await oldGenerate(recipe), updated = await generateGeometry(recipe);
assert.deepEqual(updated, source, 'Same recipe must preserve the complete canonical result, not just its ID');
const snapshot = JSON.stringify(source);
const current = await generateTopographyForm(plan);
assert.equal(source.geometryId, current.metrics.geometryId);
const path = geometryToToolpath(source);
const schedule = scheduleFromHeightIntervals(createGeometryManifest(source), plan.bands.map(band => ({
  start: band.startLayer / 64, end: band.endLayer / 64, failureType: 'gaps', intensity: band.intensity,
})), 42);
const gaps = await applyGaps(source, schedule, 42);
for (const row of gaps.appliedIntensities) {
  const band = plan.bands.find(band => row.layerId >= band.startLayer && row.layerId < band.endLayer);
  assert.equal(row.intensity, band?.intensity ?? 0);
}
const combined = structuredClone(schedule);
combined.entries.push({ layerId: 2, failureType: 'sagging', intensity: 0.5 });
await assert.rejects(applyGaps(source, combined, 42), /composition is unsupported/);

// Measure the actual visible profile in its local radial/vertical plane.
const move = path.moves.find(move => move.kind === 'deposition');
const positions = new Float32Array(FLOATS_PER_MOVE), normals = new Float32Array(FLOATS_PER_MOVE);
writeBead(move, 1, positions, normals);
const radius = Math.hypot(move.start[0], move.start[1]);
const ring = Array.from({ length: SIDES }, (_, i) => ({
  r: (positions[i * 3] - move.start[0]) * -move.start[0] / radius
    + (positions[i * 3 + 1] - move.start[1]) * -move.start[1] / radius,
  z: positions[i * 3 + 2] - move.start[2],
}));
const halfWidth = Math.max(...ring.map(p => Math.abs(p.r))), halfHeight = Math.max(...ring.map(p => Math.abs(p.z)));
const ellipseResidual = Math.max(...ring.map(p => Math.abs((p.r / halfWidth) ** 2 + (p.z / halfHeight) ** 2 - 1)));
assert.ok(ellipseResidual > 0.1, 'The default upstream display profile is not an ellipse');
const report = {
  assessedAt: new Date().toISOString(), recipe, canonicalIdentical: true, geometryId: source.geometryId,
  currentDecoder: TOPOGRAPHY.decoder, count: plan.count,
  bands: plan.bands.map(band => ({ id: band.id, count: band.indices.length, turns: band.layers, intensity: band.intensity })),
  upstreamPath: { layers: path.contours.length, closedContours: path.contours.filter(c =>
    c.points[0].every((v, i) => v === c.points.at(-1)[i])).length,
    independentLayerTransitions: path.moves.filter(m => m.kind === 'transition').length,
    depositingTransitionCount: path.moves.filter(m => m.kind === 'transition' && m.extrude).length,
    nominalSeconds: path.durationS },
  upstreamVisibleSection: { sides: SIDES, halfWidthMm: halfWidth, halfHeightMm: halfHeight,
    heightWidthRatio: halfHeight / halfWidth, maximumEllipseEquationResidual: ellipseResidual },
  coordinateAdapter: '[X,Y,Z] Z-up -> [X,Z,-Y] Y-up; apply to positions, normals and nozzle together',
  gapSchedule: { regionIntensityMappingExact: true, metrics: gaps.metrics, mixedOperatorsRejected: true },
  operators: {},
};
for (const [name, run] of [
  ['bulges-global-0.7', () => simulateBulges(source, 0.7, 42)],
  ['offsets-combined-global-0.7', () => simulateOffsets(source, 'combined', 0.7, 42)],
  ['sagging-reactive-global-1', () => simulateSagging(source, 1, 42, 'reactive')],
  ['sagging-expressive-global-1', () => simulateSagging(source, 1, 42, 'expressive')],
]) {
  const start = performance.now();
  try {
    const result = await run();
    assert.equal(result.sourceGeometryId, source.geometryId);
    assert.ok(result.material.positions.every(Number.isFinite));
    assert.equal(JSON.stringify(source), snapshot, 'An operator mutated the canonical source');
    report.operators[name] = { ok: true, elapsedMs: Math.round(performance.now() - start),
      metrics: result.metrics, materialVertices: result.material.positions.length / 3,
      nominalCommandsRetained: result.path ? JSON.stringify(result.path.moves) === JSON.stringify(path.moves) : true,
      sourceUnchanged: true };
  } catch (error) {
    report.operators[name] = { ok: false, elapsedMs: Math.round(performance.now() - start), error: error.message };
  }
  console.log(name, JSON.stringify(report.operators[name]));
}
report.sourceHashes = {};
for (const name of ['src/topographyForm.ts', 'src/TopographyScene.tsx', 'src/memoryTopography.ts'])
  report.sourceHashes[name] = createHash('sha256').update(await readFile(new URL(name, root))).digest('hex');
await writeFile(new URL('report.json', artifacts), JSON.stringify(report, null, 2) + '\n');
console.log('Saved artifacts/xiaojun-compatibility/report.json');
