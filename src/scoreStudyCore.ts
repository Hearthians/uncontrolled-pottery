/** Shared millimetre-scale specimen for the scalar-control experiments. */
export const SCORE_STUDY = Object.freeze({
  version: "scalar-form-study-2", seed: 42, layers: 64, segments: 128,
  radiusMm: 43, pitchMm: 2.7, widthMm: 3.3, halfHeightMm: 1.85,
  scores: [0, 0.2, 0.4, 0.6, 0.8, 1] as readonly number[],
});
export type ScoreStrategy = "supply" | "path" | "field";
export type ScorePoint = {
  x: number; y: number; z: number; width: number; height: number;
  sourceX: number; sourceY: number; sourceZ: number;
  gap: boolean; breakBefore?: boolean; path: number; theta: number;
};
export type ScoreChannels = { variation: number; gaps: number; bulges: number; offsets: number; sag: number };
export type ScoreMetrics = {
  missingFraction: number; widthCv: number; maxOutwardMm: number; maxLayerShiftMm: number;
  maxDropMm: number; maxDisplacementMm: number; depositedRuns: number; minY: number; maxY: number;
};
export type ScoreShape = {
  strategy: ScoreStrategy; score: number; seed: number; points: ScorePoint[];
  channels: ScoreChannels; metrics: ScoreMetrics; notes?: string[];
};
export const TAU = Math.PI * 2;
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export function smoothRange(low: number, high: number, value: number) {
  const t = clamp01((value - low) / (high - low)); return t * t * (3 - 2 * t);
}
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const bell = (value: number) => Math.abs(value) < 1 ? (1 - value * value) ** 2 : 0;
export function seedPhase(seed: number) { return ((seed * 0.61803398875) % 1) * TAU; }
export function scoreChannels(score: number): ScoreChannels {
  if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error("Score must be between 0 and 1");
  return {
    variation: smoothRange(0.08, 0.48, score), gaps: smoothRange(0.28, 0.54, score),
    bulges: smoothRange(0.48, 0.72, score), offsets: smoothRange(0.69, 0.88, score),
    sag: smoothRange(0.85, 1, score),
  };
}

/** No score enters the nominal shape. All three decoders start from this helix. */
export function makeScoreBase(seed: number = SCORE_STUDY.seed): ScorePoint[] {
  const { layers, segments, pitchMm, widthMm, halfHeightMm, radiusMm } = SCORE_STUDY;
  const phase = seedPhase(seed) * 0.08;
  return Array.from({ length: layers * segments + 1 }, (_, index) => {
    const path = index / segments, theta = path * TAU, h = path / layers;
    const fold = 5.8 * Math.cos(theta * 3 - h * TAU * 1.15 + phase);
    const radius = radiusMm + 2.4 * Math.sin(h * Math.PI) + fold;
    const x = radius * Math.cos(theta), z = radius * Math.sin(theta), y = 2.4 + path * pitchMm;
    return { x, y, z, sourceX: x, sourceY: y, sourceZ: z, width: widthMm, height: halfHeightMm,
      gap: false, theta, path };
  });
}

/** Keep a sound foundation and smoothly introduce the data above it. */
export function bodyEnvelope(path: number) { return smoothRange(2, 7, path); }

export function finishScoreShape(strategy: ScoreStrategy, score: number, seed: number, points: ScorePoint[], notes?: string[]): ScoreShape {
  const channels = scoreChannels(score), { segments } = SCORE_STUDY;
  let missing = 0, count = 0, sumWidth = 0, sumWidth2 = 0, maxOutwardMm = 0, maxDropMm = 0;
  let maxLayerShiftMm = 0, maxDisplacementMm = 0, depositedRuns = 0, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (![p.x, p.y, p.z, p.width, p.height].every(Number.isFinite) || p.width <= 0 || p.height <= 0)
      throw new Error(`Invalid score geometry at ${i}`);
    if (p.gap) { missing++; continue; }
    count++; sumWidth += p.width; sumWidth2 += p.width ** 2;
    if (!i || points[i - 1].gap || p.breakBefore) depositedRuns++;
    maxOutwardMm = Math.max(maxOutwardMm, Math.hypot(p.x, p.z) - Math.hypot(p.sourceX, p.sourceZ));
    maxDropMm = Math.max(maxDropMm, p.sourceY - p.y);
    maxDisplacementMm = Math.max(maxDisplacementMm, Math.hypot(p.x - p.sourceX, p.y - p.sourceY, p.z - p.sourceZ));
    const lower = points[i - segments];
    if (lower && !lower.gap) maxLayerShiftMm = Math.max(maxLayerShiftMm,
      Math.hypot((p.x - p.sourceX) - (lower.x - lower.sourceX), (p.z - p.sourceZ) - (lower.z - lower.sourceZ)));
    minY = Math.min(minY, p.y - p.height); maxY = Math.max(maxY, p.y + p.height);
  }
  if (!count) throw new Error("The specimen contains no clay");
  const meanWidth = sumWidth / count;
  return { strategy, score, seed, points, channels, notes, metrics: {
    missingFraction: missing / points.length, widthCv: Math.sqrt(Math.max(0, sumWidth2 / count - meanWidth ** 2)) / meanWidth,
    maxOutwardMm, maxLayerShiftMm, maxDropMm, maxDisplacementMm, depositedRuns, minY, maxY,
  } };
}
