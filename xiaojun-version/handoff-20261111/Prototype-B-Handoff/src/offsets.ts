/** Layer-coordinate errors on a copied canonical path; no mesh-only displacement. */
import {geometryToToolpath} from "./geometry.ts";
import type {GeometryResult} from "./geometry.ts";
import type {Move,Toolpath,XYZ} from "./toolpath.ts";
import {TOOLPATH_CONVENTIONS} from "./toolpath.ts";
import {validateGeneratedContours} from "./geometryValidation.ts";
import {MACHINE,requireBuildVolume} from "./machine.ts";
import {beadBuffers} from "./claySurface.ts";

export type OffsetMode="sudden"|"local"|"combined";
export type XY=readonly [number,number];
export type OffsetEvent=Readonly<{id:string;type:"sudden"|"local";startLayerId:number;endLayerIdExclusive:number;displacementMm:XY}>;
export const OFFSET_CALIBRATION=Object.freeze({version:"1.1.0",maximumSlots:3,minimumStableFraction:.12,
 minimumLayersPerFullSlot:10,singleSlotBandFraction:.15,
 minimumBeadWidths:.15,additionalBeadWidths:.6,maximumLocalLayers:10});

export async function simulateOffsets(source:GeometryResult,mode:OffsetMode,intensity:number,seed:number){
 if(!["sudden","local","combined"].includes(mode))throw new Error("Unknown Layer Offsets mode.");
 if(!Number.isFinite(intensity)||intensity<0||intensity>1)throw new Error("Offsets intensity must be within [0,1].");
 if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error("Failure seed must be an unsigned 32-bit integer.");
 const original=geometryToToolpath(source);validateGeneratedContours(original);
 const envelope=requireBuildVolume(original.moves,original.buildVolume.safetyMarginMm),count=original.contours.length;
 const first=Math.max(1,Math.floor(count*OFFSET_CALIBRATION.minimumStableFraction)),available=count-first-1;
 const slots=Math.max(0,Math.min(OFFSET_CALIBRATION.maximumSlots,Math.floor(available/3),
  Math.max(1,Math.floor(available/OFFSET_CALIBRATION.minimumLayersPerFullSlot))));
 const singleSlot=slots===1;
 const active=intensity?Math.min(slots,1+Math.floor(2*intensity)):0;
 const singleSlotBandLimit=Math.max(1,Math.floor(count*OFFSET_CALIBRATION.singleSlotBandFraction));
 const localLayers=singleSlot?Math.max(1,Math.ceil(singleSlotBandLimit*intensity)):
  1+Math.floor((OFFSET_CALIBRATION.maximumLocalLayers-1)*intensity);
 const magnitude=intensity?original.parameters.beadWidthMm*(OFFSET_CALIBRATION.minimumBeadWidths+OFFSET_CALIBRATION.additionalBeadWidths*intensity):0;
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const heading=random()*Math.PI*2,requested:OffsetEvent[]=[];
 for(let slot=0;slot<slots;slot++){
  const start=first+Math.floor(slot*available/slots),end=first+Math.floor((slot+1)*available/slots);
  const suddenAngle=heading+(random()-.5)*Math.PI/4,localAngle=random()*Math.PI*2;
  if(slot>=active)continue;
  const add=(type:OffsetEvent["type"],begin:number,finish:number,angle:number)=>requested.push({
   id:`offset-${seed}-${type}-${slot}`,type,startLayerId:begin,endLayerIdExclusive:finish,
   displacementMm:[magnitude*Math.cos(angle),magnitude*Math.sin(angle)]});
  // Separate the persistent step and the temporary band in a one-slot print.
  const span=end-start;
  const shiftLayer=singleSlot?Math.min(end-3,start+Math.floor(span/3)):start;
  if(mode!=="local")add("sudden",shiftLayer,count,suddenAngle);
  if(mode!=="sudden"){
   const begin=singleSlot?Math.min(end-2,start+Math.floor(2*span/3)):start+(mode==="combined"?1:0);
   add("local",begin,Math.min(end-1,begin+localLayers),localAngle);
  }
 }
 const requestedLayers=original.contours.map(c=>requested.reduce((xy,e)=>
  c.layerId>=e.startLayerId&&c.layerId<e.endLayerIdExclusive?[xy[0]+e.displacementMm[0],xy[1]+e.displacementMm[1]]:xy,[0,0]));
 const maximumRequested=Math.max(0,...requestedLayers.map(xy=>Math.hypot(...xy)));
 const clearance=Math.max(0,MACHINE.diameterMm/2-envelope.safetyMarginMm-Math.max(envelope.nozzle.radiusMm,envelope.deposited.radiusMm));
 const scale=maximumRequested?Math.min(1,clearance/maximumRequested):1;
 if(requested.length&&scale<1e-6)throw new Error("No radial clearance for Layer Offsets inside the configured safety margin.");
 const events=Object.freeze(requested.map(e=>Object.freeze({...e,displacementMm:Object.freeze(e.displacementMm.map(v=>v*scale)) as XY})));
 const layers=Object.freeze(requestedLayers.map((xy,layerId)=>Object.freeze({layerId,displacementMm:Object.freeze(xy.map(v=>v*scale)) as XY})));
 const shift=(p:XYZ,layerId:number):XYZ=>[p[0]+layers[layerId].displacementMm[0],p[1]+layers[layerId].displacementMm[1],p[2]];
 let path:Toolpath=original,travelBoundaries=0;
 if(events.length){
  const contours=original.contours.map(c=>({...c,points:c.points.map(p=>shift(p,c.layerId))}));
  const moves:Move[]=[];let durationS=0,lengthMm=0;
  const add=(m:Move,start:XYZ,end:XYZ,travel=false)=>{
   const length=Math.hypot(...end.map((v,k)=>v-start[k]));if(length<1e-10)return;
   const feedrate=travel?TOOLPATH_CONVENTIONS.travelFeedrateMmMin:m.feedrateMmMin;
   const next={...m,start,end,kind:travel?"travel" as const:m.kind,extrude:travel?false:m.extrude,
    feedrateMmMin:feedrate,lengthMm:length,startTimeS:durationS,endTimeS:durationS+length*60/feedrate};
   const offset=layers[m.layerId].displacementMm;
   if(m.kind==="deposition"&&(offset[0]||offset[1]))next.contourOffsetXY=offset;
   moves.push(next);durationS=next.endTimeS;lengthMm+=length;
  };
  for(const m of original.moves){
   const start=shift(m.start,m.kind==="transition"?m.layerId-1:m.layerId),end=shift(m.end,m.layerId);
   if(m.kind==="transition"&&Math.hypot(...layers[m.layerId].displacementMm.map((v,k)=>v-layers[m.layerId-1].displacementMm[k]))>1e-9){
    // Explicit lift / traverse / lower: never deposit an artificial diagonal bridge.
    const z=Math.min(MACHINE.heightMm-envelope.safetyMarginMm,Math.max(start[2],end[2])+TOOLPATH_CONVENTIONS.clearanceMm);
    const up:XYZ=[start[0],start[1],z],across:XYZ=[end[0],end[1],z];
    add(m,start,up,true);add(m,up,across,true);add(m,across,end,true);travelBoundaries++;
   }else add(m,start,end);
  }
  if(moves.length>200000)throw new Error("Offsets exceed the 200000-move interactive limit.");
  path={...original,contours,moves,durationS,lengthMm,buildVolume:requireBuildVolume(moves,envelope.safetyMarginMm)};
 }
 const material=beadBuffers(path);
 // Check actual rendered vertices as well as the conservative swept command envelope.
 for(let i=0;i<material.positions.length;i+=3){const p=material.positions;
  if(![p[i],p[i+1],p[i+2]].every(Number.isFinite)||Math.hypot(p[i]-MACHINE.centreXY[0],p[i+1]-MACHINE.centreXY[1])>MACHINE.diameterMm/2-envelope.safetyMarginMm+1e-5||p[i+2]<MACHINE.surfaceZMm-1e-5||p[i+2]>MACHINE.heightMm-envelope.safetyMarginMm+1e-5)
   throw new Error("Offset material exceeds the cylindrical build volume.");
 }
 const metrics=Object.freeze({eventCount:events.length,affectedLayerCount:layers.filter(l=>Math.hypot(...l.displacementMm)>1e-9).length,
  maximumDisplacementMm:Math.max(0,...layers.map(l=>Math.hypot(...l.displacementMm))),requestedEventMagnitudeMm:magnitude,
  requestedLocalLayers:localLayers,clearanceScale:scale,travelBoundaries});
 const warnings=Object.freeze([...(intensity&&!slots?["Too few layers for separated offset events and stable recovery regions."]:[]),
  ...(scale<1?[`Offsets constrained to ${(scale*100).toFixed(2)}% of requested displacement by the cylindrical safety envelope.`]:[]),
  ...(events.length?["Layer registration errors may reduce support or cause nozzle collisions. Travel clearance is geometric, not collision-verified; physical printability is unverified."]:[])]);
 const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([source.geometryId,source.printing,envelope.safetyMarginMm,OFFSET_CALIBRATION,mode,intensity,seed])));
 return Object.freeze({operator:"layer-offset" as const,version:"1.0.0",sourceGeometryId:source.geometryId,
  derivedId:`gof-offsets-1.0.0-${Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("")}`,
  mode,intensity,seed,calibration:OFFSET_CALIBRATION,events,layers,path,material,metrics,warnings});
}
export type OffsetsResult=Awaited<ReturnType<typeof simulateOffsets>>;
