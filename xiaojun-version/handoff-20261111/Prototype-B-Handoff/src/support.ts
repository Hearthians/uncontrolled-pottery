/** Layer-ordered gravity/contact approximation. Never modifies commanded moves. */
import type {Move,Toolpath} from "./toolpath.ts";
import type {ResiduePlan} from "./clayResidue.ts";
import {writeBead,beadBuffers,FLOATS_PER_MOVE,SIDES} from "./claySurface.ts";
import type {MaterialDisplacement} from "./claySurface.ts";
import {validateGeneratedContours} from "./geometryValidation.ts";
import {requireBuildVolume} from "./machine.ts";
import {DepositedSurface} from "./supportContact.ts";
import type {ContactLimit} from "./supportContact.ts";
import {accountMaterial} from "./materialAccounting.ts";
export const SUPPORT_CALIBRATION=Object.freeze({version:"1.2.0",coverageThreshold:.8,
 contactToleranceHeights:.2,adhesionToleranceMm:.002,shortSpanWidths:.75,mediumSpanWidths:1.75,
 shortDropHeights:.15,mediumSpanDropRatio:.4,longSpanDropRatio:.6,
 maxReachHeights:4,maxReachWidths:3,maxTriangleQueries:20000000});
export type SupportClass="plate"|"supported"|"short"|"medium"|"long"|"transition";
export type MaterialContact=Readonly<{move:number;layerId:number;gapMm:number;point:readonly number[]}>;
export type SupportSegment=MaterialDisplacement & Readonly<{sourceMove:number;layerId:number;coverage:number;finalCoverage:number;
 supportMoves:readonly number[];contacts:readonly MaterialContact[];classification:SupportClass;
 materialState:"supported"|"deformed"|"contacted"|"uncertain";uncertain:boolean}>;
export type SupportRegion=Readonly<{layerId:number;firstMove:number;lastMove:number;lengthMm:number;classification:"short"|"medium"|"long"}>;
export type SupportResult=ReturnType<typeof analyzeSupport>;
type RegionClearance = {
 firstMove:number;proposedPeakMm:number;afterBedMm:number;afterContactMm:number;afterSlopeMm:number;
};
export type SupportResponse = Readonly<{
 coverageThreshold:number;
 maxSlope:number;
 profile:(region:SupportRegion, coverage:number, move:Move, anchors:{start:boolean;end:boolean})=>
  {amplitudeMm:number; power:number; tail?:"start"|"end"; curve?:(t:number)=>number; maximumStretch?:number}|undefined;
}>;

/** Searches actual accumulated earlier surfaces. No loss/detachment rule is implemented. */
export function analyzeSupport(path:Toolpath,residue:ResiduePlan,sourceGeometryId:string,sourceDerivedId:string,enabled=true,response?:SupportResponse){
 if(path.moves.length>200000)throw new Error("Support analysis exceeds 200000 moves.");
 validateGeneratedContours(path);requireBuildVolume(path.moves,path.buildVolume.safetyMarginMm);
 const c=SUPPORT_CALIBRATION,index=new DepositedSurface(Math.max(1,path.parameters.beadWidthMm,path.parameters.layerHeightMm),c.maxTriangleQueries);
 const coverageThreshold=response?.coverageThreshold??c.coverageThreshold;
 const segments:(SupportSegment|undefined)[]=new Array(path.moves.length),regions:SupportRegion[]=[];
 const regionClearance:RegionClearance[]=[];
 const positions=new Float32Array(FLOATS_PER_MOVE),normals=new Float32Array(FLOATS_PER_MOVE);
 const drops=new Float64Array(path.moves.length+1),ends=Int32Array.from(path.moves,(_,i)=>i+1);
 const layers:number[][]=path.contours.map(()=>[]),coverageDistribution=[0,0,0,0,0],affected=new Set<number>();
 path.moves.forEach((m,i)=>{if(m.extrude)layers[m.layerId].push(i);});
 const reach=(i:number)=>path.moves[i].beadHeightMm*c.maxReachHeights+path.moves[i].beadWidthMm*c.maxReachWidths;
 const sampleContact=(i:number)=>{
  const m=path.moves[i],contacts=new Map<number,MaterialContact>();let hits=0,a=Infinity,b=Infinity,startWidth=0,endWidth=0;
  for(let k=0;k<SIDES;k++){
   a=Math.min(a,positions[k*3+2]);b=Math.min(b,positions[(SIDES+k)*3+2]);
   startWidth=Math.max(startWidth,Math.hypot(positions[k*3]-m.start[0],positions[k*3+1]-m.start[1]));
   endWidth=Math.max(endWidth,Math.hypot(positions[(SIDES+k)*3]-m.end[0],positions[(SIDES+k)*3+1]-m.end[1]));
  }
  for(const t of [.2,.5,.8])for(const side of [-.6,0,.6]){
   const x=m.start[0]+(m.end[0]-m.start[0])*t,y=m.start[1]+(m.end[1]-m.start[1])*t,r=Math.hypot(x,y);
   const width=startWidth+(endWidth-startWidth)*t,px=x+side*width*x/r,py=y+side*width*y/r,bottom=a+(b-a)*t;
   const hit=index.below(px,py,bottom,reach(i)),gap=bottom-hit.z;
   if(gap>=-1e-5&&gap<=m.beadHeightMm*c.contactToleranceHeights)hits++;
   if(Math.abs(gap)<=c.adhesionToleranceMm)contacts.set(hit.move,Object.freeze({move:hit.move,layerId:hit.layerId,gapMm:gap,point:Object.freeze([px,py,hit.z])}));
  }
  return {coverage:hits/9,contacts};
 };
 for(let layerId=0;layerId<layers.length;layerId++){
  const ids=layers[layerId],deposit=ids.filter(i=>path.moves[i].kind==="deposition"),firstDeposit=deposit[0],lastDeposit=deposit.at(-1);
  if(lastDeposit!==undefined&&path.moves[firstDeposit].start.every((v,j)=>v===path.moves[lastDeposit].end[j]))ends[lastDeposit]=firstDeposit;
  for(const i of ids){
   const m=path.moves[i];writeBead(m,1,positions,normals,0,residue[i]);
   const coverage=m.kind==="transition"?1:sampleContact(i).coverage;
   segments[i]={sourceMove:i,layerId,coverage,finalCoverage:coverage,supportMoves:[],contacts:[],startDropMm:0,endDropMm:0,
    classification:m.kind==="transition"?"transition":layerId===0?"plate":"supported",materialState:"supported",uncertain:false};
   if(m.kind==="deposition")coverageDistribution[Math.min(4,Math.floor(coverage*5))]++;
  }
  const selected:SupportRegion[]=[];
  const stretchLimits=new Map<number,number>();
  for(let k=0;k<ids.length;){
   const i=ids[k],s=segments[i]!;
   if(layerId===0||path.moves[i].kind!=="deposition"||s.coverage>=coverageThreshold){k++;continue;}
   const first=k;let length=0,weightedCoverage=0;
   while(k<ids.length&&path.moves[ids[k]].kind==="deposition"&&segments[ids[k]]!.coverage<coverageThreshold&&(k===first||ids[k]===ids[k-1]+1)){
    const id=ids[k++],l=path.moves[id].lengthMm;length+=l;weightedCoverage+=l*segments[id]!.coverage;
   }
   const last=k-1,width=path.moves[i].beadWidthMm;
   const classification=length<=width*c.shortSpanWidths?"short":length<=width*c.mediumSpanWidths?"medium":"long";
   const region=Object.freeze({layerId,firstMove:i,lastMove:ids[last],lengthMm:length,classification});
   regions.push(region);
   for(let j=first;j<=last;j++)segments[ids[j]]={...segments[ids[j]]!,classification};
   if(!enabled)continue;
   const lo=first>0&&ids[first-1]===i-1&&path.moves[i-1].kind==="deposition"?first-1:first;
   const hi=last+1<ids.length&&ids[last+1]===ids[last]+1&&path.moves[ids[last]+1].kind==="deposition"?last+1:last;
   const profile=response?.profile(region,weightedCoverage/length,path.moves[i],{start:lo<first,end:hi>last});
   if(response&&!profile)continue;
   if(profile)selected.push(region);
   const amplitude=profile?.amplitudeMm??Math.min(reach(i),classification==="short"?path.moves[i].beadHeightMm*c.shortDropHeights:
    length*(classification==="medium"?c.mediumSpanDropRatio:c.longSpanDropRatio))*(1-weightedCoverage/length);
   let total=0;for(let j=lo;j<=hi;j++)total+=path.moves[ids[j]].lengthMm;
   let arc=0;
   for(let j=lo;j<=hi;j++){
    const id=ids[j],value=(d:number)=>{
     const t=d/total,curve=Math.sin(Math.PI*t);
     const tail=profile?.tail==="start"?1-t:profile?.tail==="end"?t:1;
     if(profile?.curve)return amplitude*profile.curve(t);
     return amplitude*(profile?curve**profile.power*(.65+.35*tail):.3+.7*Math.sin(Math.PI*d/total)**2);
    };
    if(profile?.maximumStretch)stretchLimits.set(id,profile.maximumStretch);
    drops[id]=Math.max(drops[id],j===lo&&lo<first?0:value(arc));arc+=path.moves[id].lengthMm;
    drops[ends[id]]=Math.max(drops[ends[id]],j===hi&&hi>last?0:value(arc));
   }
  }
  const peak=(region:SupportRegion)=>{
   let maximum=0;
   for(let i=region.firstMove;i<=region.lastMove;i++)maximum=Math.max(maximum,drops[i],drops[ends[i]]);
   return maximum;
  };
  const checkpoints=selected.map(region=>({firstMove:region.firstMove,proposedPeakMm:peak(region),
   afterBedMm:0,afterContactMm:0,afterSlopeMm:0}));
  if(response){
   for(const i of deposit){
    const move=path.moves[i];
    drops[i]=Math.min(drops[i],Math.max(0,move.start[2]-move.beadHeightMm/2));
    drops[ends[i]]=Math.min(drops[ends[i]],Math.max(0,move.end[2]-move.beadHeightMm/2));
   }
   selected.forEach((region,i)=>{checkpoints[i].afterBedMm=peak(region);});
  }
  const limits=new Map<number,ContactLimit[]>();
  // Decreasing shared node drops can only relax earlier collision constraints.
  for(const i of deposit){
   if(!drops[i]&&!drops[ends[i]])continue;
   writeBead(path.moves[i],1,positions,normals,0,residue[i]);
   drops[i]=Math.min(drops[i],Math.max(0,path.moves[i].start[2]-path.moves[i].beadHeightMm/2));
   drops[ends[i]]=Math.min(drops[ends[i]],Math.max(0,path.moves[i].end[2]-path.moves[i].beadHeightMm/2));
   const constraints=index.limits(positions,reach(i));limits.set(i,constraints);
   for(const limit of constraints){
    const a=i,b=ends[i],t=limit.t,drop=(1-t)*drops[a]+t*drops[b],cap=limit.clearanceMm;
    if(drop<=cap)continue;
    if(t<1e-8)drops[a]=Math.min(drops[a],cap);
    else if(t>1-1e-8)drops[b]=Math.min(drops[b],cap);
    else if(response){
     // Match the contact constraint at this interpolation point without capping
     // both endpoints to the same clearance when their weights are different.
     const scale=cap/drop;
     drops[a]*=scale;drops[b]*=scale;
    }else{drops[a]=Math.min(drops[a],cap);drops[b]=Math.min(drops[b],cap);}
   }
  }
  if(response){
   selected.forEach((region,i)=>{checkpoints[i].afterContactMm=peak(region);});
   if(selected.length){
    const previousNode=new Map(deposit.map(i=>[ends[i],i]));
    const softened=deposit.map(i=>{
     const previous=previousNode.get(i);
     if(previous===undefined)return drops[i];
     return Math.min(drops[i],.5*drops[i]+.25*(drops[previous]+drops[ends[i]]));
    });
    deposit.forEach((i,index)=>{drops[i]=softened[index];});
   }
   // Only reduce drops so earlier contact and bed limits still hold. Two passes
   // in each direction also propagate the bound through a closed contour seam.
   const maximumDropDifference=(i:number,forward:boolean)=>{
    const move=path.moves[i],slopeLimit=response.maxSlope*move.lengthMm,stretch=stretchLimits.get(i);
    if(!stretch)return slopeLimit;
    const dz=move.end[2]-move.start[2];
    const maxVertical=Math.sqrt(dz*dz+(stretch*stretch-1)*move.lengthMm**2);
    return Math.min(slopeLimit,maxVertical+(forward?dz:-dz));
   };
   for(let pass=0;pass<2;pass++){
    for(const i of deposit) drops[ends[i]]=Math.min(drops[ends[i]],drops[i]+maximumDropDifference(i,true));
    for(let j=deposit.length-1;j>=0;j--){
     const i=deposit[j];
     drops[i]=Math.min(drops[i],drops[ends[i]]+maximumDropDifference(i,false));
    }
   }
  }
  selected.forEach((region,i)=>{
   checkpoints[i].afterSlopeMm=peak(region);
   regionClearance.push(Object.freeze(checkpoints[i]));
  });
  // Verify/contact the settled geometry before adding this layer to the spatial index.
  for(const i of deposit){
   const m=path.moves[i],startDropMm=drops[i],endDropMm=drops[ends[i]];
   writeBead(m,1,positions,normals,0,residue[i],{startDropMm,endDropMm});
   const final=sampleContact(i),deformed=Math.max(startDropMm,endDropMm)>1e-6;
   for(const limit of limits.get(i)??[]){
    const gap=limit.clearanceMm-((1-limit.t)*startDropMm+limit.t*endDropMm);
    if(gap< -1e-6)throw new Error("Predicted material penetrates an earlier deposited surface.");
    if(gap<=c.adhesionToleranceMm&&!final.contacts.has(limit.move))final.contacts.set(limit.move,Object.freeze({
     move:limit.move,layerId:limit.layerId,gapMm:gap,point:Object.freeze([limit.x,limit.y,limit.z])}));
   }
   const contacts=Object.freeze([...final.contacts.values()]),uncertain=final.coverage<coverageThreshold;
   segments[i]=Object.freeze({...segments[i]!,startDropMm,endDropMm,finalCoverage:final.coverage,contacts,
    supportMoves:Object.freeze(contacts.filter(p=>p.move>=0).map(p=>p.move)),uncertain,
    materialState:deformed&&contacts.length?"contacted":uncertain?"uncertain":deformed?"deformed":"supported"});
   if(deformed)affected.add(layerId);
  }
  for(const i of ids)if(path.moves[i].kind==="transition")segments[i]=Object.freeze({...segments[i]!,
   startDropMm:segments[i-1]?.endDropMm??0,endDropMm:segments[i+1]?.startDropMm??0,contacts:Object.freeze([]),supportMoves:Object.freeze([])});
  for(const i of deposit){writeBead(path.moves[i],1,positions,normals,0,residue[i],segments[i]);index.add(positions,i,layerId);}
 }
 const material=beadBuffers(path,residue,segments),layerAccounting=accountMaterial(path,segments,material);
 let maxDrop=0,dropIntegral=0,totalLength=0,deformedSegments=0,interlayerContacts=0,gravityContactSegments=0,deepContactSegments=0;
 for(const s of segments){if(!s)continue;const m=path.moves[s.sourceMove],deformed=Math.max(s.startDropMm,s.endDropMm)>1e-6;
  maxDrop=Math.max(maxDrop,s.startDropMm,s.endDropMm);dropIntegral+=m.lengthMm*(s.startDropMm+s.endDropMm)/2;totalLength+=m.lengthMm;
  if(deformed)deformedSegments++;interlayerContacts+=s.contacts.filter(c=>c.move>=0).length;
  if(deformed&&s.contacts.some(c=>c.move>=0))gravityContactSegments++;
  if(deformed&&s.contacts.some(c=>c.move>=0&&c.layerId<s.layerId-1))deepContactSegments++;
 }
 const uncertainRegions=regions.filter(r=>segments.slice(r.firstMove,r.lastMove+1).some(s=>s?.uncertain));
 const metrics=Object.freeze({unsupportedRegions:regions.length,unsupportedLengthMm:regions.reduce((n,r)=>n+r.lengthMm,0),
  short:regions.filter(r=>r.classification==="short").length,medium:regions.filter(r=>r.classification==="medium").length,
  long:regions.filter(r=>r.classification==="long").length,maximumDisplacementMm:maxDrop,averageDisplacementMm:totalLength?dropIntegral/totalLength:0,
  continuityChangedSegments:0,deformedSegments,interlayerContacts,gravityContactSegments,deepContactSegments,uncertainRegions:uncertainRegions.length,
  affectedLayers:Object.freeze([...affected]),coverageDistribution:Object.freeze(coverageDistribution),triangleQueries:index.queries});
 return Object.freeze({sourceGeometryId,sourceDerivedId,calibration:c,enabled,segments:Object.freeze(segments),regions:Object.freeze(regions),metrics,layerAccounting,
  ...(response?{regionClearance:Object.freeze(regionClearance),
   weakSupportSamples:regions.reduce((total,r)=>{
    for(let i=r.firstMove;i<=r.lastMove;i++)total+=9-Math.round(9*segments[i]!.coverage);
    return total;
   },0)}:{}),
  warnings:Object.freeze(["Gravity, contact and adhesion are geometric approximations; physical stability is not verified.",
   "All commanded extrusion is retained. Unreachable material remains structurally uncertain; no detachment or loss is modeled.",
   ...uncertainRegions.map(r=>`Layer ${r.layerId}: moves ${r.firstMove}-${r.lastMove}, ${r.lengthMm.toFixed(2)} mm span remains structurally uncertain.`)])});
}

