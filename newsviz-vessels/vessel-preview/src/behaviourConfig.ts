import {DEFAULT_COHERENCE} from './materialPattern.ts';
import defaults from './annualBehaviors.json' with {type: 'json'};

export const failures = ['gaps', 'buldges', 'misalignment', 'sagging'] as const;
export type Failure = typeof failures[number];
export type Mode = 'Manual' | 'Data-driven';
export type Params = {eventCount: number; coverage: number; amplitude: number};
export type Config = {
  schemaVersion: 1; seed: number; calibrationStatus: 'visual-only';
  preview: {mode:Mode; behaviour:Failure};
  manualPresets: Record<Failure, Params>;
  mappingRanges: Record<Failure, {low: Params; high: Params}>;
  patternSettings: Record<Failure, {phase: number}> & {sagging:{phase:number; slack?:number; variation?:number}};
  simulationSettings: {maxDropMm: number; coherenceLayers?:number};
};
export const UI_LIMITS = {
  eventCount: [0,12,1], coverage: [0,40,0.1], phase: [0,360,1],
  gaps: [0,1,0.01], buldges: [1,4,0.01], misalignment: [0,5,0.05], sagging: [0,6.5,0.05],
} as const;
export const magnitude = {gaps:['Interrupted span','fraction'], buldges:['Deposition multiplier','×'], misalignment:['Offset distance','mm'], sagging:['Unsupported offset','mm']} as const;
export const names = {gaps:'Gaps', buldges:'Bulging', misalignment:'Misalignment', sagging:'Sagging'};
export const FOLD_DEFAULTS={slack:0.28,variation:0.75};
export const storageKey = 'prototype-c.annual.behaviour.v1';
function each<T>(make: (kind: Failure) => T) {
  return Object.fromEntries(failures.map(kind => [kind, make(kind)])) as Record<Failure,T>;
}
export function defaultConfig(legacy = defaults): Config {
  const mappingRanges = each(kind => {
    const rule = legacy[kind];
    if (!rule || !Number.isInteger(rule.minEvents) || !Number.isInteger(rule.maxEvents) || rule.minEvents < 1 || rule.maxEvents > 12 || rule.minEvents > rule.maxEvents ||
      ![rule.minIntensity,rule.maxIntensity].every(value => Number.isFinite(value) && value > 0 && value <= 1) || rule.minIntensity > rule.maxIntensity) throw Error('Invalid legacy behaviour limits.');
    const params = (eventCount:number, intensity:number): Params => ({eventCount, coverage:kind==='gaps'?8+10*intensity:20+16*intensity,
      amplitude:kind === 'gaps' ? 1 : kind === 'buldges' ? 1 + 3 * intensity : kind === 'sagging' ? 2.5 + 4 * intensity : 5 * intensity});
    return {low:params(rule.minEvents,rule.minIntensity), high:params(rule.maxEvents,rule.maxIntensity)};
  });
  return {schemaVersion:1, seed:42, preview:{mode:'Data-driven',behaviour:'sagging'}, calibrationStatus:'visual-only', mappingRanges, manualPresets:each(kind => ({...mappingRanges[kind].low})),
    patternSettings:{...each(() => ({phase:0})),sagging:{phase:0,...FOLD_DEFAULTS}}, simulationSettings:{maxDropMm:8,coherenceLayers:DEFAULT_COHERENCE}};
}

function keys(object:unknown, expected:readonly string[]) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).length !== expected.length || !expected.every(key => Object.hasOwn(object,key))) throw Error('Missing or unexpected configuration field: expected ' + expected.join(', ') + '.');
}
function check(value:number, min:number, max:number, label:string, integer=false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw Error(label + ' must be ' + (integer ? 'an integer ' : '') + 'in [' + min + ', ' + max + '].');
}
export function validateConfig(input:unknown): Config {
  keys(input,['schemaVersion','seed','calibrationStatus','preview','mappingRanges','manualPresets','patternSettings','simulationSettings']);
  const config = input as Config;
  if (config.schemaVersion !== 1 || config.calibrationStatus !== 'visual-only') throw Error('Expected schema version 1 and visual-only calibration.');
  keys(config.preview,['mode','behaviour']);
  if (!['Manual','Data-driven'].includes(config.preview.mode) || !failures.includes(config.preview.behaviour)) throw Error('Invalid preview selection.');
  check(config.seed,0,4294967295,'Seed',true);
  const simulation=config.simulationSettings;
  keys(simulation,simulation && Object.hasOwn(simulation,'coherenceLayers')?['maxDropMm','coherenceLayers']:['maxDropMm']);
  if (Object.hasOwn(simulation,'coherenceLayers')) check(simulation.coherenceLayers!,4,16,'Coherence',true);
  check(simulation.maxDropMm,0,16,'Simulation drop limit');
  for (const group of [config.manualPresets,config.mappingRanges,config.patternSettings]) keys(group,failures);
  for (const kind of failures) {
    const range = config.mappingRanges[kind], pattern = config.patternSettings[kind];
    const optional=kind==='sagging' && pattern ? (['slack','variation'] as const).filter(key=>Object.hasOwn(pattern,key)) : [];
    keys(pattern,['phase',...optional]); check(pattern.phase,0,360,'Phase');
    for(const key of optional) check(config.patternSettings.sagging[key]!,0,key==='slack'?1.5:1,key);
    keys(range,['low','high']);
    for (const params of [range.low, range.high, config.manualPresets[kind]]) {
      keys(params,['eventCount','coverage','amplitude']);
      for (const key of ['eventCount','coverage','amplitude'] as const) {
        const [min,max] = UI_LIMITS[key === 'amplitude' ? kind : key];
        check(params[key], min,max,key,key === 'eventCount');
      }
    }
    for (const key of ['eventCount','coverage','amplitude'] as const) if (range.high[key] < range.low[key]) throw Error(names[kind] + ': high ' + key + ' must be at least low ' + key + '. Adjust the endpoint first.');
  }
  return config;
}
export function scoreParams(score:number, config:Config, manual?:Failure) {
  const bin = Math.min(4,Math.floor(score * 5));
  if (bin === 0) return {behavior:'stable' as const, eventCount:0, coverage:0, amplitude:0};
  const behavior = failures[bin-1], {low,high} = config.mappingRanges[behavior];
  const fraction = Math.max(0,Math.min(1,score * 5 - bin));
  const mix = (key:keyof Params) => low[key] + (high[key] - low[key]) * fraction;
  return {behavior,...(manual === behavior ? config.manualPresets[behavior] : {eventCount:Math.round(mix('eventCount')),coverage:mix('coverage'),amplitude:mix('amplitude')})};
}
