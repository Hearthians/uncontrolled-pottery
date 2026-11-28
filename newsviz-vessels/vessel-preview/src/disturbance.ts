import {FORM} from './config.ts';
import {validateConcernDataset} from './concern.ts';
import type {Move, Toolpath, XYZ} from './toolpath.ts';

export type GapPolicy = Readonly<{version: string; seed: number; maxFraction: number; maxEvents: number}>;
export const GAP_POLICY: GapPolicy = Object.freeze({version: 'ideal-gaps-1', seed: 42, maxFraction: 0.3, maxEvents: 8});
export type GapEvent = Readonly<{startMm: number; endMm: number}>;

// Fractions and event counts are design assumptions, not clay calibration constants.
export function planConcernGaps(baseline: Toolpath, input: unknown, policy: GapPolicy = GAP_POLICY) {
  const dataset = validateConcernDataset(input, baseline.geometry.contours.length);
  if (policy.version !== GAP_POLICY.version || !Number.isInteger(policy.seed) || policy.seed < 0 || policy.seed > 0xffffffff ||
    !Number.isFinite(policy.maxFraction) || policy.maxFraction < 0 || policy.maxFraction >= 1 ||
    !Number.isInteger(policy.maxEvents) || policy.maxEvents < 1 || policy.maxEvents > 100) throw new Error('Invalid gap policy');
  if (baseline.moves.some(m => m.kind !== 'travel' && !m.extrude)) throw new Error('Expected stable baseline');
  let state = policy.seed >>> 0;
  const random = () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296;};
  const moves: Move[] = [];
  const layers = dataset.records.map(({layerId, concernScore}) => {
    const source = baseline.moves.filter(m => m.layerId === layerId);
    const contourLengthMm = source.filter(m => m.kind === 'deposition').reduce((sum, m) => sum + m.lengthMm, 0);
    const budgetMm = layerId <= FORM.bottomLayers ? 0 : contourLengthMm * policy.maxFraction * concernScore;
    const requestedCount = Math.ceil(policy.maxEvents * concernScore);
    // Sub-nanometre events cannot reliably split double-precision command times.
    const count = budgetMm > 0 && budgetMm / requestedCount >= 1e-6 ? requestedCount : 0;
    const gapLengthMm = count ? budgetMm : 0;
    const interruptedFraction = gapLengthMm / contourLengthMm;
    const events: GapEvent[] = Array.from({length: count}, (_, i) => {
      const slot = contourLengthMm / count, width = gapLengthMm / count;
      const startMm = i * slot + (slot - width) * (0.1 + 0.8 * random());
      return Object.freeze({startMm, endMm: startMm + width});
    });
    let arc = 0;
    for (const move of source) {
      if (move.kind !== 'deposition' || !count) {moves.push(move); continue;}
      const end = arc + move.lengthMm;
      const cuts = [arc, ...events.flatMap(e => [e.startMm, e.endMm]).filter(v => v > arc && v < end), end];
      const point = (a: XYZ, b: XYZ, t: number): XYZ => t === 0 ? a : t === 1 ? b : Object.freeze(a.map((v, k) => v + (b[k] - v) * t)) as XYZ;
      for (let i = 1; i < cuts.length; i++) {
        const a = (cuts[i - 1] - arc) / move.lengthMm, b = i === cuts.length - 1 ? 1 : (cuts[i] - arc) / move.lengthMm;
        const middle = (cuts[i - 1] + cuts[i]) / 2;
        moves.push(Object.freeze({...move, extrude: !events.some(e => middle >= e.startMm && middle < e.endMm),
          start: point(move.start, move.end, a), end: point(move.start, move.end, b),
          beadStart: point(move.beadStart, move.beadEnd, a), beadEnd: point(move.beadStart, move.beadEnd, b),
          lengthMm: cuts[i] - cuts[i - 1],
          startTimeS: move.startTimeS + (move.endTimeS - move.startTimeS) * a,
          endTimeS: b === 1 ? move.endTimeS : move.startTimeS + (move.endTimeS - move.startTimeS) * b}));
      }
      arc = end;
    }
    return Object.freeze({layerId, concernScore, contourLengthMm, gapLengthMm, interruptedFraction, events: Object.freeze(events)});
  });
  const gapLengthMm = layers.reduce((sum, l) => sum + l.gapLengthMm, 0);
  const path: Toolpath = gapLengthMm === 0 ? baseline : Object.freeze({...baseline, moves: Object.freeze(moves),
    depositedLengthMm: baseline.depositedLengthMm - gapLengthMm});
  return Object.freeze({path, dataset, policy: Object.freeze({...policy}), layers: Object.freeze(layers), gapLengthMm,
    depositedCoverage: path.depositedLengthMm / baseline.depositedLengthMm});
}
