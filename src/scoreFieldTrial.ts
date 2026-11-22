import {
  SCORE_STUDY, TAU, angleDelta, bell, bodyEnvelope, finishScoreShape, makeScoreBase,
  seedPhase, smoothRange,
} from "./scoreStudyCore.ts";
import type { ScorePoint, ScoreShape } from "./scoreStudyCore.ts";

type FailurePatch = { center: number; roof: number; span: number; weight: number };
type AccumulationPatch = { center: number; level: number; span: number; halfLayers: number; weight: number };

type FieldTarget = { points: ScorePoint[]; cuts: Float64Array };
const targetCache = new Map<number, FieldTarget>();

/**
 * C uses one coherent failure field. Score linearly scales its displacement and
 * added section across the entire 0–1 range, rather than switching phenomena on
 * in stages. The severe target is geometrically support-resolved once per seed.
 */
export function generateFieldShape(score: number, seed: number = SCORE_STUDY.seed): ScoreShape {
  if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error("Score must be between 0 and 1");
  const points = makeScoreBase(seed);
  let target = targetCache.get(seed);
  if (!target) {
    target = makeFieldTarget(seed);
    // Interactive experiments can use other seeds without retaining every one.
    if (targetCache.size >= 8) targetCache.delete(targetCache.keys().next().value!);
    targetCache.set(seed, target);
  }
  for (let index = 0; index < points.length; index++) {
    const p = points[index], severe = target.points[index];
    p.x += score * (severe.x - p.x);
    p.y += score * (severe.y - p.y);
    p.z += score * (severe.z - p.z);
    p.width += score * (severe.width - p.width);
    p.height += score * (severe.height - p.height);
    // A gap grows by continuously necking the bead down to zero. Deleting a
    // whole unchanged bead at a threshold would make the score movie pop.
    const section = Math.max(0, 1 - score * target.cuts[index]);
    p.width *= Math.max(1e-9, section);
    p.height *= Math.max(1e-9, section);
    if (section <= 0) p.gap = true;
  }
  const result = finishScoreShape("field", score, seed, points, [
    "One continuous field: score linearly scales bulges, layer movement and supported roof drop from the same fixed specimen.",
    "Independent compact mounds add section area on intact wall. Openings grow by continuous local necking before the strand separates.",
    "The severe target uses a local geometric support query; material rheology and volume conservation are not solved.",
  ]);
  return { ...result, channels: { variation: score, gaps: score, bulges: score, offsets: score, sag: score } };
}

function makeFieldTarget(seed: number): FieldTarget {
  const points = makeScoreBase(seed), phase = seedPhase(seed);
  const cuts = new Float64Array(points.length);
  const patches: FailurePatch[] = [
    { center: 0.72 + phase * 0.07, roof: 18.6, span: 0.60, weight: 0.96 },
    { center: 1.52 + phase * 0.04, roof: 36.2, span: 0.62, weight: 1 },
    { center: 0.28 + phase * 0.07, roof: 51.8, span: 0.58, weight: 0.86 },
    { center: 3.86 + phase * 0.06, roof: 28.4, span: 0.54, weight: 0.82 },
    { center: 4.61 + phase * 0.04, roof: 47.4, span: 0.50, weight: 0.75 },
  ];
  const accumulations: AccumulationPatch[] = [
    { center: 0.12 + phase * 0.03, level: 28.3, span: 0.72, halfLayers: 7.5, weight: 1 },
    { center: 2.02 + phase * 0.02, level: 43.5, span: 0.75, halfLayers: 7.0, weight: 0.92 },
    { center: 4.14 + phase * 0.02, level: 56.2, span: 0.70, halfLayers: 6.5, weight: 0.80 },
  ];
  const sagCaps = new Float64Array(points.length);
  for (let index = 0; index < points.length; index++) {
    const p = points[index], envelope = bodyEnvelope(p.path), h = p.path / SCORE_STUDY.layers;
    const coherentRipple = 0.62 * Math.sin(p.theta * 5 - p.path * 0.19 + phase)
      + 0.26 * Math.sin(p.theta * 11 + p.path * 0.35)
      + 0.12 * Math.sin(p.theta * 21 - p.path * 0.21 + phase);
    const supply = 1 + envelope * 0.24 * coherentRipple;
    p.width *= supply; p.height *= Math.sqrt(supply);
    let radial = envelope * 1.2 * coherentRipple;
    let localAccumulation = 0;
    for (const mound of accumulations) {
      const moundAngle = bell(angleDelta(p.theta, mound.center) / mound.span);
      const moundHeight = bell((p.path - mound.level) / mound.halfLayers);
      const accumulation = moundAngle * moundHeight * mound.weight;
      localAccumulation = Math.max(localAccumulation, accumulation);
      radial += 28 * accumulation;
    }
    for (const patch of patches) {
      const center = patch.center + 0.075 * Math.sin((p.path - patch.roof) * 0.25 + phase)
        + 0.12 * Math.sin((p.path - patch.roof) * 0.95 + phase);
      const halfSpan = patch.span * 1.20;
      const angular = bell(angleDelta(p.theta, center) / halfSpan);
      // Several omitted turns are needed before a rounded, overlapping bead
      // wall reveals a visible opening. Keep the final severe span unchanged.
      const gapDepth = 8.6 * patch.weight;
      const gapCenter = patch.roof - gapDepth * 0.56;
      const vertical = bell((p.path - gapCenter) / (gapDepth * 0.56));
      // Thresholding a fixed smooth field keeps each opening coherent rather
      // than distributing unrelated missing samples over the whole vessel.
      const cutStrength = angular * vertical / 0.27;
      cuts[index] = Math.max(cuts[index], cutStrength);
      if (cutStrength >= 1) p.gap = true;

      // Layer bands move together. Their entrance is comparatively short,
      // while a longer recovery keeps the surrounding helix connected.
      const moveBand = smoothRange(patch.roof - 0.9, patch.roof + 1.3, p.path)
        * (1 - smoothRange(patch.roof + 6.2, patch.roof + 14.0, p.path));
      const direction = patch.center + Math.PI * 0.12;
      const movement = 28.0 * moveBand * patch.weight
        * (0.90 + 0.12 * Math.sin(p.path * 0.83 + phase));
      p.x += Math.cos(direction) * movement;
      p.z += Math.sin(direction) * movement;
      radial += 8.0 * moveBand * angular * Math.sin(p.path * 0.84 + phase);
      const tangentialSlip = 7 * moveBand * angular * Math.sin(p.path * 0.68 + phase);
      p.x -= Math.sin(p.theta) * tangentialSlip;
      p.z += Math.cos(p.theta) * tangentialSlip;

      if (p.path >= patch.roof && p.path <= patch.roof + 12) {
        const roofEnvelope = (1 - smoothRange(patch.roof + 4, patch.roof + 12, p.path));
        const roofCenter = center + 0.15 * Math.sin((p.path - patch.roof) * 0.6 + phase);
        const roofAngle = bell(angleDelta(p.theta, roofCenter) / halfSpan);
        const asymmetry = 0.90 + 0.10 * Math.sin(p.theta * 3 + p.path * 0.67 + phase);
        sagCaps[index] = Math.max(sagCaps[index], 50 * roofAngle * patch.weight * roofEnvelope * asymmetry);
      }
    }
    p.x += Math.cos(p.theta) * radial * envelope;
    p.z += Math.sin(p.theta) * radial * envelope;
    // Extra supply adds substantial cross-sectional area as well as moving the
    // centerline outwards. Compact multi-turn mounds remain at severe scores.
    const accumulated = localAccumulation;
    p.width *= 1 + 1.35 * accumulated;
    p.height *= 1 + 0.75 * accumulated;
    // Very small, continuous horizontal wandering makes the supply ripple
    // readable without adding an unrelated high-frequency geometric noise.
    p.x += envelope * 0.30 * Math.sin(h * TAU * 2 + phase);
    // A geometric composition bound keeps the combined mound and slipped band
    // readable at the existing framing, throughout the continuous score trajectory.
    const sourceRadius = Math.hypot(p.sourceX, p.sourceZ), finalRadius = Math.hypot(p.x, p.z);
    if (finalRadius > sourceRadius + 45) {
      const scale = (sourceRadius + 45) / finalRadius;
      p.x *= scale; p.z *= scale;
    }
  }
  settleFieldRoofs(points, sagCaps);
  return { points, cuts };
}

/** Resolve one turn at a time so settled lower turns can support the next one. */
function settleFieldRoofs(points: ScorePoint[], caps: Float64Array) {
  const { segments, layers } = SCORE_STUDY;
  for (let turn = 0; turn <= layers; turn++) {
    const begin = turn * segments, end = Math.min(points.length, begin + segments);
    if (end <= begin) continue;
    const targets = new Float64Array(end - begin);
    for (let index = begin; index < end; index++) {
      const p = points[index], cap = caps[index];
      if (p.gap || cap <= 0) continue;
      let supportTop = 0;
      for (let below = 1; below <= 11; below++) {
        for (let offset = -4; offset <= 4; offset++) {
          const otherIndex = index - below * segments + offset;
          if (otherIndex < 0 || otherIndex >= begin) continue;
          const q = points[otherIndex];
          if (q.gap) continue;
          const distance = Math.hypot(p.x - q.x, p.z - q.z), footprint = p.width + q.width;
          if (distance >= footprint) continue;
          const top = q.y + q.height * Math.sqrt(1 - (distance / footprint) ** 2);
          if (top < p.sourceY + p.height && top > supportTop) supportTop = top;
        }
      }
      const unsupported = Math.max(0, p.sourceY - p.height - supportTop - 0.6);
      targets[index - begin] = Math.min(cap, unsupported * 0.96, Math.max(0, p.sourceY - p.height - 1));
    }
    let relaxed = targets.slice();
    for (let iteration = 0; iteration < 18; iteration++) {
      const next = relaxed.slice();
      for (let local = 0; local < relaxed.length; local++) {
        const index = begin + local, p = points[index];
        if (p.gap || caps[index] <= 0) continue;
        const before = local && !points[index - 1].gap ? relaxed[local - 1] : relaxed[local];
        const after = local + 1 < relaxed.length && !points[index + 1].gap ? relaxed[local + 1] : relaxed[local];
        next[local] = Math.min(caps[index], (targets[local] * 2 + before + after) / 4);
      }
      relaxed = next;
    }
    for (let local = 0; local < relaxed.length; local++) {
      const p = points[begin + local];
      if (p.gap) continue;
      const drop = relaxed[local];
      p.y -= drop;
      // Bounded section relaxation avoids a thin ribbon at the bent roofs.
      const spreading = Math.min(0.07, drop / 250);
      p.width *= 1 + spreading;
      p.height = Math.max(1.55, p.height / (1 + spreading));
    }
  }
}
