import type {LabSettings, MaterialProfile, MotionCommand} from './calibrationTypes.ts';
import {validateSettings} from './calibrationTypes.ts';
import type {Toolpath} from '../toolpath.ts';
export const ILLUSTRATIVE_PROFILE: MaterialProfile = {id: 'illustrative-response-1', status: 'illustrative', evidenceIds: [], startupSeconds: 0.15, shutdownSeconds: 0.25, delaySeconds: 0.05, thresholdMm3S: 0.05};
export const LAB_SETTINGS: LabSettings = {lengthMm: 80, speedMmS: 20, feedMm3S: Math.PI * 2 * 1 / 4 * 20, nozzleDiameterMm: null, clearanceMm: 1, widthMm: 2, heightMm: 1, densityGPerCm3: null};
export const LAB_EXPERIMENTS = [
  {id: 'continuous', label: 'A · Continuous', ratio: 1, gapMm: 0, layers: 1},
  ...[0.6, 1, 1.4].map(ratio => ({id: `flow-${ratio}`, label: `B · Flow ×${ratio}`, ratio, gapMm: 0, layers: 1})),
  ...[2, 5, 10, 20].map(gapMm => ({id: `gap-${gapMm}`, label: `C · Stop/restart ${gapMm} mm`, ratio: 1, gapMm, layers: 1})),
  {id: 'layers', label: 'D · Three aligned layers', ratio: 1, gapMm: 0, layers: 3},
];
export function experimentCommands(id: string, settings: LabSettings): MotionCommand[] {
  validateSettings(settings);
  const e = LAB_EXPERIMENTS.find(e => e.id === id); if (!e) throw new Error('Unknown experiment');
  const {lengthMm: length, speedMmS: speed, clearanceMm, heightMm} = settings;
  const commands: MotionCommand[] = []; let time = 0;
  const add = (start: MotionCommand['start'], end: MotionCommand['end'], layerId: number, feedMm3S: number, kind: MotionCommand['kind']) => {
    const endTimeS = time + Math.hypot(...end.map((v, k) => v - start[k])) / speed;
    commands.push({startTimeS: time, endTimeS, start, end, layerId, feedMm3S, kind}); time = endTimeS;
  };
  for (let layerId = 1; layerId <= e.layers; layerId++) {
    const z = clearanceMm + (layerId - 1) * heightMm;
    if (layerId > 1) add(commands.at(-1)!.end, [0, 0, z], layerId, 0, 'travel');
    const cuts = e.gapMm ? [0, (length - e.gapMm) / 2, (length + e.gapMm) / 2, length] : [0, length];
    for (let i = 1; i < cuts.length; i++) add([cuts[i - 1], 0, z], [cuts[i], 0, z], layerId, e.gapMm && i === 2 ? 0 : settings.feedMm3S * e.ratio, 'deposit');
  }
  return commands;
}
// Explicit adapter only: the vessel UI continues using its ideal Milestone 2A commands.
export function responseCommands(path: Toolpath, nominalFlowMm3S: number): MotionCommand[] {
  if (!Number.isFinite(nominalFlowMm3S) || nominalFlowMm3S < 0) throw new Error('Invalid nominal volumetric flow');
  return path.moves.map(m => ({startTimeS: m.startTimeS, endTimeS: m.endTimeS, start: m.start, end: m.end,
    layerId: m.layerId, kind: m.kind === 'travel' ? 'travel' : 'deposit', feedMm3S: m.extrude ? nominalFlowMm3S : 0}));
}
