import { generateGeometry } from "../xiaojun-version/GrammarofFailure_PrototypeB_v1/src/geometry.ts";
import { TOPOGRAPHY, type TopographyPlan, type TopographyBand } from "./memoryTopography.ts";

export type FormPoint = {
  x: number; y: number; z: number; width: number; height: number; gap: boolean;
  theta: number; layer: number; path: number; dropMm: number;
  sourceX: number; sourceY: number; sourceZ: number; sourceWidth: number; sourceHeight: number;
};
export type FormMetrics = {
  geometryId: string; layerCount: number; pointCount: number;
  maxDropMm: number; maxRadiusMm: number; minY: number; maxY: number;
  bands: { id: string; missingSamples: number; samples: number; maxDropMm: number; intensity: number }[];
};
export type TopographyForm = { layers: FormPoint[][]; metrics: FormMetrics; baseRadius: number };

const TAU = Math.PI * 2;
const FRESH_HEIGHT = 3.1;
const PITCH = (TOPOGRAPHY.heightMm - FRESH_HEIGHT * 2) / TOPOGRAPHY.totalLayers;
const angleDistance = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const bell = (position: number) => Math.abs(position) < 1 ? (1 - position * position) ** 2 : 0;
const sourceHeight = (path: number) => FRESH_HEIGHT + path * PITCH;
const uniquePath = (layers: FormPoint[][]) => [...layers.flatMap(layer => layer.slice(0, -1)), layers.at(-1)!.at(-1)!];

/** Canonical vessel path with the original strong folds added after deposition. */
function extrudePoint(path: number, x: number, depth: number, band?: TopographyBand): FormPoint {
  const theta = path * TAU, y = sourceHeight(path), sourceWidth = TOPOGRAPHY.beadWidthMm / 2;
  const area = sourceWidth * FRESH_HEIGHT;
  const point: FormPoint = { x, y, z: -depth, width: Math.sqrt(area / 0.88), height: Math.sqrt(area * 0.88),
    sourceX: x, sourceY: y, sourceZ: -depth, sourceWidth, sourceHeight: FRESH_HEIGHT,
    gap: false, theta, path, layer: Math.min(TOPOGRAPHY.totalLayers - 1, Math.floor(path)), dropMm: 0 };
  if (!band || band.intensity < 1e-10) return point;
  const a = band.intensity, t = (path - band.startLayer) / band.layers;
  const envelope = Math.sin(Math.PI * t) ** 2;
  const phase = ((band.indices[0] * 0.61803398875 + TOPOGRAPHY.seed * 0.13) % 1) * TAU;
  point.x += 11 * a * envelope * Math.sin(t * Math.PI * 3 + phase);
  point.z += 5 * a * envelope * Math.sin(t * Math.PI * 2 + phase);
  let radial = 2.7 * a * envelope * Math.sin(theta * 4 + path * 0.27);
  const surface = 0.55 * Math.sin(theta * 13 + path * 1.37 + phase)
    + 0.3 * Math.sin(theta * 29 - path * 0.73) + 0.15 * Math.sin(theta * 47 + path * 1.83);
  radial += 0.45 * a * envelope * surface;
  const roof = band.startLayer + Math.round(band.layers * (0.43 + 0.015 * Math.sin(phase)));
  const gapDepth = 1 + Math.floor(a * 3), hangingLayers = 2 + Math.floor(a * 3);
  const features = [
    { center: -1.7 + phase * 0.32, roof, scale: 1 },
    { center: -2.5 + phase * 0.10, roof: band.startLayer + Math.round(band.layers * 0.30), scale: 0.47 },
    { center: -1.7 + phase * 0.32 + Math.PI, roof: roof + 1, scale: 0.78 },
  ];
  for (const feature of features) {
    const halfSpan = (0.36 + a * 0.38) * (feature.scale === 1 ? 1 : 0.85);
    const sway = 0.055 * a * Math.sin((path - feature.roof) * 1.1 + phase);
    const position = angleDistance(theta, feature.center + sway) / halfSpan;
    const angular = bell(position / (1 + 0.22 * Math.sin(phase) * Math.sign(position)));
    if (a > 0.18 && path >= feature.roof - gapDepth && path < feature.roof && angular > 0.11)
      point.gap = true;
    if (path >= feature.roof && path < feature.roof + hangingLayers && path < band.endLayer - 1) {
      const relative = (path - feature.roof) / hangingLayers;
      point.dropMm += band.maxDropMm * feature.scale * (1 - 0.57 * relative ** 0.72) * angular;
      radial += (9 + 13 * a) * a * angular * feature.scale * (1 - relative * 0.24);
    }
    const shoulder = Math.exp(-(((path - (feature.roof - gapDepth - 1)) / 1.6) ** 2)) * angular;
    radial += 9 * a * shoulder * feature.scale;
  }
  point.x += Math.cos(theta) * radial;
  point.z -= Math.sin(theta) * radial;
  point.y -= point.dropMm;
  return point;
}

/**
 * A yield threshold, local support and a viscous smoothing rule approximate wet
 * clay settling. This is geometric relaxation, not a calibrated rheology solver.
 */
export function relaxTopographySupport(layers: FormPoint[][], bands: readonly TopographyBand[]) {
  const points = uniquePath(layers), segments = layers[0].length - 1;
  for (let turn = 0; turn < layers.length; turn++) {
    const begin = turn * segments, end = Math.min(points.length, begin + segments);
    const target = new Float64Array(end - begin), cap = new Float64Array(end - begin);
    for (let index = begin; index < end; index++) {
      const p = points[index], band = bands.find(item => p.path >= item.startLayer && p.path < item.endLayer);
      if (!band || band.intensity < 1e-10 || p.gap) continue;
      const local = index - begin;
      // Return to the next band's undeformed turn without placing a horizontal
      // roof over a deeply settled previous turn. The last nonzero increment is
      // below the strands' contact allowance, continuously along the helix.
      const remaining = band.endLayer - 1 - p.path;
      const recoveryCap = remaining <= 1 ? 1.8 * Math.max(0, remaining) : 1.8 + 3.8 * (remaining - 1);
      cap[local] = Math.max(0, Math.min(band.maxDropMm, recoveryCap, p.sourceY - sourceHeight(band.startLayer)));
      let supportTop = -Infinity;
      const reach = Math.ceil((p.width + TOPOGRAPHY.beadWidthMm) / TOPOGRAPHY.radiusMm * segments / TAU) + 2;
      for (let below = 1; below <= 6; below++) {
        const center = index - below * segments;
        if (center + reach < 0) break;
        for (let offset = -reach; offset <= reach; offset++) {
          const lowerIndex = center + offset;
          if (lowerIndex < 0 || lowerIndex >= begin) continue;
          const q = points[lowerIndex];
          if (q.gap) continue;
          const distance = Math.hypot(p.x - q.x, p.z - q.z), footprint = p.width + q.width;
          if (distance >= footprint) continue;
          const top = q.y + q.height * Math.sqrt(1 - (distance / footprint) ** 2);
          if (top < p.sourceY + p.height && top > supportTop) supportTop = top;
        }
      }
      const unsupported = Number.isFinite(supportTop) ? Math.max(0, p.sourceY - p.height - supportTop) : cap[local];
      const lower = points[index - segments];
      const inherited = lower && !lower.gap ? lower.dropMm * 0.86 : 0;
      // A supported bead resists small loads; a larger unsupported span yields.
      const yielded = Math.max(0, unsupported - 0.65) * 0.96;
      target[local] = Math.min(cap[local], Math.max(p.dropMm, yielded, inherited));
    }
    let relaxed = target.slice();
    for (let iteration = 0; iteration < 24; iteration++) {
      const next = relaxed.slice();
      for (let local = 0; local < relaxed.length; local++) {
        const p = points[begin + local];
        if (p.gap || cap[local] === 0) continue;
        const left = local ? relaxed[local - 1] : points[begin - 1]?.dropMm ?? relaxed[local];
        const right = local + 1 < relaxed.length ? relaxed[local + 1] : relaxed[local];
        next[local] = Math.min(cap[local], Math.max(p.dropMm, (target[local] + 2.5 * (left + right)) / 6));
      }
      relaxed = next;
    }
    for (let local = 0; local < relaxed.length; local++) {
      const p = points[begin + local];
      if (!p.gap) { p.dropMm = relaxed[local]; p.y = p.sourceY - p.dropMm; }
    }
  }
  // Length-based area compensation is deliberately limited: a wet clay strand
  // must remain a plump ellipse even in a sharply bent portion. This bounded
  // visual approximation does not claim exact volume conservation under strain.
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // An omitted span has no material to stretch. At a true interruption use
    // the one-sided length of this deposited run, never a missing neighbor.
    const before = i > 0 && !points[i - 1].gap ? points[i - 1] : p;
    const after = i + 1 < points.length && !points[i + 1].gap ? points[i + 1] : p;
    const originalLength = Math.hypot(after.sourceX - before.sourceX, after.sourceY - before.sourceY, after.sourceZ - before.sourceZ);
    const finalLength = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    const ratio = p.gap || originalLength === 0 ? 1 : Math.max(0.90, Math.min(1.08, originalLength / (finalLength || 1)));
    const aspect = 0.88 - Math.min(0.04, p.dropMm * 0.002);
    const area = p.sourceWidth * p.sourceHeight * ratio;
    p.width = Math.sqrt(area / aspect);
    p.height = Math.sqrt(area * aspect);
  }
}

const cache = new WeakMap<TopographyPlan, Promise<TopographyForm>>();
export function generateTopographyForm(plan: TopographyPlan): Promise<TopographyForm> {
  const saved = cache.get(plan);
  if (saved) return saved;
  const result = buildForm(plan); cache.set(plan, result);
  result.catch(() => cache.delete(plan)); return result;
}

async function buildForm(plan: TopographyPlan): Promise<TopographyForm> {
  const base = await generateGeometry({
    geometry: { heightMm: TOPOGRAPHY.heightMm, radiusMm: TOPOGRAPHY.radiusMm, baseProfile: "bulbous", modifier: "soft-organic-fold", seed: TOPOGRAPHY.seed,
      parameters: { taper: -0.24, bulge: 0.32, foldAmplitude: 0.45, foldHeight: 0.58, foldSpread: 0.28 } },
    sampling: { layerHeightMm: TOPOGRAPHY.layerHeightMm },
    printing: { beadWidthMm: TOPOGRAPHY.beadWidthMm, feedrateMmMin: 1500 },
    validation: { safetyMarginMm: 5, maxLayerDisplacementMm: 1.4 },
  });
  const segments = base.contours[0].points.length - 1;
  const points = Array.from({ length: segments * TOPOGRAPHY.totalLayers + 1 }, (_, index) => {
    const path = index / segments, height = sourceHeight(path);
    const coordinate = Math.max(0, Math.min(base.contours.length - 1,
      (height - base.contours[0].points[0][2]) / TOPOGRAPHY.layerHeightMm));
    const low = Math.floor(coordinate), high = Math.min(base.contours.length - 1, low + 1), mix = coordinate - low;
    const a = base.contours[low].points[index % segments], b = base.contours[high].points[index % segments];
    const band = plan.bands.find(item => path >= item.startLayer && path < item.endLayer);
    return extrudePoint(path, a[0] + (b[0] - a[0]) * mix, a[1] + (b[1] - a[1]) * mix, band);
  });
  // Adjacent turns share their boundary object: no reset, cap or travel jump.
  const layers = Array.from({ length: TOPOGRAPHY.totalLayers }, (_, turn) => points.slice(turn * segments, (turn + 1) * segments + 1));
  relaxTopographySupport(layers, plan.bands);
  const deposited = points.filter(point => !point.gap);
  if (!deposited.every(point => [point.x, point.y, point.z, point.width, point.height].every(Number.isFinite)))
    throw new Error("Invalid derived material geometry");
  const metrics: FormMetrics = {
    geometryId: base.geometryId, layerCount: layers.length, pointCount: points.length,
    maxDropMm: Math.max(...deposited.map(point => point.dropMm)),
    maxRadiusMm: Math.max(...deposited.map(point => Math.hypot(point.x, point.z) + point.width)),
    minY: Math.min(...deposited.map(point => point.y - point.height)), maxY: Math.max(...deposited.map(point => point.y + point.height)),
    bands: plan.bands.map(band => {
      const local = points.filter(point => point.path >= band.startLayer && point.path < band.endLayer);
      return { id: band.id, missingSamples: local.filter(point => point.gap).length, samples: local.length,
        maxDropMm: Math.max(...local.filter(point => !point.gap).map(point => point.dropMm)), intensity: band.intensity };
    }),
  };
  if (metrics.maxRadiusMm > 105 || metrics.minY < -1 || metrics.maxY > TOPOGRAPHY.heightMm + 1)
    throw new Error("Derived vessel exceeded its display bounds");
  const baseRadius = Math.min(...layers[0].map(point => Math.hypot(point.sourceX, point.sourceZ)));
  return { layers, metrics, baseRadius };
}

/** Sample the unchanged continuous deposition path, independently of settled clay. */
export function sampleTopographyPath(form: TopographyForm, path: number): {
  x: number; y: number; z: number; width: number; height: number; path: number; gap: boolean;
} {
  if (!Number.isFinite(path)) throw new Error("Invalid path coordinate");
  const clamped = Math.max(0, Math.min(form.layers.length, path));
  const turn = Math.min(form.layers.length - 1, Math.floor(clamped)), layer = form.layers[turn];
  const index = (clamped - turn) * (layer.length - 1), low = Math.min(layer.length - 1, Math.floor(index));
  const a = layer[low], b = layer[Math.min(layer.length - 1, low + 1)], t = index - low;
  return { x: a.sourceX + (b.sourceX - a.sourceX) * t, y: a.sourceY + (b.sourceY - a.sourceY) * t,
    z: a.sourceZ + (b.sourceZ - a.sourceZ) * t, width: a.sourceWidth + (b.sourceWidth - a.sourceWidth) * t,
    height: a.sourceHeight + (b.sourceHeight - a.sourceHeight) * t, path: clamped,
    gap: a.gap || (t > 0 && b.gap) };
}

/** A single connected extruded tube, capped only at true gaps and global ends. */
export function topographyBuffers(form: TopographyForm) {
  const points = uniquePath(form.layers), sides = 12;
  const positions: number[] = [], normals: number[] = [], initialPositions: number[] = [], initialNormals: number[] = [], indices: number[] = [];
  const initialCenters: number[] = [], finalCenters: number[] = [], sectionFrames: number[] = [], sectionSizes: number[] = [], sectionUv: number[] = [];
  const depositedAt: number[] = [], liftOffset: number[] = [], rings: number[] = [];
  const reveal: { path: number; indexCount: number }[] = [{ path: 0, indexCount: 0 }];
  const frameAt = (index: number, initial: boolean) => {
    const p = points[index];
    const before = index > 0 && !points[index - 1].gap ? points[index - 1] : p;
    const after = index + 1 < points.length && !points[index + 1].gap ? points[index + 1] : p;
    let tx = initial ? after.sourceX - before.sourceX : after.x - before.x;
    let ty = initial ? after.sourceY - before.sourceY : after.y - before.y;
    let tz = initial ? after.sourceZ - before.sourceZ : after.z - before.z;
    if (Math.hypot(tx, ty, tz) < 1e-12) {
      tx = -Math.sin(p.theta); ty = PITCH / (TAU * TOPOGRAPHY.radiusMm); tz = -Math.cos(p.theta);
    }
    const length = Math.hypot(tx, ty, tz); tx /= length; ty /= length; tz /= length;
    const horizontal = Math.hypot(tx, tz) || 1, rx = -tz / horizontal, rz = tx / horizontal;
    return { tx, ty, tz, rx, rz, ux: -ty * rz, uy: -tz * rx + tx * rz, uz: ty * rx };
  };
  for (let i = 0; i < points.length; i++) {
    const p = points[i], frame = frameAt(i, false), initial = frameAt(i, true);
    const headings = [Math.atan2(initial.rz, initial.rx), Math.atan2(initial.ty, Math.hypot(initial.tx, initial.tz)),
      Math.atan2(frame.rz, frame.rx), Math.atan2(frame.ty, Math.hypot(frame.tx, frame.tz))];
    const addSection = (ca: number, sa: number, cap: number) => {
      initialCenters.push(p.sourceX, p.sourceY, p.sourceZ); finalCenters.push(p.x, p.y, p.z);
      sectionFrames.push(...headings); sectionSizes.push(p.sourceWidth, p.sourceHeight, p.width, p.height);
      sectionUv.push(ca, sa, cap);
    };
    rings.push(positions.length / 3);
    for (let side = 0; side < sides; side++) {
      const ca = Math.cos(side / sides * TAU), sa = Math.sin(side / sides * TAU);
      for (const fresh of [false, true]) {
        const f = fresh ? initial : frame, width = fresh ? p.sourceWidth : p.width, height = fresh ? p.sourceHeight : p.height;
        const target = fresh ? initialPositions : positions, ns = fresh ? initialNormals : normals;
        target.push((fresh ? p.sourceX : p.x) + f.rx * ca * width + f.ux * sa * height,
          (fresh ? p.sourceY : p.y) + f.uy * sa * height, (fresh ? p.sourceZ : p.z) + f.rz * ca * width + f.uz * sa * height);
        const nx = f.rx * ca / width + f.ux * sa / height, ny = f.uy * sa / height, nz = f.rz * ca / width + f.uz * sa / height;
        const length = Math.hypot(nx, ny, nz) || 1; ns.push(nx / length, ny / length, nz / length);
      }
      depositedAt.push(p.path); liftOffset.push(p.dropMm);
      addSection(ca, sa, 0);
    }
    if (i && !p.gap && !points[i - 1].gap) for (let side = 0; side < sides; side++) {
      const a = rings[i - 1] + side, b = rings[i - 1] + (side + 1) % sides, c = rings[i] + side, d = rings[i] + (side + 1) % sides;
      indices.push(a, c, b, b, c, d);
    }
    if (!p.gap) for (const start of [true, false]) {
      if (!(start ? i === 0 || points[i - 1].gap : i === points.length - 1 || points[i + 1].gap)) continue;
      const sign = start ? -1 : 1, center = positions.length / 3;
      positions.push(p.x, p.y, p.z); initialPositions.push(p.sourceX, p.sourceY, p.sourceZ);
      normals.push(frame.tx * sign, frame.ty * sign, frame.tz * sign);
      initialNormals.push(initial.tx * sign, initial.ty * sign, initial.tz * sign);
      depositedAt.push(p.path); liftOffset.push(p.dropMm);
      addSection(0, 0, sign);
      for (let side = 0; side < sides; side++) {
        const a = rings[i] + side, b = rings[i] + (side + 1) % sides;
        if (start) indices.push(center, a, b); else indices.push(center, b, a);
      }
    }
    reveal.push({ path: p.path, indexCount: indices.length });
  }
  const freshNormals = new Float32Array(initialNormals);
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices),
    initialPositions: new Float32Array(initialPositions), initialNormals: freshNormals,
    initialCenters: new Float32Array(initialCenters), finalCenters: new Float32Array(finalCenters),
    sectionFrames: new Float32Array(sectionFrames), sectionSizes: new Float32Array(sectionSizes), sectionUv: new Float32Array(sectionUv),
    depositedAt: new Float32Array(depositedAt), liftOffset: new Float32Array(liftOffset), liftedNormals: freshNormals, reveal };
}
