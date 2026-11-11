import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { clusterEmbeddings, orderCentroids } from '../scripts/lib/memory-clustering.mjs';
import { allocateLayers, compileTopography, validateTopography, TOPOGRAPHY } from '../src/memoryTopography.ts';
import { generateTopographyForm, topographyBuffers, relaxTopographySupport, sampleTopographyPath } from '../src/topographyForm.ts';

const data = JSON.parse(await readFile(new URL('../public/memory-topography.json', import.meta.url), 'utf8'));

test('full-vector clustering separates known directions regardless of vector length or row order', () => {
  const rows = [[10, 0, 0], [0.99, 0.01, 0], [-3, 0, 0], [-0.99, 0.01, 0]];
  const result = clusterEmbeddings(rows, 2, { restarts: 3 });
  assert.deepEqual(result.groups.map(group => group.indices), [[0, 1], [2, 3]]);
  assert.deepEqual(result, clusterEmbeddings(rows, 2, { restarts: 3 }));
  const reordered = clusterEmbeddings([rows[0], rows[2], rows[1], rows[3]], 2, { restarts: 3 });
  assert.deepEqual(reordered.groups.map(group => group.indices), [[0, 2], [1, 3]]);
  assert.equal(clusterEmbeddings([[1, 0], [1, 0], [1, 0]], 3).groups.length, 1);
  assert.throws(() => clusterEmbeddings([[0, 0], [1, 0]], 2));
});

test('centroid ordering minimizes an open cosine-distance path and fixes reverse ambiguity', () => {
  const angles = [0, Math.PI / 2, Math.PI / 6, Math.PI / 3];
  const result = orderCentroids(angles.map(angle => [Math.cos(angle), Math.sin(angle)]));
  assert.deepEqual(result.order, [0, 2, 3, 1]);
  assert.ok(Math.abs(result.totalDistance - 3 * (1 - Math.cos(Math.PI / 6))) < 1e-12);
});

test('memory count controls an exact 60-layer apportionment with <1 layer rounding error', () => {
  assert.deepEqual(allocateLayers([391, 505, 601, 413], 60), [12, 16, 19, 13]);
  assert.deepEqual(allocateLayers([480, 536, 456, 438], 60), [15, 17, 14, 14]);
  const plan = compileTopography(data);
  assert.equal(plan.bands.reduce((sum, band) => sum + band.layers, 0), 60);
  assert.equal(plan.bands.reduce((sum, band) => sum + band.indices.length, 0), 1910);
  assert.equal(plan.bands[0].startLayer, 2);
  assert.equal(plan.bands.at(-1).endLayer, 62);
  for (const [i, band] of plan.bands.entries()) {
    assert.ok(Math.abs(band.layers - band.share * 60) < 1);
    if (i) assert.equal(band.startLayer, plan.bands[i - 1].endLayer);
  }
  assert.throws(() => allocateLayers([1, 10000], 60), /resolution/);
});

test('diversity, not height or ID, determines the common deformation scale', () => {
  const original = compileTopography(data);
  const flippedData = { ...data, regions: [...data.regions].reverse() };
  const reversed = compileTopography(flippedData);
  for (const band of original.bands) {
    const other = reversed.bands.find(item => item.id === band.id);
    assert.equal(band.intensity, other.intensity);
    assert.equal(band.maxDropMm, other.maxDropMm);
  }
  const byDiversity = [...original.bands].sort((a, b) => a.diversity - b.diversity);
  assert.equal(byDiversity[0].intensity, 0);
  for (let i = 1; i < byDiversity.length; i++) assert.ok(byDiversity[i].intensity >= byDiversity[i - 1].intensity);
  const equal = structuredClone(data);
  equal.regions.forEach(region => { region.diversity = 0.75; region.meanPairwiseCosine = 0.25; });
  assert.ok(compileTopography(equal).bands.every(band => band.intensity === 0));
});

test('artifact is corpus-bound, covers every memory once, and validates derived statistics', async () => {
  const corpus = await readFile(new URL('../public/memories.json', import.meta.url));
  validateTopography(data, 1910);
  assert.equal(data.corpusSha256, createHash('sha256').update(corpus).digest('hex'));
  assert.equal(data.clustering.dimensions, 3072);
  for (const field of ['diversity', 'share']) {
    const bad = structuredClone(data); bad.regions[0][field] += 0.1;
    assert.throws(() => validateTopography(bad, 1910));
  }
  const duplicate = structuredClone(data);
  duplicate.regions[1].indices.push(duplicate.regions[0].indices[0]);
  assert.throws(() => validateTopography(duplicate, 1910));
});

test('a yielded span follows missing or displaced supports and behaves the same after rotating the helix', () => {
  const count = 128, pitch = (TOPOGRAPHY.heightMm - 5.1) / TOPOGRAPHY.totalLayers;
  const band = { startLayer: 2, endLayer: 11, intensity: 1, maxDropMm: 12 };
  const makeLayers = (rotation, mode) => {
    const points = Array.from({ length: 12 * count + 1 }, (_, index) => {
      const path = index / count, theta = path * Math.PI * 2, layer = Math.min(11, Math.floor(path));
      const nearFailure = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) < 0.55;
      const radius = mode === 'offset' && layer === 4 && nearFailure ? 52 : 40;
      const sourceX = Math.cos(theta + rotation) * 40, sourceZ = -Math.sin(theta + rotation) * 40;
      const sourceY = 2.55 + path * pitch;
      return { x: Math.cos(theta + rotation) * radius, z: -Math.sin(theta + rotation) * radius, y: sourceY,
        sourceX, sourceY, sourceZ, sourceWidth: 3.4, sourceHeight: 2.55,
        width: 3.4 / 0.83, height: 2.55 * 0.83, theta, layer, path, dropMm: 0,
        gap: mode === 'gap' && (layer === 3 || layer === 4) && nearFailure };
    });
    return Array.from({ length: 12 }, (_, turn) => points.slice(turn * count, (turn + 1) * count + 1));
  };
  const stable = makeLayers(0, 'stable');
  relaxTopographySupport(stable, [band]);
  assert.ok(stable.flat().every(point => point.dropMm === 0), 'sub-yield loads do not deform a supported cylinder');
  const front = makeLayers(0, 'gap'), back = makeLayers(Math.PI, 'gap');
  relaxTopographySupport(front, [band]); relaxTopographySupport(back, [band]);
  assert.ok(Math.max(...front[5].map(point => point.dropMm)) > 5, 'the first strand across a two-turn opening must yield');
  assert.ok(front[6][0].dropMm > 2 && front[7][0].dropMm > 1, 'settling continues through higher strands');
  assert.ok(front[5][count / 4].dropMm < 0.01, 'supported portions remain anchored');
  for (let turn = 0; turn < front.length; turn++) for (let i = 0; i <= count; i++)
    assert.ok(Math.abs(front[turn][i].dropMm - back[turn][i].dropMm) < 1e-9,
      'rotating the support failure must rotate the same response');
  const offset = makeLayers(0, 'offset'); relaxTopographySupport(offset, [band]);
  assert.ok(offset[5][0].dropMm > 1, 'lateral support displacement also triggers settling');
  assert.ok(front[10].every(point => point.dropMm < 3), 'the response recovers gradually at the next band');
});

test('the restored vessel has one continuous nozzle path, strong folds and plump strand sections', async () => {
  const plan = compileTopography(data), form = await generateTopographyForm(plan);
  assert.equal(form.layers.length, 64);
  assert.ok(form.metrics.maxDropMm > 25 && form.metrics.maxDropMm <= TOPOGRAPHY.maxDropMm);
  assert.ok(form.metrics.maxRadiusMm < 100);
  assert.equal(form.metrics.geometryId, 'gof-geometry-1.1.1-8aac8a0dec35a42ae42bf5523cebbb3666749d5310ff16a81b911040ecf80a0c',
    'the canonical outline is the previously approved bulbous, tapered and folded vessel');
  assert.equal(form.baseRadius, Math.min(...form.layers[0].map(point => Math.hypot(point.sourceX, point.sourceZ))));
  const strongest = plan.bands.reduce((a, b) => a.diversity > b.diversity ? a : b);
  assert.equal(form.metrics.bands.reduce((a, b) => a.maxDropMm > b.maxDropMm ? a : b).id, strongest.id);
  const points = [...form.layers.flatMap(layer => layer.slice(0, -1)), form.layers.at(-1).at(-1)];
  let frontDrops = 0, rearDrops = 0, gapRuns = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    assert.ok(p.height / p.width >= 0.84 - 1e-10 && p.height / p.width <= 0.88 + 1e-10,
      'even sharply bent strands retain a plump elliptical section');
    assert.ok(2 * Math.min(p.width, p.height) > 5.5, 'stress cannot shrink a strand into a thin strip');
    const areaScale = p.width * p.height / (p.sourceWidth * p.sourceHeight);
    assert.ok(areaScale >= 0.90 - 1e-10 && areaScale <= 1.08 + 1e-10, 'cross-section scale changes remain small');
    assert.ok(Math.abs(p.y + p.dropMm - p.sourceY) < 1e-10);
    if (!p.gap && p.dropMm > 1) { if (p.z < 0) rearDrops++; else frontDrops++; }
    if (p.gap && !points[i - 1]?.gap) gapRuns++;
    if (i) {
      const q = points[i - 1];
      assert.ok(p.path > q.path && p.sourceY > q.sourceY, 'deposition age and height never reset at a turn');
      assert.ok(Math.hypot(p.sourceX - q.sourceX, p.sourceY - q.sourceY, p.sourceZ - q.sourceZ) < 2);
    }
    const below = points[i - (form.layers[0].length - 1)];
    if (below) assert.ok(p.gap || below.gap || p.dropMm >= 0.2 || below.dropMm <= 2 || p.y - below.y <= 6,
      'a horizontal unsupported roof must not reappear as a deformed band returns to its boundary');
    if (!p.gap && i > 0 && i < points.length - 1) {
      const before = !points[i - 1].gap ? points[i - 1] : p, after = !points[i + 1].gap ? points[i + 1] : p;
      const initialLength = Math.hypot(after.sourceX - before.sourceX, after.sourceY - before.sourceY, after.sourceZ - before.sourceZ);
      const finalLength = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
      const ratio = initialLength / finalLength;
      if (ratio >= 0.90 && ratio <= 1.08)
        assert.ok(Math.abs(p.width * p.height * finalLength - p.sourceWidth * p.sourceHeight * initialLength) < 1e-8,
          'cross-section flattening compensates for the changed local path length');
    }
  }
  assert.ok(frontDrops > 50 && rearDrops > 50);
  assert.ok(gapRuns > 0 && gapRuns < 32, 'only memory-defined interruptions break deposition, not every turn');
  assert.ok(points.filter(point => point.gap).length / points.length < 0.1, 'most of the material is continuous');
  for (let turn = 0; turn < 63; turn++) {
    assert.strictEqual(form.layers[turn].at(-1), form.layers[turn + 1][0], 'turns share the same boundary point');
    const before = sampleTopographyPath(form, turn + 1 - 1e-6), after = sampleTopographyPath(form, turn + 1 + 1e-6);
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) < 0.002, 'the nozzle never jumps between turns');
  }
  for (const band of plan.bands) {
    const local = points.filter(point => point.path >= band.startLayer && point.path < band.endLayer && !point.gap);
    const low = sampleTopographyPath(form, band.startLayer).y, high = sampleTopographyPath(form, band.endLayer).y;
    assert.ok(local.every(point => point.y >= low - 1e-10 && point.y < high));
    if (band.intensity === 0) assert.ok(local.every(point => point.dropMm === 0));
  }
  for (const turn of [0, 1, 62, 63]) assert.ok(form.layers[turn].every(point => !point.gap && point.dropMm === 0));
  assert.deepEqual(await generateTopographyForm(compileTopography(data)), form);
  const neutral = await generateTopographyForm({ ...plan, bands: plan.bands.map(band => ({ ...band, intensity: 0, maxDropMm: 0 })) });
  assert.equal(neutral.metrics.geometryId, form.metrics.geometryId, 'memory never changes the canonical vessel');
  assert.equal(neutral.metrics.maxDropMm, 0);
  for (const path of [-3, 0, 0.5, 17, 33.7, 63.999, 64, 70]) {
    const sample = sampleTopographyPath(form, path), other = sampleTopographyPath(neutral, path);
    for (const key of ['x', 'y', 'z', 'width', 'height', 'path']) assert.equal(sample[key], other[key]);
    assert.equal(sample.path, Math.max(0, Math.min(64, path)));
  }
  assert.throws(() => sampleTopographyPath(form, NaN));
});

test('ellipse-frame animation retains full section thickness at every intermediate settling stage', async () => {
  const form = await generateTopographyForm(compileTopography(data)), b = topographyBuffers(form);
  const vertices = b.positions.length / 3;
  assert.equal(b.initialCenters.length, vertices * 3);
  assert.equal(b.finalCenters.length, vertices * 3);
  assert.equal(b.sectionFrames.length, vertices * 4);
  assert.equal(b.sectionSizes.length, vertices * 4);
  assert.equal(b.sectionUv.length, vertices * 3);
  for (const field of ['initialCenters', 'finalCenters', 'sectionFrames', 'sectionSizes', 'sectionUv'])
    assert.ok(b[field].every(Number.isFinite));
  let extremeBends = 0;
  for (let vertex = 0; vertex < vertices; vertex++) {
    const f = vertex * 4, p = vertex * 3;
    const h0 = b.sectionFrames[f], pitch0 = b.sectionFrames[f + 1], h1 = b.sectionFrames[f + 2], pitch1 = b.sectionFrames[f + 3];
    const delta = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0));
    if (Math.abs(pitch1 - pitch0) > 0.65) extremeBends++;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      // This is the renderer's frame contract, checked against section geometry
      // and the independently generated initial/final vertex buffers.
      const h = h0 + delta * t, pitch = pitch0 + (pitch1 - pitch0) * t;
      const w = b.sectionSizes[f] * (1 - t) + b.sectionSizes[f + 2] * t;
      const height = b.sectionSizes[f + 1] * (1 - t) + b.sectionSizes[f + 3] * t;
      assert.ok(Math.min(w, height) / Math.max(w, height) >= 0.65, 'a rotating intermediate section must stay a full ellipse');
      assert.ok(Math.min(w, height) * 2 > 5.5, 'intermediate bending cannot collapse the diameter');
      const r = [Math.cos(h), 0, Math.sin(h)];
      const u = [-Math.sin(pitch) * Math.sin(h), Math.cos(pitch), Math.sin(pitch) * Math.cos(h)];
      const ca = b.sectionUv[p], sa = b.sectionUv[p + 1], cap = b.sectionUv[p + 2];
      const offset = r.map((value, axis) => value * ca * w + u[axis] * sa * height);
      if (!cap) {
        const alongR = offset.reduce((sum, value, axis) => sum + value * r[axis], 0);
        const alongU = offset.reduce((sum, value, axis) => sum + value * u[axis], 0);
        assert.ok(Math.abs((alongR / w) ** 2 + (alongU / height) ** 2 - 1) < 1e-6, 'the intermediate boundary is elliptical');
      }
      if (t === 0 || t === 1) for (let axis = 0; axis < 3; axis++) {
        const center = t ? b.finalCenters[p + axis] : b.initialCenters[p + axis];
        const position = t ? b.positions[p + axis] : b.initialPositions[p + axis];
        assert.ok(Math.abs(position - center - offset[axis]) < 4e-5, 'frame interpolation reaches the exact generated end shapes');
      }
    }
  }
  assert.ok(extremeBends > 100, 'the thickness check includes strongly tilted portions of hanging clay');
});

test('tube topology crosses turn boundaries and fresh-to-settled buffers reveal only deposited material', async () => {
  const plan = compileTopography(data), form = await generateTopographyForm(plan), buffers = topographyBuffers(form);
  const vertices = buffers.positions.length / 3;
  for (const field of ['positions', 'normals', 'initialPositions', 'initialNormals', 'depositedAt', 'liftOffset'])
    assert.ok(buffers[field].every(Number.isFinite), field);
  assert.equal(buffers.initialPositions.length, buffers.positions.length);
  assert.equal(buffers.initialNormals.length, buffers.normals.length);
  assert.equal(buffers.depositedAt.length, vertices);
  assert.equal(buffers.liftOffset.length, vertices);
  assert.ok(buffers.indices.every(index => index < vertices));
  assert.ok(buffers.depositedAt.every(value => value >= 0 && value <= 64));
  assert.ok(buffers.depositedAt.some(value => value === 64), 'the final point is deposited at the end of the path');
  for (const normal of [buffers.normals, buffers.initialNormals]) for (let i = 0; i < normal.length; i += 3)
    assert.ok(Math.abs(Math.hypot(normal[i], normal[i + 1], normal[i + 2]) - 1) < 1e-6);
  assert.deepEqual(buffers.reveal[0], { path: 0, indexCount: 0 });
  assert.deepEqual(buffers.reveal.at(-1), { path: 64, indexCount: buffers.indices.length });
  let previousPath = 0, previousCount = 0;
  for (const step of buffers.reveal) {
    assert.ok(step.path >= previousPath && step.indexCount >= previousCount);
    assert.equal(step.indexCount % 3, 0);
    for (let i = previousCount; i < step.indexCount; i++)
      assert.ok(buffers.depositedAt[buffers.indices[i]] <= step.path + 1e-5);
    previousPath = step.path; previousCount = step.indexCount;
  }
  const points = [...form.layers.flatMap(layer => layer.slice(0, -1)), form.layers.at(-1).at(-1)];
  let runs = 0;
  for (let i = 0; i < points.length; i++) if (!points[i].gap && (i === 0 || points[i - 1].gap)) runs++;
  const components = new Int32Array(vertices);
  for (let i = 0; i < vertices; i++) components[i] = i;
  const root = value => { while (components[value] !== value) { components[value] = components[components[value]]; value = components[value]; } return value; };
  for (let i = 0; i < buffers.indices.length; i += 3) {
    const a = root(buffers.indices[i]), b = root(buffers.indices[i + 1]), c = root(buffers.indices[i + 2]);
    components[b] = a; components[c] = a;
  }
  assert.equal(new Set(Array.from(buffers.indices, root)).size, runs,
    'the number of connected meshes equals actual uninterrupted extrusion runs, not the number of layers');
  let vertex = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    for (let side = 0; side < 12; side++) {
      assert.ok(Math.abs(buffers.depositedAt[vertex + side] - p.path) < 1e-5);
      assert.ok(Math.abs(buffers.liftOffset[vertex + side] - p.dropMm) < 1e-5);
    }
    vertex += 12;
    if (!p.gap) for (const start of [true, false]) {
      if (!(start ? i === 0 || points[i - 1].gap : i === points.length - 1 || points[i + 1].gap)) continue;
      const before = i > 0 && !points[i - 1].gap ? points[i - 1] : p;
      const after = i + 1 < points.length && !points[i + 1].gap ? points[i + 1] : p;
      const sign = start ? -1 : 1;
      for (const fresh of [false, true]) {
        const normal = fresh ? buffers.initialNormals : buffers.normals;
        const dx = fresh ? after.sourceX - before.sourceX : after.x - before.x;
        const dy = fresh ? after.sourceY - before.sourceY : after.y - before.y;
        const dz = fresh ? after.sourceZ - before.sourceZ : after.z - before.z;
        const length = Math.hypot(dx, dy, dz);
        if (length > 1e-12) assert.ok(Math.abs(sign * (normal[vertex * 3] * dx + normal[vertex * 3 + 1] * dy + normal[vertex * 3 + 2] * dz) / length - 1) < 1e-6,
          'a cap faces along its deposited run, without using missing material for its tangent');
      }
      vertex++;
    }
  }
  assert.equal(vertex, vertices, 'caps occur only at true gaps and the global path ends');
});
