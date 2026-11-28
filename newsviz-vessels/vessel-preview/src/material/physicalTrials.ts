import {LAB_SETTINGS, ILLUSTRATIVE_PROFILE} from './calibrationProfiles.ts';
import {finite, validateSettings} from './calibrationTypes.ts';
import type {MotionCommand} from './calibrationTypes.ts';
import {validateRecord} from './measurements.ts';
import type {CalibrationRecord} from './measurements.ts';
import {simulateResponse} from './extrusionResponse.ts';
import {beadDeposition} from './beadDeposition.ts';
import {depositionDiagnostics} from './depositionDiagnostics.ts';
import {buildSupportHistory, materialAt} from './supportHistory.ts';
import {SAG_PARAMETERS} from './reactiveSagging.ts';

export const GROUPS = ['stop-restart', 'unsupported-span', 'sag-time'] as const;
export type Group = typeof GROUPS[number];
export type Observation = {id: string; metric: 'width' | 'height' | 'gap' | 'sag' | 'span'; value: number; unit: 'mm'; uncertaintyMm: number; timeS: number; timeUncertaintyS: number; xMm: number; layer: number; method: string; evidenceIds: string[]};
export type PhysicalTrial = {
  schemaVersion: '4A.1'; protocolVersion: '4A.1'; status: 'planned' | 'measured'; trialId: string;
  group: Group; replicate: number; controlTrialId: string | null;
  legacy: CalibrationRecord;
  geometry: {version: 'horizontal-wall-1'; layers: number; interruptionMm: number};
  conditions: {operator: string | null; capturedAt: string | null; clayPreparation: string | null; substrate: string | null; extrusionConvention: string | null; temperatureC: number | null; humidityPercent: number | null};
  evidence: {id: string; source: string; description: string}[];
  observations: Observation[];
};
export function blankTrial(group: Group): PhysicalTrial {
  return {schemaVersion: '4A.1', protocolVersion: '4A.1', status: 'planned', trialId: `${group}-replace-with-unique-id`, group, replicate: 1, controlTrialId: null,
    legacy: {schemaVersion: '1.0', units: 'mm,s,mm3/s,g,g/cm3', experimentId: `4A-${group}`, materialBatch: 'unmeasured', machineProfile: 'unconfigured', pathLengthMm: 80, commandedFlowMm3S: LAB_SETTINGS.feedMm3S, clearanceMm: 1, targetBeadWidthMm: 2, densityGPerCm3: null, nozzleDiameterMm: null, travelSpeedMmS: 20, nominalLayerHeightMm: 1, commandedGapMm: group === 'stop-restart' ? 10 : 16, measuredGapMm: null, measuredBeadWidthMm: null, measuredBeadHeightMm: null, measuredMassG: null, status: 'simulation-only', response: null},
    geometry: {version: 'horizontal-wall-1', layers: group === 'stop-restart' ? 1 : 2, interruptionMm: group === 'stop-restart' ? 10 : 16},
    conditions: {operator: null, capturedAt: null, clayPreparation: null, substrate: null, extrusionConvention: null, temperatureC: null, humidityPercent: null}, evidence: [], observations: []};
}
function nonempty(v: unknown, name: string) {if (typeof v !== 'string' || !v.trim() || v.length > 4000) throw new Error(`Missing or invalid ${name}`);}
export function trialSettings(r: PhysicalTrial) {
  const l = r.legacy;
  return {lengthMm: l.pathLengthMm, speedMmS: l.travelSpeedMmS, feedMm3S: l.commandedFlowMm3S, clearanceMm: l.clearanceMm, widthMm: l.targetBeadWidthMm, heightMm: l.nominalLayerHeightMm, nozzleDiameterMm: l.nozzleDiameterMm, densityGPerCm3: l.densityGPerCm3};
}
export function validateTrial(input: unknown): PhysicalTrial {
  if (!input || typeof input !== 'object') throw new Error('Expected physical trial');
  const r = input as PhysicalTrial;
  if (r.schemaVersion !== '4A.1' || r.protocolVersion !== '4A.1' || !GROUPS.includes(r.group) || !['planned', 'measured'].includes(r.status)) throw new Error('Unsupported trial version, group or status');
  nonempty(r.trialId, 'trial ID'); finite(r.replicate, 'Replicate', 1, 1000);
  if (!Number.isInteger(r.replicate)) throw new Error('Replicate must be an integer');
  if (r.controlTrialId !== null) {nonempty(r.controlTrialId, 'Control trial ID'); if (r.controlTrialId === r.trialId) throw new Error('Control must be a separate trial');}
  validateRecord(r.legacy); validateSettings(trialSettings(r));
  if (!r.geometry || r.geometry.version !== 'horizontal-wall-1' || ![1, 2, 3].includes(r.geometry.layers) || (r.group !== 'stop-restart' && r.geometry.layers !== 2)) throw new Error('Invalid horizontal geometry');
  finite(r.geometry.interruptionMm, 'Interruption mm', 0, 24);
  if (r.geometry.interruptionMm !== r.legacy.commandedGapMm || r.geometry.interruptionMm > r.legacy.pathLengthMm - 20) throw new Error('Gap mismatch or anchors shorter than 10 mm');
  if (r.legacy.pathLengthMm / r.legacy.travelSpeedMmS * r.geometry.layers > 40) throw new Error('Trial exceeds 40 s deposition budget');
  if (!r.conditions || !Array.isArray(r.evidence) || !Array.isArray(r.observations) || r.observations.length > 1000 || r.evidence.length > 100) throw new Error('Missing conditions or excessive observations');
  for (const key of ['operator', 'capturedAt', 'clayPreparation', 'substrate', 'extrusionConvention'] as const) {
    if (r.conditions[key] !== null) nonempty(r.conditions[key], key);
    else if (r.status === 'measured') throw new Error(`Measured trial requires ${key}`);
  }
  if (r.conditions.capturedAt !== null && (!/^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$/.test(r.conditions.capturedAt) || !Number.isFinite(Date.parse(r.conditions.capturedAt)))) throw new Error('Timestamp requires ISO date and timezone');
  if (r.conditions.temperatureC !== null) finite(r.conditions.temperatureC, 'Temperature C', -20, 80);
  if (r.conditions.humidityPercent !== null) finite(r.conditions.humidityPercent, 'Humidity %', 0, 100);
  const ids = new Set<string>();
  for (const e of r.evidence) {if (!e) throw new Error('Invalid evidence'); nonempty(e.id, 'Evidence ID'); nonempty(e.source, 'Evidence source'); nonempty(e.description, 'Evidence description'); if (ids.has(e.id)) throw new Error('Duplicate evidence ID'); ids.add(e.id);}
  const seen = new Set<string>();
  for (const o of r.observations) {
    if (!o || !['width', 'height', 'gap', 'sag', 'span'].includes(o.metric) || o.unit !== 'mm') throw new Error('Invalid metric or units');
    nonempty(o.id, 'Observation ID'); nonempty(o.method, 'Measurement method');
    if (seen.has(o.id)) throw new Error('Duplicate observation ID'); seen.add(o.id);
    finite(o.value, 'Raw value mm', o.metric === 'sag' ? -100 : 0, 1000); finite(o.uncertaintyMm, 'Standard uncertainty mm');
    finite(o.timeS, 'Time since final deposition s', 0, 3600); finite(o.timeUncertaintyS, 'Time uncertainty s'); finite(o.xMm, 'X mm', 0, r.legacy.pathLengthMm);
    if (!Number.isInteger(o.layer) || o.layer < 1 || o.layer > r.geometry.layers) throw new Error('Invalid measurement layer');
    if (!Array.isArray(o.evidenceIds) || !o.evidenceIds.length || o.evidenceIds.some(id => !ids.has(id))) throw new Error('Observation requires resolvable evidence');
  }
  if ((r.status === 'planned' && (r.observations.length || r.legacy.status === 'measured')) || (r.status === 'measured' && !r.observations.length)) throw new Error('Trial status conflicts with raw measurements');
  if (r.status === 'measured' && (r.legacy.nozzleDiameterMm === null || ['unmeasured', ''].includes(r.legacy.materialBatch) || r.legacy.machineProfile === 'unconfigured')) throw new Error('Measured trial requires batch, machine and nozzle');
  return structuredClone(r);
}
// Research commands only. No printer dialect, origin, startup or shutdown is implied.
export function trialCommands(r: PhysicalTrial): MotionCommand[] {
  validateTrial(r);
  const s = trialSettings(r), commands: MotionCommand[] = []; let time = 0;
  const add = (start: MotionCommand['start'], end: MotionCommand['end'], layerId: number, feedMm3S: number, kind: MotionCommand['kind']) => {
    const endTimeS = time + Math.hypot(...end.map((v, i) => v - start[i])) / s.speedMmS;
    commands.push({startTimeS: time, endTimeS, start, end, layerId, feedMm3S, kind}); time = endTimeS;
  };
  for (let layer = 1; layer <= r.geometry.layers; layer++) {
    const z = s.clearanceMm + (layer - 1) * s.heightMm, gap = layer === 1 ? r.geometry.interruptionMm : 0;
    if (layer > 1) add(commands.at(-1)!.end, [0, 0, z], layer, 0, 'travel');
    const cuts = gap ? [0, (s.lengthMm - gap) / 2, (s.lengthMm + gap) / 2, s.lengthMm] : [0, s.lengthMm];
    for (let i = 1; i < cuts.length; i++) add([cuts[i - 1], 0, z], [cuts[i], 0, z], layer, gap && i === 2 ? 0 : s.feedMm3S, 'deposit');
  }
  return commands;
}
export function compareTrial(r: PhysicalTrial) {
  const commands = trialCommands(r), settings = trialSettings(r), response = simulateResponse(commands, ILLUSTRATIVE_PROFILE);
  const material = beadDeposition(response, settings), history = buildSupportHistory(material, settings.clearanceMm), diagnostics = depositionDiagnostics(commands, material, ILLUSTRATIVE_PROFILE);
  const endS = commands.at(-1)!.endTimeS;
  const rows = r.observations.map(o => {
    const e = history.elements.find(e => e.layerId === o.layer && o.xMm >= e.footprint.start[0] && o.xMm < e.footprint.end[0]);
    let predictedMm: number | null = null;
    if (o.method === 'local-section-v1' && e && o.metric === 'width') predictedMm = e.widthMm;
    if (o.method === 'local-section-v1' && e && o.metric === 'height') predictedMm = e.heightMm;
    if (o.method === 'nominal-centre-displacement-v1' && e && o.metric === 'sag') predictedMm = materialAt(e, endS + o.timeS).sagMm;
    if (o.method === 'flow-threshold-0.05-v1' && o.metric === 'gap' && o.layer === 1) predictedMm = diagnostics.gaps[0]?.thresholdGapMm ?? (r.geometry.interruptionMm === 0 ? 0 : null);
    return {...o, predictedMm, residualMm: predictedMm === null ? null : predictedMm - o.value};
  });
  return {kind: 'illustrative-prediction' as const, profile: {...ILLUSTRATIVE_PROFILE}, sagParameters: {...SAG_PARAMETERS}, sampleStepS: 0.02, timeOrigin: 'end of final deposition command', rows};
}
