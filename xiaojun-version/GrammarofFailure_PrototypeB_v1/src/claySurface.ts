import type { Move, Toolpath, XYZ } from "./toolpath.ts";
import type {ResidueMove,ResiduePlan} from "./clayResidue.ts";
import {RESIDUE_CALIBRATION} from "./clayResidue.ts";
import {MACHINE} from "./machine.ts";

export const BEAD_WIDTH_VARIATION = .006;
export const SIDES = 16;
export const INDICES_PER_MOVE = SIDES * 6;
export const FLOATS_PER_MOVE = SIDES * 2 * 3;
export type MaterialDisplacement=Readonly<{startDropMm:number;endDropMm:number;
  omitted?:boolean;startScale?:number;endScale?:number}>;
/** Predicted material can be absent while the commanded nozzle still extrudes. */
export function hasDepositedMaterial(move:Move,support?:MaterialDisplacement){return move.extrude&&!support?.omitted;}

// Display-only surface. Never use these buffers for toolpath or fabrication export.
export function writeBead(move: Move, fraction: number, positions: Float32Array,
  normals: Float32Array, offset = 0, residue?:ResidueMove, support?:MaterialDisplacement) {
  const d = move.end.map((v, i) => (v - move.start[i]) / move.lengthMm);
  const horizontal = Math.hypot(d[0], d[1]);
  const isContour = move.kind === "deposition";
  const side: XYZ = horizontal > 1e-8 ? [-d[1] / horizontal, d[0] / horizontal, 0] : [1, 0, 0];
  const up = [d[1] * side[2] - d[2] * side[1], d[2] * side[0] - d[0] * side[2], d[0] * side[1] - d[1] * side[0]];
  const width = move.beadWidthMm / 2;
  // Keep the specified bead thickness even when the sweep turns vertically.
  // Using beadWidth here inflated every real extruding seam into a round column.
  const height = move.beadHeightMm / 2;
  for (let ring = 0; ring < 2; ring++) {
    const centre = move.start.map((v, axis) => v + ring * fraction * (move.end[axis] - v));
    // Radial endpoint frames join adjacent circular chords without visible cracks.
    const radius = Math.hypot(centre[0], centre[1]);
    const radial = isContour && radius > 0 ? [-centre[0] / radius, -centre[1] / radius, 0] : side;
    const vertical = isContour ? [0, 0, 1] : up;
    const organic = 1 + BEAD_WIDTH_VARIATION * Math.sin(centre[0] * .7 + centre[1] * .53 + centre[2] * .41);
    const along=ring*fraction*move.lengthMm;
    const sectionScale=(support?.startScale??1)+((support?.endScale??1)-(support?.startScale??1))*ring*fraction;
    let scale=1,lift=0,phase=0,weight=0;
    if(residue) for(const [edge,distance] of [[residue.start,residue.fromStartMm+along],
      [residue.end,residue.toEndMm-along]] as const){
      if(!edge)continue;
      const t=Math.max(0,1-distance/edge.taperMm),w=t*t*(3-2*t);
      scale+=(edge.scale-1)*w+edge.swell*4*t*(1-t);
      lift+=edge.liftMm*w;
      phase=edge.phase;weight+=w;
    }
    // A rounded, compressed profile gives a broad contact patch without changing Z.
    // Vertical transitions retain their orthogonal section rather than being hidden.
    const profile = (angle: number) => {
      const c = Math.cos(angle), s = Math.sin(angle);
      const variation=1+RESIDUE_CALIBRATION.irregularity*weight*Math.sin(3*angle+phase);
      return isContour
        ? [Math.sign(c) * Math.pow(Math.abs(c), .65) * width * organic*Math.min(1,scale*variation),
          Math.max(-1, Math.min(1, s * 1.42)) * height*Math.min(1-lift/height,scale*variation)]
        : [c * width * organic, s * height];
    };
    for (let j = 0; j < SIDES; j++) {
      const angle = j / SIDES * Math.PI * 2;
      const [r, z] = profile(angle).map(value=>value*sectionScale);
      const before = profile(angle - .001), after = profile(angle + .001);
      const nr = after[1] - before[1], nz = before[0] - after[0];
      const norm = Math.hypot(nr, nz);
      for (let axis = 0; axis < 3; axis++) {
        const index = offset + (ring * SIDES + j) * 3 + axis;
        const drop=support?support.startDropMm+(support.endDropMm-support.startDropMm)*ring*fraction:0;
        positions[index] = centre[axis] + r * radial[axis] + z * vertical[axis] + (axis===2?lift-drop:0);
        normals[index] = (nr * radial[axis] + nz * vertical[axis]) / norm;
      }
    }
  }
}

export function beadBuffers(path: Toolpath,residue?:ResiduePlan,support?:readonly (MaterialDisplacement|undefined)[]) {
  const count = path.moves.filter((m,i) => hasDepositedMaterial(m,support?.[i])).length;
  const positions = new Float32Array(count * FLOATS_PER_MOVE);
  const normals = new Float32Array(positions.length);
  const indices = new Uint32Array(count * INDICES_PER_MOVE);
  const indexBefore = new Uint32Array(path.moves.length);
  let deposited = 0;
  path.moves.forEach((move, i) => {
    indexBefore[i] = deposited * INDICES_PER_MOVE;
    if (!hasDepositedMaterial(move,support?.[i])) return;
    writeBead(move, 1, positions, normals, deposited * FLOATS_PER_MOVE,residue?.[i],support?.[i]);
    const vertex = deposited * SIDES * 2;
    for (let j = 0; j < SIDES; j++) {
      const a = vertex + j, b = vertex + (j + 1) % SIDES;
      indices.set([a, b, a + SIDES, b, b + SIDES, a + SIDES], deposited * INDICES_PER_MOVE + j * 6);
    }
    deposited++;
  });
  if(residue||support)for(let i=0;i<positions.length;i+=3){
    const x=positions[i],y=positions[i+1],z=positions[i+2];
    if(![x,y,z].every(Number.isFinite)||Math.hypot(x-MACHINE.centreXY[0],y-MACHINE.centreXY[1])>MACHINE.diameterMm/2-path.buildVolume.safetyMarginMm+1e-5||
      z<MACHINE.surfaceZMm-1e-5||z>MACHINE.heightMm-path.buildVolume.safetyMarginMm+1e-5)
      throw new Error("Material residue exceeds the machine envelope or safety margin.");
  }
  return { positions, normals, indices, indexBefore };
}
