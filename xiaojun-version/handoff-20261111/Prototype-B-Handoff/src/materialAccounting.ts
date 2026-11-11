import type {Toolpath} from "./toolpath.ts";
import type {MaterialDisplacement} from "./claySurface.ts";
/** Length accounting, not a claim of conserved volume or calibrated material flow. */
export function accountMaterial(path:Toolpath,segments:readonly (MaterialDisplacement|undefined)[],buffers:{indices:Uint32Array;indexBefore:Uint32Array}){
 const rows=path.contours.map((c,i)=>({layerId:c.layerId,commandedExtrusionMm:path.shape.layers[i].contourLengthMm,
  originalGapInterruptedMm:0,remainingCommandedExtrusionMm:0,predictedInputLengthMm:0,predictedCentrelineLengthMm:0,
  gravityDisplacedInputMm:0,supportRemovedMm:0,renderOmittedMm:0}));
 path.moves.forEach((m,i)=>{
  if(!m.extrude)return;const row=rows[m.layerId],s=segments[i];
  if(m.kind==="transition")row.commandedExtrusionMm+=m.lengthMm;
  row.remainingCommandedExtrusionMm+=m.lengthMm;
  if(s?.omitted){row.supportRemovedMm+=m.lengthMm;return;}
  if((buffers.indexBefore[i+1]??buffers.indices.length)===buffers.indexBefore[i]){row.renderOmittedMm+=m.lengthMm;return;}
  const a=s?.startDropMm??0,b=s?.endDropMm??0;
  row.predictedInputLengthMm+=m.lengthMm;
  row.predictedCentrelineLengthMm+=Math.hypot(m.end[0]-m.start[0],m.end[1]-m.start[1],m.end[2]-m.start[2]-b+a);
  if(a>1e-6||b>1e-6)row.gravityDisplacedInputMm+=m.lengthMm;
 });
 return Object.freeze(rows.map(row=>Object.freeze({...row,originalGapInterruptedMm:Math.max(0,row.commandedExtrusionMm-row.remainingCommandedExtrusionMm)})));
}
