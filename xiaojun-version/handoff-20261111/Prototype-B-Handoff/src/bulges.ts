/** Digital dwell/flow model. No machine extrusion commands or canonical path edits. */
import {geometryToToolpath} from "./geometry.ts";
import type {GeometryResult} from "./geometry.ts";
import {sampleToolpath} from "./toolpath.ts";
import type {XYZ,PathSample} from "./toolpath.ts";
import {validateGeneratedContours} from "./geometryValidation.ts";
import {requireBuildVolume} from "./machine.ts";
import {buildSwelling,SWELLING_CALIBRATION} from "./beadSwelling.ts";
export const BULGE_CALIBRATION=Object.freeze({version:"1.0.0",spacingMm:40,layerProbability:.45,
 extraBeadWidths:2.5,flowMultiplier:1,tangentAspect:1.4,verticalHeightFraction:.45,maxEvents:4000});
export type BulgeCalibration=typeof BULGE_CALIBRATION;
export type BulgeEvent=Readonly<{id:string;layerId:number;moveIndex:number;arcLengthMm:number;pathTimeS:number;
 position:XYZ;tangent:XYZ;dwellS:number;flowMm3S:number;flowMultiplier:number;extraVolumeMm3:number;
 startTimeS:number;endTimeS:number;widthMm:number;heightMm:number}>;
export type BulgeInstruction=Readonly<{kind:"motion"|"dwell";startTimeS:number;endTimeS:number;pathStartS:number;pathEndS:number;eventIndex?:number}>;
export async function simulateBulges(source:GeometryResult,intensity:number,seed:number,calibration:BulgeCalibration=BULGE_CALIBRATION){
 if(!Number.isFinite(intensity)||intensity<0||intensity>1)throw new Error("Bulges intensity must be within [0,1].");
 if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error("Failure seed must be an unsigned 32-bit integer.");
 if(JSON.stringify(calibration)!==JSON.stringify(BULGE_CALIBRATION))throw new Error("Unsupported Bulges calibration; use version 1.0.0 defaults.");
 const path=geometryToToolpath(source);validateGeneratedContours(path);requireBuildVolume(path.moves,path.buildVolume.safetyMarginMm);
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const candidates:Omit<BulgeEvent,"startTimeS"|"endTimeS">[]=[],instructions:BulgeInstruction[]=[],events:BulgeEvent[]=[];
 const layers=path.contours.map(()=>[] as number[]);path.moves.forEach((m,i)=>{if(m.kind==="deposition")layers[m.layerId].push(i);});
 for(const contour of path.contours){
  const ids=layers[contour.layerId],length=source.descriptor.layers[contour.layerId].contourLengthMm;
  const active=random()<calibration.layerProbability,count=Math.max(1,Math.floor(length/calibration.spacingMm)),cell=length/count;
  for(let c=0;c<count;c++){
   const arc=(c+.2+.6*random())*cell,amount=.75+.5*random();
   if(!active||!intensity||arc<2*path.parameters.beadWidthMm||length-arc<2*path.parameters.beadWidthMm)continue;
   let start=0,index=ids[0];for(const i of ids){index=i;if(start+path.moves[i].lengthMm>=arc)break;start+=path.moves[i].lengthMm;}
   const m=path.moves[index],f=(arc-start)/m.lengthMm,tangent=m.end.map((v,k)=>(v-m.start[k])/m.lengthMm) as unknown as XYZ;
   const position=m.start.map((v,k)=>v+f*(m.end[k]-v)) as unknown as XYZ;
   const area=Math.PI*m.beadWidthMm*m.beadHeightMm/4,flow=area*m.feedrateMmMin/60;
   const extra=area*m.beadWidthMm*calibration.extraBeadWidths*amount*intensity;
   candidates.push({id:`bulge-${seed}-${m.layerId}-${c}`,layerId:m.layerId,moveIndex:index,arcLengthMm:arc,
    pathTimeS:m.startTimeS+f*(m.endTimeS-m.startTimeS),position:Object.freeze(position),tangent:Object.freeze(tangent),
    dwellS:extra/(flow*calibration.flowMultiplier),flowMm3S:flow,flowMultiplier:calibration.flowMultiplier,extraVolumeMm3:extra,widthMm:m.beadWidthMm,heightMm:m.beadHeightMm});
   if(candidates.length>calibration.maxEvents)throw new Error("Bulges event limit exceeded.");
  }
 }
 let clock=0,previous=0;
 for(const candidate of candidates){
  if(candidate.pathTimeS>previous){const end=clock+candidate.pathTimeS-previous;instructions.push(Object.freeze({kind:"motion",startTimeS:clock,endTimeS:end,pathStartS:previous,pathEndS:candidate.pathTimeS}));clock=end;}
  const event=Object.freeze({...candidate,startTimeS:clock,endTimeS:clock+candidate.dwellS});events.push(event);
  instructions.push(Object.freeze({kind:"dwell",startTimeS:clock,endTimeS:event.endTimeS,pathStartS:event.pathTimeS,pathEndS:event.pathTimeS,eventIndex:events.length-1}));
  clock=event.endTimeS;previous=event.pathTimeS;
 }
 instructions.push(Object.freeze({kind:"motion",startTimeS:clock,endTimeS:clock+path.durationS-previous,pathStartS:previous,pathEndS:path.durationS}));
 const {patches,material,displacementMetrics}=buildSwelling(path,events);
 const extra=events.reduce((n,e)=>n+e.extraVolumeMm3,0),dwell=events.reduce((n,e)=>n+e.dwellS,0);
 const metrics=Object.freeze({eventCount:events.length,totalExtraVolumeMm3:extra,meanExtraVolumeMm3:events.length?extra/events.length:0,
  maximumExtraVolumeMm3:Math.max(0,...events.map(e=>e.extraVolumeMm3)),totalDwellS:dwell,
  nominalVolumeMm3:path.moves.reduce((n,m)=>n+(m.extrude?Math.PI*m.beadWidthMm*m.beadHeightMm/4*m.lengthMm:0),0),
  ...displacementMetrics,volumeErrorMm3:patches.reduce((n,p)=>n+p.extraVolumeMm3,0)-extra,
  predictedExtraVolumeMm3:patches.reduce((n,p)=>n+p.extraVolumeMm3,0),maximumLocalThickeningMm:Math.max(0,...patches.map(p=>p.amplitudeMm*Math.max(...p.moves.flatMap(m=>[m.start,m.end])))),affectedLayers:new Set(events.map(e=>e.layerId)).size});
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([source.geometryId,source.printing,source.validation.buildVolume.safetyMarginMm,calibration,SWELLING_CALIBRATION,intensity,seed])));
 return Object.freeze({operator:"bulges" as const,version:"1.2.0",sourceGeometryId:source.geometryId,
  derivedId:`gof-bulges-1.2.0-${Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")}`,
  intensity,seed,calibration:BULGE_CALIBRATION,events:Object.freeze(events),instructions:Object.freeze(instructions),swellingCalibration:SWELLING_CALIBRATION,patches,material,
  durationS:path.durationS+dwell,metrics,warnings:Object.freeze([...source.validation.warnings.map(w=>w.message),
   "Nominal flow is a digital assumption; stationary extrusion capability is not verified for the physical WASP extruder.",
   ...(events.length?["Inward and outward accumulation may collide with neighboring beads or future nozzle paths; clearance and interlayer contact are not simulated."]:[]),
   "Added volume is measured against the polygonal bead sweep (1% tolerance per event); spreading, self-contact and interlayer interaction are not modeled.",
   ...(intensity>=.75?["High local accumulation may cause nozzle collision or unsupported material; envelope compliance is not proof of printability."]:[])])});
}
export type BulgesResult=Awaited<ReturnType<typeof simulateBulges>>;
export function bulgeProgress(event:BulgeEvent,time:number){return time>=event.endTimeS?1:time<=event.startTimeS?0:(time-event.startTimeS)/event.dwellS;}
export function bulgeTiming(path:ReturnType<typeof geometryToToolpath>,result:BulgesResult){return {durationS:result.durationS,sample(time:number):PathSample{
 const elapsedS=Math.max(0,Math.min(result.durationS,time));let lo=0,hi=result.instructions.length-1;
 while(lo<hi){const mid=(lo+hi)>>>1;if(result.instructions[mid].endTimeS<=elapsedS)lo=mid+1;else hi=mid;}
 const step=result.instructions[lo],f=(elapsedS-step.startTimeS)/(step.endTimeS-step.startTimeS);
 return {...sampleToolpath(path,step.pathStartS+(step.pathEndS-step.pathStartS)*f),elapsedS};
}};}
