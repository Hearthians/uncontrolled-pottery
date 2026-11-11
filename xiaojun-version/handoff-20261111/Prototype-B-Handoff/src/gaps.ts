/** Commanded interruptions only: no change to canonical geometry or nozzle trajectory. */
import {geometryToToolpath} from "./geometry.ts";
import type {GeometryResult, DeepReadonly} from "./geometry.ts";
import {createGeometryManifest} from "./serialization.ts";
import {validateFailureSchedule} from "./failureSchedule.ts";
import {validateGeneratedContours} from "./geometryValidation.ts";
import {requireBuildVolume} from "./machine.ts";
import type {Move, Toolpath, XYZ} from "./toolpath.ts";

export type GapSettings = Readonly<{version:"1.0.0";spacingMm:number;minLengthMm:number;maxLengthMm:number}>;
export const GAP_CALIBRATION:GapSettings = Object.freeze({version:"1.0.0",spacingMm:6,minLengthMm:1.5,maxLengthMm:3});
export type GapEvent = Readonly<{layerId:number;candidateId:number;startMm:number;endMm:number;intensity:number}>;
export type GapResult = DeepReadonly<{
  sourceGeometryId:string; derivedId:string; failureType:"gaps"; seed:number; settings:GapSettings;
  appliedIntensities:{layerId:number;intensity:number}[]; events:GapEvent[]; toolpath:Toolpath;
  metrics:{eventCount:number;interruptedLayers:number;interruptedLengthMm:number;intendedExtrusionLengthMm:number;
    missingDepositionRatio:number;averageGapLengthMm:number;maximumGapLengthMm:number};
  validation:{status:"valid-with-warnings";warnings:string[]};
}>;
function freeze<T>(value:T):DeepReadonly<T> {
  if(value && typeof value==="object" && !Object.isFrozen(value)) {
    Object.freeze(value);for(const child of Object.values(value))freeze(child);
  }
  return value as DeepReadonly<T>;
}
/** Throws on unsupported schedules, invalid calibration, or derived path constraints. */
export async function applyGaps(source:GeometryResult, schedule:unknown, seed:number, settings:GapSettings=GAP_CALIBRATION):Promise<GapResult> {
  if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error("Failure seed must be an unsigned 32-bit integer.");
  if(settings.version!=="1.0.0" || Object.keys(settings).some(k=>!Object.hasOwn(GAP_CALIBRATION,k)) ||
    ![settings.spacingMm,settings.minLengthMm,settings.maxLengthMm].every(Number.isFinite) || settings.minLengthMm<=0 ||
    settings.maxLengthMm<settings.minLengthMm || settings.spacingMm<settings.maxLengthMm*2 || settings.spacingMm<1)
    throw new Error("Invalid gap calibration: spacing must be at least twice maximum gap length and at least 1 mm.");
  const checked=validateFailureSchedule(schedule,createGeometryManifest(source));
  if(!checked.ok)throw new Error(checked.errors.join(" "));
  if(checked.schedule.entries.some(e=>e.failureType!=="stable" && e.failureType!=="gaps"))
    throw new Error("Gaps operator supports only gaps and stable entries; multi-failure composition is unsupported.");
  const path=geometryToToolpath(source);
  validateGeneratedContours(path);requireBuildVolume(path.moves,path.buildVolume.safetyMarginMm);
  const appliedIntensities=checked.assignments.map(a=>({layerId:a.layerId,intensity:a.failures.find(f=>f.failureType==="gaps")?.intensity??0}));
  const events:GapEvent[]=[],byLayer:GapEvent[][]=path.contours.map(()=>[]);
  for(const {layerId,intensity} of appliedIntensities) {
    const length=source.descriptor.layers[layerId].contourLengthMm;
    let state=(seed ^ Math.imul(layerId+1,0x9e3779b1))>>>0;
    // Avalanche the layer key so neighbouring layers do not share correlated first draws.
    state=Math.imul(state^(state>>>16),0x7feb352d);
    state=Math.imul(state^(state>>>15),0x846ca68b);
    state=(state^(state>>>16))>>>0;
    const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
    const count=Math.floor(length/settings.spacingMm*(.8+.2*random())),cell=length/Math.max(1,count);
    for(let i=0;i<count;i++) {
      const threshold=.05+.9*random(),centre=(i+.27+.46*random())*cell;
      const size=settings.minLengthMm+(settings.maxLengthMm-settings.minLengthMm)*random();
      if(intensity<threshold)continue;
      const event={layerId,candidateId:i,startMm:centre-size/2,endMm:centre+size/2,intensity};
      events.push(event);byLayer[layerId].push(event);
    }
  }
  const moves:Move[]=[],offsets=path.contours.map(()=>0),cursors=path.contours.map(()=>0);
  for(const move of path.moves) {
    if(move.kind!=="deposition" || !byLayer[move.layerId].length) {moves.push(move);continue;}
    const layer=move.layerId,a=offsets[layer],b=a+move.lengthMm;offsets[layer]=b;
    const gaps=byLayer[layer];while(cursors[layer]<gaps.length && gaps[cursors[layer]].endMm<=a)cursors[layer]++;
    const cuts=[a,b];
    for(let j=cursors[layer];j<gaps.length&&gaps[j].startMm<b;j++)
      for(const cut of [gaps[j].startMm,gaps[j].endMm])if(cut>a+1e-9&&cut<b-1e-9)cuts.push(cut);
    cuts.sort((x,y)=>x-y);
    let start=move.start,startTimeS=move.startTimeS;
    for(let i=1;i<cuts.length;i++) {
      const fraction=(cuts[i]-a)/move.lengthMm;
      const end:XYZ=i===cuts.length-1?move.end:move.start.map((v,k)=>v+(move.end[k]-v)*fraction) as unknown as XYZ;
      const endTimeS=i===cuts.length-1?move.endTimeS:move.startTimeS+(move.endTimeS-move.startTimeS)*fraction;
      const mid=(cuts[i-1]+cuts[i])/2;
      while(cursors[layer]<gaps.length && gaps[cursors[layer]].endMm<=mid)cursors[layer]++;
      const gap=gaps[cursors[layer]],off=!!gap && mid>=gap.startMm && mid<gap.endMm;
      moves.push({...move,start,end,startTimeS,endTimeS,lengthMm:Math.hypot(...end.map((v,k)=>v-start[k])),
        kind:off?"travel":"deposition",extrude:!off});
      start=end;startTimeS=endTimeS;
    }
    if(moves.length>200000)throw new Error("Derived path exceeds 200000 segments; reduce geometry complexity.");
  }
  if(moves.length>200000)throw new Error("Derived path exceeds 200000 segments; reduce geometry complexity.");
  path.moves=moves;path.buildVolume=requireBuildVolume(moves,path.buildVolume.safetyMarginMm);validateGeneratedContours(path);
  const interruptedLengthMm=events.reduce((sum,e)=>sum+e.endMm-e.startMm,0);
  const intendedExtrusionLengthMm=source.toolpath.moves.reduce((sum,m)=>sum+(m.extrude?m.lengthMm:0),0);
  const payload={sourceGeometryId:source.geometryId,failureType:"gaps" as const,seed,settings:{...settings},appliedIntensities,
    events,toolpath:path,metrics:{eventCount:events.length,interruptedLayers:byLayer.filter(e=>e.length).length,
      interruptedLengthMm,intendedExtrusionLengthMm,missingDepositionRatio:interruptedLengthMm/intendedExtrusionLengthMm,
      averageGapLengthMm:events.length?interruptedLengthMm/events.length:0,
      maximumGapLengthMm:events.reduce((max,e)=>Math.max(max,e.endMm-e.startMm),0)},
    validation:{status:"valid-with-warnings" as const,warnings:[...source.validation.warnings.map(w=>w.message),
      "Commanded missing deposition, not predicted physical material loss. Support and flow dynamics are not simulated.",
      "Extruding layer transitions and a short contour-seam guard remain unchanged."]}};
  const identity=JSON.stringify([source.geometryId,source.printing,source.validation.buildVolume.safetyMarginMm,
    seed,settings.version,settings.spacingMm,settings.minLengthMm,settings.maxLengthMm,appliedIntensities]);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity));
  return freeze({...payload,derivedId:`gof-gaps-1.0.0-${Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")}`});
}
/** Copy only when handing a derived snapshot to mutable legacy rendering/playback. */
export function gapResultToToolpath(result:GapResult):Toolpath {return structuredClone(result.toolpath) as Toolpath;}
