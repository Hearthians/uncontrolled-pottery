import {geometryToToolpath} from "./geometry.ts";
import type {GeometryResult} from "./geometry.ts";
import {beadBuffers} from "./claySurface.ts";
import {analyzeSupport,SUPPORT_CALIBRATION} from "./support.ts";
import {EXPRESSIVE_CALIBRATION,INSTABILITY_CALIBRATION,expressiveDeposition,unstableDeposition} from "./saggingInstability.ts";
import type {SupportResult,SupportResponse} from "./support.ts";

export type SaggingMode = "reactive" | "expressive" | "combined";

export const SAGGING_CALIBRATION=Object.freeze({
 version:"1.3.0",minimumCoverageThreshold:.67,maximumCoverageThreshold:.8,
 minimumSelectionRate:.3,secondaryIntensity:.75,weakCoverage:.45,
 droopHeights:1.5,strandHeights:3.4,slumpHeights:2.5,
 strandMinWidths:2,strandMaxWidths:6,maximumStrands:3,maxSlope:1.25,
});

export async function simulateSagging(source:GeometryResult,intensity:number,seed:number,mode: SaggingMode | boolean = true){
 if(!Number.isFinite(intensity)||intensity<0||intensity>1)throw new Error("Sagging intensity must be within [0,1].");
 if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error("Failure seed must be an unsigned 32-bit integer.");
 if(typeof mode!=="boolean"&&!["reactive","expressive","combined"].includes(mode))throw new Error("Unknown Sagging mode.");
 const expressive=mode==="expressive"||mode==="combined";
 const nominalPath=geometryToToolpath(source),calibration=SAGGING_CALIBRATION;
 let path=nominalPath;
 const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([
  source.geometryId,source.printing,path.buildVolume.safetyMarginMm,SUPPORT_CALIBRATION,calibration,INSTABILITY_CALIBRATION,EXPRESSIVE_CALIBRATION,intensity,seed,mode,
 ])));
 const derivedId=`gof-sagging-${calibration.version}-${Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")}`;
 const proposed=new Map<number,"droop"|"strand"|"slump"|"expressive">();
 let strandCandidates=0;
 let instability:ReturnType<typeof unstableDeposition>|undefined;
 const response:SupportResponse={
  coverageThreshold:calibration.minimumCoverageThreshold+intensity*(calibration.maximumCoverageThreshold-calibration.minimumCoverageThreshold),
  maxSlope:calibration.maxSlope,
  profile(region,coverage,move,anchors){
   // Spatially stable selection by span start. No random deformation on supported beads.
   const mixed=Math.imul(region.firstMove+1,0x9e3779b1)^seed;
   const roll=(Math.imul(mixed^(mixed>>>16),0x85ebca6b)>>>0)/4294967296;
   const selection=calibration.minimumSelectionRate+(1-calibration.minimumSelectionRate)*intensity;
   const disturbed=instability?.events.some(event=>event.firstMove<=region.lastMove&&event.lastMove>=region.firstMove);
   if(expressive&&disturbed){
    proposed.set(region.firstMove,"expressive");
    // Catenary scale a = tension / weight per unit length, expressed in mm.
    // The dimensionless load proxy weights intensity by measured support loss.
    const gravityLoad=intensity*(1-coverage);
    const a=EXPRESSIVE_CALIBRATION.tensionWidths*move.beadWidthMm/gravityLoad;
    const spanRatio=Math.min(3,region.lengthMm/(2*a));
    const coshOffset=2*Math.sinh(spanRatio/2)**2;
    const shallow=spanRatio<1e-6;
    const depth=shallow?region.lengthMm*(region.lengthMm/a)/8:a*coshOffset;
    const amplitudeMm=Math.min(depth,EXPRESSIVE_CALIBRATION.dropHeights*move.beadHeightMm);
    return {amplitudeMm,power:2,maximumStretch:EXPRESSIVE_CALIBRATION.maximumSettledStretch,
     curve(t){
      const u=Math.max(0,Math.min(1,Math.min(t,1-t)/EXPRESSIVE_CALIBRATION.anchorTaperFraction));
      const catenary=shallow?4*t*(1-t):2*Math.sinh(spanRatio*t)*Math.sinh(spanRatio*(1-t))/coshOffset;
      return catenary*u*u*(3-2*u);
     }};
   }
   if(mode==="expressive"||(roll>=selection&&!disturbed))return;
   const spanWidths=region.lengthMm/move.beadWidthMm;
   const weak=intensity>=calibration.secondaryIntensity&&coverage<=calibration.weakCoverage;
   const strand=weak&&anchors.start&&anchors.end&&spanWidths>=calibration.strandMinWidths&&spanWidths<calibration.strandMaxWidths&&strandCandidates<calibration.maximumStrands;
   const slump=weak&&spanWidths>=calibration.strandMaxWidths;
   if(strand)strandCandidates++;
   proposed.set(region.firstMove,strand?"strand":slump?"slump":"droop");
   const cap=(strand?calibration.strandHeights:slump?calibration.slumpHeights:calibration.droopHeights)*move.beadHeightMm;
   const tail=(mode==="reactive"||mode==="combined")&&anchors.start!==anchors.end?
    (anchors.start?"end":"start"):undefined;
   return {amplitudeMm:intensity*(1-coverage)*Math.min(cap,.4*region.lengthMm),power:strand?4:2,tail};
  },
 };
 const natural=intensity?analyzeSupport(nominalPath,[],source.geometryId,derivedId,mode!=="expressive",response):undefined;
 const diagnosticsFor=(result:SupportResult|undefined)=>{
  const stages=result?.regionClearance??[],byMove=new Map(stages.map(stage=>[stage.firstMove,stage]));
  const candidates=(result?.regions??[]).map(region=>Object.freeze({...region,clearance:byMove.get(region.firstMove)??null}));
  const zero=1e-6;
  return Object.freeze({weakSupportSamples:result?.weakSupportSamples??0,selected:stages.length,
   rejected:Object.freeze({selection:candidates.length-stages.length,
    sampledProfile:stages.filter(s=>s.proposedPeakMm<=zero).length,
    bed:stages.filter(s=>s.proposedPeakMm>zero&&s.afterBedMm<=zero).length,
    contact:stages.filter(s=>s.afterBedMm>zero&&s.afterContactMm<=zero).length,
    slope:stages.filter(s=>s.afterContactMm>zero&&s.afterSlopeMm<=zero).length}),
   committed:stages.filter(s=>s.afterSlopeMm>zero).length,candidates:Object.freeze(candidates)});
 };
 const nominalDiagnostics=diagnosticsFor(natural);
 let support=natural;
 if(expressive&&natural){
  const settled=new Set(natural.regionClearance?.filter(region=>region.afterSlopeMm>1e-6).map(region=>region.firstMove));
  instability=expressiveDeposition(nominalPath,natural.segments,natural.regions.filter(region=>settled.has(region.firstMove)),intensity,seed);
 }else if(mode===true&&natural?.regions.length&&natural.metrics.maximumDisplacementMm<
    nominalPath.parameters.layerHeightMm*INSTABILITY_CALIBRATION.minimumVisibleDropHeights){
  instability=unstableDeposition(nominalPath,natural.regions,intensity,seed);
 }
 if(instability?.events.length){
  path=instability.path;proposed.clear();strandCandidates=0;
  support=analyzeSupport(path,[],source.geometryId,derivedId,true,response);
 }
 const segments=support?.segments??Object.freeze([]);
 const regions=(support?.regions??[]).flatMap(region=>{
  const candidate=proposed.get(region.firstMove);
  if(!candidate)return [];
  let maximumDropMm=0,deformedMoves=0;
  for(let i=region.firstMove;i<=region.lastMove;i++){
   const segment=segments[i];
   if(!segment)continue;
   const drop=Math.max(segment.startDropMm,segment.endDropMm);
   maximumDropMm=Math.max(maximumDropMm,drop);
   if(drop>1e-6)deformedMoves++;
  }
  if(!deformedMoves)return [];
  const height=path.moves[region.firstMove].beadHeightMm;
  const effect=candidate==="expressive"?"expressive":candidate==="strand"&&maximumDropMm>=.8*height?"strand":
   candidate==="slump"&&deformedMoves>=3&&maximumDropMm>=.55*height?"slump":"droop";
  return [Object.freeze({...region,effect,maximumDropMm,deformedMoves})];
 });
 const expressiveEvents=expressive?(instability?.events??[]).map(event=>{
  let maximumDropMm=0,settledLengthMm=0;
  for(let i=event.firstMove;i<=event.lastMove;i++){
   const move=path.moves[i],segment=segments[i];
   const startDrop=segment?.startDropMm??0,endDrop=segment?.endDropMm??0;
   maximumDropMm=Math.max(maximumDropMm,startDrop,endDrop);
   settledLengthMm+=Math.hypot(move.end[0]-move.start[0],move.end[1]-move.start[1],move.end[2]-move.start[2]+startDrop-endDrop);
  }
  const height=path.moves[event.firstMove].beadHeightMm;
  const overlappingStarts=new Set(support?.regions.filter(region=>
   region.firstMove<=event.lastMove&&region.lastMove>=event.firstMove).map(region=>region.firstMove));
  return Object.freeze({...event,style:"hanging-loop" as const,anchors:"nominal shoulders" as const,
   targetDropMm:Math.max(0,...(support?.regionClearance??[]).filter(stage=>
    overlappingStarts.has(stage.firstMove)).map(stage=>stage.proposedPeakMm)),
   maximumDropMm,settledLengthMm,
   hangingLoop:maximumDropMm>=.5*height});
 }):[];
 const metrics=Object.freeze({regions:regions.length,weakRegions:support?.regions.length??0,
  reactiveRegions:regions.filter(region=>region.effect!=="expressive").length,
  expressiveEvents:expressiveEvents.length,hangingLoops:expressiveEvents.filter(event=>event.hangingLoop).length,
  affectedLayers:new Set(regions.map(region=>region.layerId)).size,
  maximumDropMm:support?.metrics.maximumDisplacementMm??0,
  hangingStrands:regions.filter(region=>region.effect==="strand").length,
  slumps:regions.filter(region=>region.effect==="slump").length,
  deformedSegments:support?.metrics.deformedSegments??0,triangleQueries:support?.metrics.triangleQueries??0});
 return Object.freeze({operator:"sagging" as const,version:calibration.version,sourceGeometryId:source.geometryId,
  derivedId,mode:mode===true?"activation":mode===false?"reactive":mode,intensity,seed,calibration,expressiveEvents:Object.freeze(expressiveEvents),nominalPath,path,segments,regions:Object.freeze(regions),metrics,
  instability:Object.freeze({calibration:expressive?EXPRESSIVE_CALIBRATION:INSTABILITY_CALIBRATION,enabled:expressive||mode===true,events:instability?.events??Object.freeze([]),
   diagnostics:instability?.diagnostics??null}),
  diagnostics:Object.freeze({nominal:nominalDiagnostics,executed:support===natural?nominalDiagnostics:diagnosticsFor(support)}),
  material:beadBuffers(path,undefined,intensity?segments:undefined)});
}

export type SaggingResult=Awaited<ReturnType<typeof simulateSagging>>;
