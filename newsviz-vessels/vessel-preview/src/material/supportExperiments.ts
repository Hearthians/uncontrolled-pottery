import {LAB_SETTINGS, ILLUSTRATIVE_PROFILE} from './calibrationProfiles.ts';
import type {MotionCommand} from './calibrationTypes.ts';
import {simulateResponse} from './extrusionResponse.ts';
import {beadDeposition} from './beadDeposition.ts';
export const SUPPORT_EXPERIMENTS = [
  {id: 'stable', label: 'A · Stable reference'}, {id: 'residual', label: 'B · Residual flow'},
  {id: 'bridge', label: 'C · Unsupported bridge'}, {id: 'overhang', label: 'C · One-sided overhang'},
  {id: 'history', label: 'D · Deposition after sagging'},
];
export function supportExperiment(id: string, gapMm = 16) {
  if (!SUPPORT_EXPERIMENTS.some(e => e.id === id) || !Number.isFinite(gapMm) || gapMm < 1 || gapMm > 24) throw new Error('Invalid support experiment');
  const settings = {...LAB_SETTINGS, lengthMm: 40};
  const profile = id === 'residual' ? ILLUSTRATIVE_PROFILE : {...ILLUSTRATIVE_PROFILE, id: 'synthetic-instant-response', startupSeconds: 0, shutdownSeconds: 0, delaySeconds: 0};
  const commands: MotionCommand[] = []; let time = 0;
  const add = (start: MotionCommand['start'], end: MotionCommand['end'], layerId: number, feed: number, kind: MotionCommand['kind'], hold = 0) => {
    const endTimeS = time + (hold || Math.hypot(...end.map((v, k) => v - start[k])) / settings.speedMmS);
    commands.push({startTimeS: time, endTimeS, start, end, layerId, feedMm3S: feed, kind}); time = endTimeS;
  };
  for (let layer = 1; layer <= (id === 'history' ? 3 : 2); layer++) {
    if (layer > 1) {
      const end = commands.at(-1)!.end;
      if (layer === 3) add(end, end, layer - 1, 0, 'travel', 6);
      add(end, [0, 0, layer], layer, 0, 'travel');
    }
    const gap = layer === 1 && id !== 'stable', a = (40 - gapMm) / 2, b = id === 'overhang' ? 40 : a + gapMm;
    const cuts = gap ? [0, a, b, ...(b < 40 ? [40] : [])] : [0, 40];
    for (let i = 1; i < cuts.length; i++) add([cuts[i - 1], 0, layer], [cuts[i], 0, layer], layer, gap && i === 2 ? 0 : settings.feedMm3S, 'deposit');
  }
  const response = simulateResponse(commands, profile), material = beadDeposition(response, settings);
  return {commands, response, material, settings, profile, durationS: response.durationS + 6};
}
