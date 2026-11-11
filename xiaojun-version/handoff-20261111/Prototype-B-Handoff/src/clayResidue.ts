/** Display geometry calibration, independent of commanded gaps and failure intensity. */
import type {Toolpath} from "./toolpath.ts";
export const RESIDUE_CALIBRATION=Object.freeze({version:"1.0.0",taperBeadWidths:.65,
  probability:.38,sizeBeadWidths:.16,liftLayerHeights:.28,irregularity:.07,restartSwell:.08});
export type ResidueEdge=Readonly<{taperMm:number;scale:number;liftMm:number;phase:number;swell:number}>;
export type ResidueMove=Readonly<{fromStartMm:number;toEndMm:number;start?:ResidueEdge;end?:ResidueEdge}>;
export type ResiduePlan=readonly (ResidueMove|undefined)[];
export function createResiduePlan(path:Toolpath,seed:number):ResiduePlan {
  if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error("Invalid material seed.");
  const plan:(ResidueMove|undefined)[]=new Array(path.moves.length);
  const c=RESIDUE_CALIBRATION;
  const edge=(i:number,terminal:boolean,length:number):ResidueEdge=>{
    const m=path.moves[i],p=terminal?m.end:m.start;
    let n=seed>>>0;for(const v of p)n=Math.imul(n^Math.round(v*1e6),0x45d9f3b)>>>0;
    n=Math.imul(n^(n>>>16),0x7feb352d)>>>0;
    const rand=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
    const residue=rand()<c.probability,variation=rand();
    return Object.freeze({taperMm:Math.min(c.taperBeadWidths*m.beadWidthMm,length/2),
      scale:terminal?(residue?c.sizeBeadWidths:.48)+.15*variation:.62+.16*variation,
      liftMm:terminal&&residue?c.liftLayerHeights*m.beadHeightMm*(.5+.5*rand()):0,
      phase:rand()*Math.PI*2,swell:terminal?0:c.restartSwell*(.5+.5*rand())});
  };
  const horizontalTravel=(i:number,layer:number)=>{
    const m=path.moves[i];return m?.kind==="travel"&&!m.extrude&&m.layerId===layer&&m.start[2]===m.end[2];
  };
  for(let i=0;i<path.moves.length;){
    if(path.moves[i].kind!=="deposition"){i++;continue;}
    const first=i,layer=path.moves[i].layerId;let length=0;
    while(i<path.moves.length&&path.moves[i].kind==="deposition"&&path.moves[i].layerId===layer)length+=path.moves[i++].lengthMm;
    const last=i-1,start=horizontalTravel(first-1,layer)?edge(first,false,length):undefined,
      end=horizontalTravel(i,layer)?edge(last,true,length):undefined;
    if(!start&&!end)continue;
    let offset=0;
    for(let j=first;j<=last;j++){
      const m=path.moves[j],remaining=length-offset;
      if(start&&offset<start.taperMm || end&&remaining-m.lengthMm<end.taperMm)
        plan[j]=Object.freeze({fromStartMm:offset,toEndMm:remaining,start,end});
      offset+=m.lengthMm;
    }
  }
  return Object.freeze(plan);
}
