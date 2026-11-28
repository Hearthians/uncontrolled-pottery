import {defaultConfig} from './behaviourConfig.ts';
import type {Params} from './behaviourConfig.ts';

export const studyLabels={
  controlled:'A · Controlled — calibration candidate',
  expressive:'B · Expressive — visual comparison',
  extreme:'C · Extreme — unvalidated for printing',
} as const;
export type Study=keyof typeof studyLabels;

const range=(low:readonly [number,number,number], high:readonly [number,number,number])=>{
  const params=([eventCount,coverage,amplitude]:typeof low):Params=>({eventCount,coverage,amplitude});
  return {low:params(low),high:params(high)};
};

// Temporary comparison endpoints use the regular score interpolation and seed.
export function comparisonConfig(study:Study){
  const c=defaultConfig();
  if(study==='controlled'){
    c.mappingRanges={
      gaps:range([3,10,.7],[5,18,.9]),buldges:range([2,26,1.5],[3,36,2.35]),
      misalignment:range([2,26,1],[3,35,2.2]),sagging:range([2,26,2.6],[5,36,4.7]),
    };
    c.simulationSettings={coherenceLayers:12,maxDropMm:4.5};c.patternSettings.sagging.slack=.15;
  }else if(study==='expressive'){
    c.mappingRanges={
      gaps:range([4,15,.85],[7,25,1]),buldges:range([2,28,2.1],[5,40,3.9]),
      misalignment:range([2,28,2.4],[5,40,4.7]),sagging:range([3,30,4],[6,40,6.4]),
    };
    c.simulationSettings={coherenceLayers:10,maxDropMm:7};c.patternSettings.sagging.slack=.22;
  }else{
    c.mappingRanges={
      gaps:range([8,30,1],[12,40,1]),buldges:range([6,32,3],[12,40,4]),
      misalignment:range([6,32,3.5],[12,40,5]),sagging:range([8,36,5.5],[12,40,6.5]),
    };
    c.simulationSettings={coherenceLayers:6,maxDropMm:8};
  }
  return c;
}
