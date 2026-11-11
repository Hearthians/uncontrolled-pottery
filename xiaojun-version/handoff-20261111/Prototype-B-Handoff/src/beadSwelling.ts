/** Predicted bead swelling only: never changes commanded moves or canonical contours. */
import type {Toolpath,XYZ} from "./toolpath.ts";
import type {BulgeEvent} from "./bulges.ts";
import {beadBuffers,writeBead,SIDES,FLOATS_PER_MOVE,INDICES_PER_MOVE} from "./claySurface.ts";
import {MACHINE} from "./machine.ts";

export const SWELLING_CALIBRATION=Object.freeze({version:"1.1.0",trailingBeadWidths:4,volumeToleranceFraction:.01,inwardShareMin:.35,inwardShareMax:.5,verticalShare:0});
type SwellingMove=Readonly<{moveIndex:number;offset:number;start:number;end:number;startSlope:number;endSlope:number;startNormal:XYZ;endNormal:XYZ}>;
export type BeadSwelling=Readonly<{moves:readonly SwellingMove[];amplitudeMm:number;extraVolumeMm3:number;
  baselineVolumeMm3:number;linearVolume:number;quadraticVolume:number;inwardShare:number}>;

/** Closed polygonal sweep volume. Caps are for measurement only, not internal render faces. */
export function beadSegmentVolume(p:Float32Array,offset=0){
 const point=(i:number)=>[p[offset+i*3]-p[offset],p[offset+i*3+1]-p[offset+1],p[offset+i*3+2]-p[offset+2]];
 const start=[0,0,0],end=[0,0,0];
 for(let j=0;j<SIDES;j++)for(let k=0;k<3;k++){start[k]+=point(j)[k]/SIDES;end[k]+=point(j+SIDES)[k]/SIDES;}
 const tetra=(a:number[],b:number[],c:number[])=>a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]);
 let volume=0;
 for(let j=0;j<SIDES;j++){
  const a=point(j),b=point((j+1)%SIDES),c=point(j+SIDES),d=point((j+1)%SIDES+SIDES);
  volume+=tetra(a,b,c)+tetra(b,d,c)+tetra(start,b,a)+tetra(end,c,d);
 }
 return volume/6;
}

/** Volume is quadratic in the linear radial displacement; invert it during growth. */
export function swellingScale(patch:BeadSwelling,progress:number){
 if(progress<=0)return 0;if(progress>=1)return 1;
 const target=progress*patch.extraVolumeMm3,b=patch.linearVolume,a=patch.quadraticVolume;
 return 2*target/(b+Math.sqrt(b*b+4*a*target));
}
function displacement(m:SwellingMove,amplitude:number,inwardShare:number){
 const outward=amplitude*(1-inwardShare),inward=amplitude*inwardShare;
 return {startDropMm:0,endDropMm:0,startOutwardMm:outward*m.start,endOutwardMm:outward*m.end,
  startOutwardSlope:outward*m.startSlope,endOutwardSlope:outward*m.endSlope,
  startInwardMm:inward*m.start,endInwardMm:inward*m.end,startInwardSlope:inward*m.startSlope,endInwardSlope:inward*m.endSlope,
  startSwellingNormal:m.startNormal,endSwellingNormal:m.endNormal};
}
export function writeSwelling(path:Toolpath,patch:BeadSwelling,progress:number,positions:Float32Array,normals:Float32Array){
 const amplitude=patch.amplitudeMm*swellingScale(patch,progress);
 for(const m of patch.moves)writeBead(path.moves[m.moveIndex],1,positions,normals,m.offset,undefined,
  amplitude?displacement(m,amplitude,patch.inwardShare):undefined);
}

/** Average adjacent unit tangents: both sides of a shared ring use the same normal. */
function contourNormal(path:Toolpath,index:number,end:boolean):XYZ{
 const move=path.moves[index],other=path.moves[index+(end?1:-1)],d=move.end.map((v,k)=>(v-move.start[k])/move.lengthMm);
 if(other?.kind==="deposition"&&other.layerId===move.layerId)for(let k=0;k<2;k++)d[k]+=(other.end[k]-other.start[k])/other.lengthMm;
 const length=Math.hypot(d[0],d[1]),point=end?move.end:move.start,normal:XYZ=[d[1]/length,-d[0]/length,0];
 if(normal[0]*point[0]+normal[1]*point[1]<=0)throw new Error("Swelling requires a consistent interior/exterior contour orientation.");
 return Object.freeze(normal);
}

export function buildSwelling(path:Toolpath,events:readonly BulgeEvent[]){
 if(path.moves.length>200000)throw new Error("Bulges rendering exceeds the existing segment-equivalent geometry budget.");
 const material=beadBuffers(path),patches:BeadSwelling[]=[],used=new Set<number>();
 let maximumInwardDisplacementMm=0,maximumOutwardDisplacementMm=0;
 for(const event of events){
  // A separate event-ID hash includes the failure seed without advancing placement RNG.
  let hash=2166136261;for(const char of event.id)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  const inwardShare=SWELLING_CALIBRATION.inwardShareMin+(SWELLING_CALIBRATION.inwardShareMax-SWELLING_CALIBRATION.inwardShareMin)*hash/4294967295;
  // Only already completed contour chords are modified. The current partial chord
  // stays under the nozzle; the swelling joins it at the unchanged shared ring.
  const ids:number[]=[];let length=0;
  for(let i=event.moveIndex-1;i>=0;i--){const m=path.moves[i];
   if(m.kind!=="deposition"||m.layerId!==event.layerId||length>=event.widthMm*SWELLING_CALIBRATION.trailingBeadWidths)break;
   ids.unshift(i);length+=m.lengthMm;
  }
  if(ids.length<2)throw new Error("Insufficient deposited strand for volume-conserving swelling.");
  const weight=(u:number)=>16*u*u*(1-u)*(1-u)*(1+.2*(2*u-1));
  const slope=(u:number)=>(32*u*(1-u)*(1-2*u)*(1+.2*(2*u-1))+6.4*u*u*(1-u)*(1-u))/length;
  let along=0;
  const moves=ids.map(moveIndex=>{if(used.has(moveIndex))throw new Error("Overlapping swelling footprints require an accumulation model.");used.add(moveIndex);
   const u=along/length;along+=path.moves[moveIndex].lengthMm;const v=Math.min(1,along/length);
   return Object.freeze({moveIndex,offset:material.indexBefore[moveIndex]/INDICES_PER_MOVE*FLOATS_PER_MOVE,start:weight(u),end:weight(v),startSlope:slope(u),endSlope:slope(v),startNormal:contourNormal(path,moveIndex,false),endNormal:contourNormal(path,moveIndex,true)});
  });
  const positions=new Float32Array(FLOATS_PER_MOVE),normals=new Float32Array(FLOATS_PER_MOVE);
  const volume=(amplitude:number)=>moves.reduce((sum,m)=>{
   writeBead(path.moves[m.moveIndex],1,positions,normals,0,undefined,amplitude?displacement(m,amplitude,inwardShare):undefined);
   return sum+beadSegmentVolume(positions);
  },0);
  const baseline=volume(0);let low=0,high=event.widthMm;
  while(volume(high)-baseline<event.extraVolumeMm3){high*=2;if(high>200)throw new Error("Swelling volume cannot fit the machine envelope.");}
  for(let i=0;i<28;i++){const mid=(low+high)/2;if(volume(mid)-baseline<event.extraVolumeMm3)low=mid;else high=mid;}
  const amplitude=(low+high)/2,extra=volume(amplitude)-baseline,half=volume(amplitude/2)-baseline;
  if(Math.abs(extra-event.extraVolumeMm3)>event.extraVolumeMm3*SWELLING_CALIBRATION.volumeToleranceFraction)throw new Error("Swelling volume tolerance exceeded.");
  const quadratic=2*extra-4*half,patch=Object.freeze({moves:Object.freeze(moves),amplitudeMm:amplitude,extraVolumeMm3:extra,
   inwardShare,baselineVolumeMm3:baseline,linearVolume:extra-quadratic,quadraticVolume:quadratic});
  patches.push(patch);writeSwelling(path,patch,1,material.positions,material.normals);
  for(const m of moves){
   writeBead(path.moves[m.moveIndex],1,positions,normals);
   for(let j=0;j<SIDES;j++){
    const a=m.offset+j*3,b=a+SIDES*3,p=material.positions;
    // Strict angular order keeps each horizontal section a simple polar loop.
    if(p[a]*p[b+1]-p[a+1]*p[b]<=0)throw new Error("Swelling would fold or self-intersect the local bead; reduce intensity or use a wider contour.");
    for(const ring of [0,1]){const o=(ring*SIDES+j)*3,n=ring?m.endNormal:m.startNormal;
     const point=ring?path.moves[m.moveIndex].end:path.moves[m.moveIndex].start;
     if(p[m.offset+o]*point[0]+p[m.offset+o+1]*point[1]<=0)throw new Error("Inward swelling would cross the vessel interior axis.");
     const shift=(p[m.offset+o]-positions[o])*n[0]+(p[m.offset+o+1]-positions[o+1])*n[1];
     maximumInwardDisplacementMm=Math.max(maximumInwardDisplacementMm,-shift);
     maximumOutwardDisplacementMm=Math.max(maximumOutwardDisplacementMm,shift);
    }
   }
  }
 }
 for(let i=0;i<material.positions.length;i+=3){const p=material.positions,x=p[i],y=p[i+1],z=p[i+2];
  if(![x,y,z].every(Number.isFinite)||Math.hypot(x-MACHINE.centreXY[0],y-MACHINE.centreXY[1])>MACHINE.diameterMm/2-path.buildVolume.safetyMarginMm+1e-5||z<MACHINE.surfaceZMm-1e-5||z>MACHINE.heightMm-path.buildVolume.safetyMarginMm+1e-5)
   throw new Error("Bulges material exceeds the machine envelope or safety margin.");
 }
 return {patches:Object.freeze(patches),material,displacementMetrics:{maximumInwardDisplacementMm,maximumOutwardDisplacementMm,maximumVerticalAccumulationMm:0}};
}
