import {
  SCORE_STUDY, angleDelta, bell, bodyEnvelope, finishScoreShape, makeScoreBase,
  scoreChannels, seedPhase, smoothRange, type ScorePoint, type ScoreShape,
} from "./scoreStudyCore.ts";

type DefectSector = { angle: number; roof: number; span: number; scale: number };

function sectors(seed: number): DefectSector[] {
  const phase = seedPhase(seed);
  return [
    { angle: 0.90 + phase * 0.025, roof: 17.5, span: 0.49, scale: 1 },
    { angle: 2.95 + phase * 0.025, roof: 29.2, span: 0.43, scale: 0.85 },
    { angle: 0.46 + phase * 0.025, roof: 47.0, span: 0.55, scale: 1 },
    { angle: 4.15 + phase * 0.025, roof: 51.5, span: 0.49, scale: 0.9 },
    { angle: 1.15 + phase * 0.025, roof: 57.4, span: 0.40, scale: 0.7 },
  ];
}

/**
 * A fixed geometric bridge/contact rule. No scalar changes its material law.
 * Only the deposited positions and omitted feed windows differ between scores.
 * This bounded, one-pass settling is not a stress, volume or collision solver.
 */
function settleOnDeposits(points: ScorePoint[]) {
  const { segments, pitchMm, widthMm, halfHeightMm } = SCORE_STUDY;
  const nominalCompression = halfHeightMm * 2 - pitchMm;
  const settled = new Float64Array(points.length);
  for (let turn = 2; turn <= SCORE_STUDY.layers; turn++) {
    const begin = turn * segments, end = Math.min(points.length, begin + segments);
    const targets = new Float64Array(end - begin), limits = new Float64Array(end - begin);
    for (let index = begin; index < end; index++) {
      const p = points[index];
      if (p.gap) continue;
      const j = index - begin;
      limits[j] = Math.min(26, (p.path - 2) * pitchMm);
      let top = -Infinity;
      // Resolve support from previously deposited turns, including nearby angles.
      // A shifted overhang can miss the directly underlying turn but land lower.
      const reach = Math.ceil((p.width + widthMm) / SCORE_STUDY.radiusMm * segments / (Math.PI * 2)) + 2;
      for (let below = 1; below <= 9; below++) {
        const center = index - below * segments;
        if (center + reach < 0) break;
        for (let delta = -reach; delta <= reach; delta++) {
          const lowerIndex = center + delta;
          if (lowerIndex < 0 || lowerIndex >= begin) continue;
          const q = points[lowerIndex];
          if (q.gap) continue;
          const distance = Math.hypot(p.x - q.x, p.z - q.z), footprint = p.width + q.width;
          if (distance >= footprint) continue;
          const supportTop = q.y + q.height * Math.sqrt(1 - (distance / footprint) ** 2);
          if (supportTop < p.sourceY + p.height) top = Math.max(top, supportTop);
        }
      }
      const clearance = Number.isFinite(top)
        ? Math.max(0, p.sourceY - p.height - top + nominalCompression - 0.35)
        : limits[j];
      targets[j] = Math.min(limits[j], clearance);
    }
    // Neighbour coupling supplies bridge resistance. True interruptions never
    // transmit it; anchored sides keep an unsupported strand a curved bridge.
    let current = targets.slice();
    for (let iteration = 0; iteration < 20; iteration++) {
      const next = current.slice();
      for (let j = 0; j < current.length; j++) {
        const index = begin + j, p = points[index];
        if (p.gap) continue;
        let total = targets[j], weight = 1;
        if (index && !points[index - 1].gap) {
          total += 2.4 * (j ? current[j - 1] : settled[index - 1]); weight += 2.4;
        }
        if (j + 1 < current.length && !points[index + 1].gap) {
          total += 2.4 * current[j + 1]; weight += 2.4;
        }
        next[j] = Math.min(limits[j], total / weight);
      }
      current = next;
    }
    for (let j = 0; j < current.length; j++) {
      const index = begin + j, p = points[index];
      if (p.gap) continue;
      settled[index] = current[j]; p.y = p.sourceY - current[j];
    }
  }
}

/** Scalar controls feed amount and actual paths; local support produces settling. */
export function generatePathShape(score: number, seed: number = SCORE_STUDY.seed): ScoreShape {
  const c = scoreChannels(score), points = makeScoreBase(seed), phase = seedPhase(seed), defects = sectors(seed);
  for (const p of points) {
    const envelope = bodyEnvelope(p.path), t = p.path;
    const wave = 0.64 * Math.sin(p.theta * 4 + t * 0.22 + phase)
      + 0.25 * Math.sin(p.theta * 9 - t * 0.31 + phase) + 0.11 * Math.sin(p.theta * 17 + t * 0.42);
    let feed = 1 + 0.25 * c.variation * envelope * wave;
    let radial = 0.65 * c.variation * envelope * wave;
    for (const sector of defects) {
      const center = sector.angle + 0.035 * Math.sin((t - sector.roof) * 0.62 + phase);
      const angular = bell(angleDelta(p.theta, center) / (sector.span + c.sag * 0.14));
      const depth = 4.4 + c.sag * 2.6;
      const omission = bell((t - (sector.roof - depth / 2)) / (depth / 2)) * angular;
      if (c.gaps > 0.025 && omission > 0.58 - 0.42 * c.gaps) p.gap = true;
      // Put the large accumulation on an intact neighbouring wall. Concentrating
      // it directly above a feed gap makes moderate scores collapse too early.
      const accumulationAngle = bell(angleDelta(p.theta, center + 1.05) / (sector.span + 0.15));
      const accumulation = bell((t - (sector.roof - 5.8)) / 6.8) * accumulationAngle * sector.scale;
      feed += 1.5 * c.bulges * accumulation;
      radial += 20 * c.bulges * (1 - 0.30 * c.offsets) * accumulation;
      // High-score paths reach farther beyond the omitted span. The support
      // rule below, rather than this channel, determines the vertical movement.
      const overhang = bell((t - (sector.roof + 1.1)) / 4.2) * angular * sector.scale;
      radial += 12 * c.sag * overhang;
    }
    // Two sustained whole-contour offsets create legible ledges. Transitions are
    // continuous along the actual helix and recover gradually near the rim.
    const shiftX = c.offsets * envelope * (11 * smoothRange(22, 25.5, t)
      - 18 * smoothRange(38, 41.5, t) + 7 * smoothRange(54, 60, t));
    const shiftZ = c.offsets * envelope * (-5 * smoothRange(22, 25.5, t)
      + 11 * smoothRange(38, 41.5, t) - 6 * smoothRange(54, 60, t));
    p.x += Math.cos(p.theta) * radial + shiftX;
    p.z += Math.sin(p.theta) * radial + shiftZ;
    // Overfeed increases the whole cross-section; it never makes a thin ribbon.
    // Area is proportional to commanded feed here, before geometric settling.
    const size = Math.sqrt(Math.max(0.65, feed));
    p.width *= size; p.height *= size;
  }
  settleOnDeposits(points);
  return finishScoreShape("path", score, seed, points, [
    "Feed and actual path offsets vary; the support rule and clay cross-section rule remain fixed.",
    "Local geometric bridge settling approximates support loss; no rheology, stress or full contact solution is claimed.",
  ]);
}
