/** Layer-ordered surface contact heuristic. Never modifies commanded moves. */
import type {Toolpath} from "./toolpath.ts";
import type {ResiduePlan} from "./clayResidue.ts";
import {writeBead,beadBuffers,FLOATS_PER_MOVE,SIDES} from "./claySurface.ts";
import type {MaterialDisplacement} from "./claySurface.ts";
import {validateGeneratedContours} from "./geometryValidation.ts";
import {requireBuildVolume} from "./machine.ts";
export const SUPPORT_CALIBRATION=Object.freeze({version:"1.1.0",coverageThreshold:.8,
  contactToleranceHeights:.2,shortSpanWidths:.75,mediumSpanWidths:1.75,
  shortDropHeights:.25,mediumDropHeights:.6,longDropHeights:.9,
  missingCentreFraction:.4,retainedEndWidths:.75,brokenEndScale:.22,omitUnanchoredFragments:true,maxTriangleQueries:20000000});
export type SupportClass="plate"|"supported"|"short"|"medium"|"long"|"transition";
export type SupportSegment=MaterialDisplacement & Readonly<{sourceMove:number;layerId:number;coverage:number;
  supportMoves:readonly number[];classification:SupportClass}>;
export type SupportRegion=Readonly<{layerId:number;firstMove:number;lastMove:number;lengthMm:number;classification:"short"|"medium"|"long"}>;
export type SupportResult=Readonly<{sourceGeometryId:string;sourceDerivedId:string;calibration:typeof SUPPORT_CALIBRATION;enabled:boolean;
  segments:readonly (SupportSegment|undefined)[];regions:readonly SupportRegion[];
  metrics:Readonly<{unsupportedRegions:number;unsupportedLengthMm:number;short:number;medium:number;long:number;
    maximumDisplacementMm:number;averageDisplacementMm:number;continuityChangedSegments:number;
    affectedLayers:readonly number[];coverageDistribution:readonly number[];triangleQueries:number}>;
  warnings:readonly string[]}>;
type Triangle={v:number[];move:number};
/** Source IDs identify immutable geometry and gap-command results, respectively. */
export function analyzeSupport(path:Toolpath,residue:ResiduePlan,sourceGeometryId:string,sourceDerivedId:string,enabled=true):SupportResult {
  if(path.moves.length>200000)throw new Error("Support analysis exceeds 200000 moves.");
  validateGeneratedContours(path);requireBuildVolume(path.moves,path.buildVolume.safetyMarginMm);
  const c=SUPPORT_CALIBRATION,cell=Math.max(1,path.parameters.beadWidthMm,path.parameters.layerHeightMm);
  const segments:(SupportSegment|undefined)[]=new Array(path.moves.length),regions:SupportRegion[]=[];
  let lower=new Map<string,Triangle[]>(),queries=0;
  const positions=new Float32Array(FLOATS_PER_MOVE),normals=new Float32Array(FLOATS_PER_MOVE);
  const coverageDistribution=[0,0,0,0,0],affected=new Set<number>();let maxDrop=0,dropIntegral=0,retainedLength=0,continuityChangedSegments=0;
  const layers:number[][]=path.contours.map(()=>[]);
  path.moves.forEach((m,i)=>{if(m.extrude)layers[m.layerId].push(i);});
  const contact=(x:number,y:number,bottom:number,height:number,refs:Set<number>)=>{
    for(const t of lower.get(`${Math.floor(x/cell)},${Math.floor(y/cell)}`)??[]){
      if(++queries>c.maxTriangleQueries)throw new Error("Support contact-query budget exceeded; reduce model complexity.");
      const [ax,ay,az,bx,by,bz,cx,cy,cz]=t.v;
      const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-12)continue;
      const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/den,v=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/den;
      if(u< -1e-7||v< -1e-7||u+v>1+1e-7)continue;
      const z=u*az+v*bz+(1-u-v)*cz;
      if(z>=bottom-height*c.contactToleranceHeights-1e-6&&z<=bottom+height*c.contactToleranceHeights+1e-6){refs.add(t.move);return true;}
    }
    return false;
  };
  for(let layerId=0;layerId<layers.length;layerId++){
    const indices=layers[layerId];
    for(const i of indices){
      const m=path.moves[i],refs=new Set<number>();let hits=0;
      if(m.kind==="deposition"){
        writeBead(m,1,positions,normals,0,residue[i]);
        let startWidth=0,endWidth=0;
        for(let k=0;k<SIDES;k++){
          startWidth=Math.max(startWidth,Math.hypot(positions[k*3]-m.start[0],positions[k*3+1]-m.start[1]));
          endWidth=Math.max(endWidth,Math.hypot(positions[(SIDES+k)*3]-m.end[0],positions[(SIDES+k)*3+1]-m.end[1]));
        }
        for(const t of [.2,.5,.8])for(const side of [-.6,0,.6]){
          const x=m.start[0]+(m.end[0]-m.start[0])*t,y=m.start[1]+(m.end[1]-m.start[1])*t,r=Math.hypot(x,y);
          const width=startWidth+(endWidth-startWidth)*t;
          const px=x+side*width*x/r,py=y+side*width*y/r;
          // Actual upper ring-bottom heights include tapered/lifted residue.
          let a=Infinity,b=Infinity;for(let k=0;k<SIDES;k++){a=Math.min(a,positions[k*3+2]);b=Math.min(b,positions[(SIDES+k)*3+2]);}
          const bottom=a+(b-a)*t;
          if(layerId===0?Math.abs(bottom)<=m.beadHeightMm*c.contactToleranceHeights+1e-6:contact(px,py,bottom,m.beadHeightMm,refs))hits++;
        }
      }
      const coverage=m.kind==="transition"?1:hits/9;
      segments[i]={sourceMove:i,layerId,coverage,supportMoves:Object.freeze([...refs]),startDropMm:0,endDropMm:0,
        classification:m.kind==="transition"?"transition":layerId===0?"plate":"supported"};
      if(m.kind==="deposition")coverageDistribution[Math.min(4,Math.floor(coverage*5))]++;
    }
    for(let k=0;k<indices.length;){
      const i=indices[k],s=segments[i]!;
      if(layerId===0||path.moves[i].kind!=="deposition"||s.coverage>=c.coverageThreshold){k++;continue;}
      const first=k;let length=0;
      while(k<indices.length&&path.moves[indices[k]].kind==="deposition"&&segments[indices[k]]!.coverage<c.coverageThreshold&&
        (k===first||indices[k]===indices[k-1]+1))length+=path.moves[indices[k++]].lengthMm;
      const last=k-1,width=path.moves[i].beadWidthMm;
      const classification=length<=width*c.shortSpanWidths?"short":length<=width*c.mediumSpanWidths?"medium":"long";
      regions.push(Object.freeze({layerId,firstMove:i,lastMove:indices[last],lengthMm:length,classification}));
      let mean=0;for(let j=first;j<=last;j++){const id=indices[j];mean+=segments[id]!.coverage/(last-first+1);segments[id]={...segments[id]!,classification};}
      if(!enabled)continue;
      const anchoredStart=first>0&&indices[first-1]===i-1&&path.moves[i-1].kind==="deposition";
      const anchoredEnd=last+1<indices.length&&indices[last+1]===indices[last]+1&&path.moves[indices[last]+1].kind==="deposition";
      const unanchored=c.omitUnanchoredFragments&&mean===0&&!anchoredStart&&!anchoredEnd;
      if(classification==="long"||unanchored){
        // Missing centre is quantized outward to existing moves; commands are never split or edited.
        const retained=Math.min(length*(1-c.missingCentreFraction)/2,width*c.retainedEndWidths);
        let arc=0;const from=anchoredStart?retained:0,to=length-(anchoredEnd?retained:0);
        for(let j=first;j<=last;j++){
          const id=indices[j],end=arc+path.moves[id].lengthMm;
          if(end>from&&arc<to)segments[id]={...segments[id]!,omitted:true};
          arc=end;
        }
      }
      const amplitude=path.moves[i].beadHeightMm*c[`${classification}DropHeights`]*(1-mean);
      // Blend one deposited move into each adjacent supported region; never blend across travel.
      const lo=anchoredStart?first-1:first;
      const hi=anchoredEnd?last+1:last;
      let total=0;for(let j=lo;j<=hi;j++)total+=path.moves[indices[j]].lengthMm;
      let arc=0;
      for(let j=lo;j<=hi;j++){
        const id=indices[j],m=path.moves[id],s=segments[id]!;
        // Free strand ends may drop; supported blend endpoints remain fixed.
        const value=(d:number)=>amplitude*(.3+.7*Math.sin(Math.PI*d/total)**2);
        const a=j===lo&&lo<first?0:value(arc),b=j===hi&&hi>last?0:value(arc+m.lengthMm);
        segments[id]={...s,startDropMm:Math.max(s.startDropMm,a),endDropMm:Math.max(s.endDropMm,b)};
        arc+=m.lengthMm;
      }
    }
    // Equalize shared ring offsets; this also handles adjacent response blends.
    for(let j=1;j<indices.length;j++){
      const a=indices[j-1],b=indices[j];if(b!==a+1||path.moves[a].kind!=="deposition"||path.moves[b].kind!=="deposition"||segments[a]!.omitted||segments[b]!.omitted)continue;
      const drop=Math.max(segments[a]!.endDropMm,segments[b]!.startDropMm);
      segments[a]={...segments[a]!,endDropMm:drop};segments[b]={...segments[b]!,startDropMm:drop};
    }
    const next=new Map<string,Triangle[]>();
    for(const i of indices)if(!segments[i]!.omitted&&path.moves[i].kind==="deposition"){
      if(segments[i-1]?.omitted)segments[i]={...segments[i]!,startScale:c.brokenEndScale};
      if(segments[i+1]?.omitted)segments[i]={...segments[i]!,endScale:c.brokenEndScale};
    }
    for(const i of indices)if(path.moves[i].kind==="transition")segments[i]={...segments[i]!,
      startDropMm:segments[i-1]?.endDropMm??0,endDropMm:segments[i+1]?.startDropMm??0};
    for(const i of indices){
      const m=path.moves[i],s=segments[i]!;Object.freeze(s);
      if(s.omitted){continuityChangedSegments++;affected.add(layerId);continue;} // Missing material cannot support the next layer.
      maxDrop=Math.max(maxDrop,s.startDropMm,s.endDropMm);if(s.startDropMm||s.endDropMm)affected.add(layerId);
      dropIntegral+=m.lengthMm*(s.startDropMm+s.endDropMm)/2;retainedLength+=m.lengthMm;
      writeBead(m,1,positions,normals,0,residue[i],s);
      if(m.kind!=="deposition")continue; // Vertical transition material is not treated as a horizontal support bed.
      for(let j=0;j<SIDES;j++)for(const tri of [[j,(j+1)%SIDES,j+SIDES],[(j+1)%SIDES,(j+1)%SIDES+SIDES,j+SIDES]]){
        const v=tri.flatMap(k=>Array.from(positions.slice(k*3,k*3+3))),t={v,move:i};
        const xs=[v[0],v[3],v[6]],ys=[v[1],v[4],v[7]];
        for(let x=Math.floor(Math.min(...xs)/cell);x<=Math.floor(Math.max(...xs)/cell);x++)
          for(let y=Math.floor(Math.min(...ys)/cell);y<=Math.floor(Math.max(...ys)/cell);y++){
            const key=`${x},${y}`,list=next.get(key);if(list)list.push(t);else next.set(key,[t]);
          }
      }
    }
    lower=next;
  }
  beadBuffers(path,residue,segments); // Final material vertices must still satisfy the machine envelope.
  const metrics=Object.freeze({unsupportedRegions:regions.length,unsupportedLengthMm:regions.reduce((s,r)=>s+r.lengthMm,0),
    short:regions.filter(r=>r.classification==="short").length,medium:regions.filter(r=>r.classification==="medium").length,
    long:regions.filter(r=>r.classification==="long").length,maximumDisplacementMm:maxDrop,
    averageDisplacementMm:retainedLength?dropIntegral/retainedLength:0,continuityChangedSegments,
    affectedLayers:Object.freeze([...affected]),coverageDistribution:Object.freeze(coverageDistribution),triangleQueries:queries});
  return Object.freeze({sourceGeometryId,sourceDerivedId,calibration:c,enabled,segments:Object.freeze(segments),regions:Object.freeze(regions),metrics,
    warnings:Object.freeze(["Heuristic contact and support response; physical stability is not verified.",
      ...(enabled?["Unanchored fragments with no detected contact are omitted; lost material is not simulated as falling debris."]:[]),
      ...regions.filter(r=>r.classification==="long").map(r=>`Layer ${r.layerId}: moves ${r.firstMove}-${r.lastMove}, ${r.lengthMm.toFixed(2)} mm long unsupported region; ${enabled?"predicted middle continuity loss":"response disabled"}, structurally uncertain.`)])});
}
