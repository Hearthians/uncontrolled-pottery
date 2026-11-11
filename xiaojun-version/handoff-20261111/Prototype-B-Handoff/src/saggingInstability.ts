import {requireBuildVolume,validateBuildVolume} from "./machine.ts";
import type {Move,Toolpath,XYZ} from "./toolpath.ts";
import type {SupportRegion,SupportSegment} from "./support.ts";

export const INSTABILITY_CALIBRATION=Object.freeze({minimumVisibleDropHeights:.25,
 outwardWidths:1.05,liftHeights:.8,minimumSpanWidths:3,maximumStretch:1.6,layerSeparation:3});
export const EXPRESSIVE_CALIBRATION=Object.freeze({outwardWidths:1.55,liftHeights:.45,
 minimumSpanWidths:5,maximumStretch:1.6,layerSeparation:3,dropHeights:3.5,maximumEvents:6,
 tensionWidths:3.5,maximumSettledStretch:1.15,anchorTaperFraction:.15});

type EventSite = Pick<SupportRegion,"layerId"|"firstMove"|"lastMove"> & {slot?:number};
type Placement = {
 sites:readonly EventSite[];limit:number;halfSpanWidths:number;
 calibration:typeof INSTABILITY_CALIBRATION|typeof EXPRESSIVE_CALIBRATION;
 eligible?:(first:number,last:number)=>boolean;
};

/** The nominal contours remain the slice reference. Only executed moves deviate. */
export function unstableDeposition(nominal:Toolpath,weakRegions:readonly SupportRegion[],intensity:number,seed:number){
 const priority=(region:SupportRegion)=>Math.imul((region.firstMove+1)^seed,0x9e3779b1)>>>0;
 return placeDeposition(nominal,intensity,seed,{sites:[...weakRegions].sort((a,b)=>priority(a)-priority(b)),
  limit:1+Math.floor(2*intensity),halfSpanWidths:2+1.5*intensity,calibration:INSTABILITY_CALIBRATION});
}

export function expressiveDeposition(nominal:Toolpath,segments:readonly (SupportSegment|undefined)[],
 reactive:readonly EventSite[],intensity:number,seed:number){
 const count=nominal.contours.length,firstLayer=Math.max(3,Math.ceil(count*.25)),available=count-firstLayer-1;
 const limit=Math.max(0,Math.min(EXPRESSIVE_CALIBRATION.maximumEvents,
  1+Math.floor(2*intensity)+Math.floor(count/40),Math.floor(available/3)));
 const heading=((Math.imul(seed^0x51ed270b,0x9e3779b1)>>>0)/4294967296)*Math.PI*2;
 const protectedMoves=new Uint8Array(nominal.moves.length);
 for(const region of reactive)protectedMoves.fill(1,Math.max(0,region.firstMove-1),region.lastMove+2);
 const protectedPrefix=new Uint32Array(nominal.moves.length+1);
 protectedMoves.forEach((value,i)=>{protectedPrefix[i+1]=protectedPrefix[i]+value;});
 const slots:EventSite[][]=Array.from({length:limit},()=>[]);
 for(const [index,move] of nominal.moves.entries()){
  if(move.kind!=="deposition"||move.layerId<firstLayer||move.layerId>=count-1||!limit)continue;
  const slot=Math.floor((move.layerId-firstLayer)*limit/available);
  slots[slot].push({layerId:move.layerId,firstMove:index,lastMove:index,slot});
 }
 const sites=slots.flatMap((slot,i)=>{
  const layer=firstLayer+(i+.5)*available/limit;
  const score=(site:EventSite)=>{
   const [x,y]=nominal.moves[site.firstMove].start;
   return Math.abs(site.layerId-layer)*.12+1-Math.cos(Math.atan2(y,x)-heading);
  };
  return slot.sort((a,b)=>score(a)-score(b));
 });
 return placeDeposition(nominal,intensity,seed,{sites,limit,halfSpanWidths:3+2.5*intensity,
  calibration:EXPRESSIVE_CALIBRATION,eligible(first,last){
   return (segments[first]?.coverage??0)>=.67&&(segments[last]?.coverage??0)>=.67&&
    protectedPrefix[last+1]===protectedPrefix[first];
  }});
}

function placeDeposition(nominal:Toolpath,intensity:number,seed:number,placement:Placement){
 const {calibration:c,limit,sites:candidates}=placement,changes=new Map<number,Move>();
 const events:{layerId:number;firstMove:number;lastMove:number;lengthMm:number;maximumOutwardMm:number;maximumLiftMm:number;
  startPosition:XYZ;executedLengthMm:number;addedCommandLengthMm:number;eventSeed:number}[]=[];
 const rejected={span:0,stretch:0,machineEnvelope:0,layerSpacing:0,anchorsOrOverlap:0};
 const filledSlots=new Set<number>();
 for(const region of candidates){
  if(events.length>=limit)break;
  if(region.slot!==undefined&&filledSlots.has(region.slot))continue;
  if(events.some(event=>Math.abs(event.layerId-region.layerId)<c.layerSeparation)){rejected.layerSpacing++;continue;}
  const centre=Math.floor((region.firstMove+region.lastMove)/2),move=nominal.moves[centre];
  const halfSpan=move.beadWidthMm*placement.halfSpanWidths;
  const sameLayer=(index:number)=>nominal.moves[index]?.kind==="deposition"&&nominal.moves[index].layerId===region.layerId;
  let first=centre,last=centre,left=move.lengthMm/2,right=left;
  while(left<halfSpan&&sameLayer(first-1))left+=nominal.moves[--first].lengthMm;
  while(right<halfSpan&&sameLayer(last+1))right+=nominal.moves[++last].lengthMm;
  const lengthMm=left+right;
  if(lengthMm<move.beadWidthMm*c.minimumSpanWidths||first===last){rejected.span++;continue;}
  if(placement.eligible&&!placement.eligible(first,last)){rejected.anchorsOrOverlap++;continue;}

  // Midrange events still need to clear the supporting bead footprint.
  const outwardIntensity=c===EXPRESSIVE_CALIBRATION?Math.sqrt(intensity):intensity;
  const outward=c.outwardWidths*move.beadWidthMm*outwardIntensity,lift=c.liftHeights*move.beadHeightMm*intensity;
  let arc=0,peak=0;
  const displaced=(point:XYZ):XYZ=>{
   const weight=Math.sin(Math.PI*arc/lengthMm)**2,radius=Math.hypot(point[0],point[1]);
   peak=Math.max(peak,weight);
   // The radial ray lies on the exterior side of the tangent of a polar contour.
   return [point[0]+weight*outward*point[0]/radius,point[1]+weight*outward*point[1]/radius,point[2]+weight*lift];
  };
  let start=nominal.moves[first].start;
  const moved=nominal.moves.slice(first,last+1).map((original,index)=>{
   arc+=original.lengthMm;
   const end=index===last-first?original.end:displaced(original.end);
   const result={...original,start,end,lengthMm:Math.hypot(end[0]-start[0],end[1]-start[1],end[2]-start[2])};
   start=end;
   return result;
  });
  if(moved.some((m,i)=>m.lengthMm>c.maximumStretch*nominal.moves[first+i].lengthMm||m.lengthMm<1e-8)){
   rejected.stretch++;continue;
  }
  if(!validateBuildVolume(moved,nominal.buildVolume.safetyMarginMm).valid){rejected.machineEnvelope++;continue;}
  moved.forEach((m,i)=>changes.set(first+i,m));
  if(region.slot!==undefined)filledSlots.add(region.slot);
  const executedLengthMm=moved.reduce((total,m)=>total+m.lengthMm,0);
  events.push(Object.freeze({layerId:region.layerId,firstMove:first,lastMove:last,lengthMm,
   maximumOutwardMm:outward*peak,maximumLiftMm:lift*peak,startPosition:nominal.moves[first].start,
   executedLengthMm,addedCommandLengthMm:executedLengthMm-lengthMm,eventSeed:(seed^Math.imul(first+1,0x9e3779b1))>>>0}));
 }
 const diagnostics=Object.freeze({eligible:candidates.length,rejected:Object.freeze(rejected)});
 if(!events.length)return {path:nominal,events:Object.freeze(events),diagnostics};
 let durationS=0,lengthMm=0;
 const moves=nominal.moves.map((base,i)=>{
  const move=changes.get(i)??base,startTimeS=durationS;
  lengthMm+=move.lengthMm;
  durationS+=move.lengthMm*60/move.feedrateMmMin;
  return {...move,startTimeS,endTimeS:durationS};
 });
 const path={...nominal,moves,durationS,lengthMm,buildVolume:requireBuildVolume(moves,nominal.buildVolume.safetyMarginMm)};
 return {path,events:Object.freeze(events.sort((a,b)=>a.firstMove-b.firstMove)),diagnostics};
}
