/** Internal post-generation checks for the supported single polar-contour topology. */
import { CONTOUR_SAMPLING_POLICY } from "./toolpath.ts";
import type { Toolpath } from "./toolpath.ts";
export function validateGeneratedContours(path: Toolpath): void {
  const {heightMm, layerHeightMm} = path.parameters;
  const fail = (message: string): never => { throw new Error(`Geometry validation: ${message}`); };
  if (path.contours.length !== Math.max(1, Math.ceil(heightMm/layerHeightMm-1e-10))) fail("Incorrect layer count.");
  let segments = 0;
  for (const [i, c] of path.contours.entries()) {
    const thickness = Math.min(layerHeightMm, heightMm-i*layerHeightMm);
    if (c.layerId !== i || Math.abs(c.beadHeightMm-thickness)>1e-7 ||
        Math.abs(c.zMm-(i*layerHeightMm+thickness/2))>1e-7) fail("Inconsistent layer order, height or thickness.");
    const n=c.points.length-1;
    if(n<CONTOUR_SAMPLING_POLICY.minSegments || n!==path.contours[0].points.length-1) fail("Invalid or inconsistent contour sampling.");
    segments+=n;
    if (!c.points[0].every((v,j)=>v===c.points[n][j])) fail("Contour is not exactly closed.");
    let turn=0;
    for(let j=0;j<n;j++) {
      const a=c.points[j], b=c.points[j+1];
      if(a.length!==3 || !a.every(Number.isFinite) || a[2]!==c.zMm) fail("Nonfinite or nonhorizontal contour coordinates.");
      const cross=a[0]*b[1]-a[1]*b[0], dot=a[0]*b[0]+a[1]*b[1];
      if(!(cross>0)) fail("Degenerate edge or inconsistent winding.");
      turn+=Math.atan2(cross,dot);
    }
    // Strictly positive angular wedges making one turn prove a simple star-shaped polygon.
    if(Math.abs(turn-2*Math.PI)>1e-7) fail("Contour intersects itself or makes multiple turns.");
  }
  if(segments>200000) fail("Exceeded 200000 segments.");
  let endTime=0, totalLength=0;
  for(const [i,m] of path.moves.entries()) {
    if(![...m.start,...m.end,m.lengthMm,m.feedrateMmMin,m.startTimeS,m.endTimeS].every(Number.isFinite) ||
       m.lengthMm<=0 || m.feedrateMmMin<=0 || m.endTimeS<=m.startTimeS || m.startTimeS!==endTime ||
       m.extrude!==(m.kind!=="travel") || !Number.isInteger(m.layerId) || m.layerId<0 || m.layerId>=path.contours.length)
      fail("Invalid move or extrusion/timing sequence.");
    if(i && !m.start.every((v,j)=>v===path.moves[i-1].end[j])) fail("Disconnected nozzle moves.");
    const length=Math.hypot(...m.end.map((v,j)=>v-m.start[j]));
    if(Math.abs(length-m.lengthMm)>1e-7 || Math.abs((m.endTimeS-m.startTimeS)-length*60/m.feedrateMmMin)>1e-7)
      fail("Move length/feedrate timing mismatch.");
    totalLength+=length;
    endTime=m.endTimeS;
  }
  if(!path.moves.length || endTime!==path.durationS || Math.abs(totalLength-path.lengthMm)>1e-7) fail("Invalid path duration.");
}
