import type {Move, Toolpath, XYZ} from './toolpath.ts';

export const SIDES = 16;
export const INDICES_PER_MOVE = SIDES * 6;
export const FLOATS_PER_MOVE = SIDES * 2 * 3;

const contourSection = Array.from({length:SIDES}, (_, index) => {
  const angle=index*2*Math.PI/SIDES;
  const radius=(angle:number) => Math.sign(Math.cos(angle))*Math.abs(Math.cos(angle))**0.65;
  const vertical=(angle:number) => Math.max(-1,Math.min(1,Math.sin(angle)*1.42));
  return [radius(angle),vertical(angle),vertical(angle+0.001)-vertical(angle-0.001),radius(angle-0.001)-radius(angle+0.001),Math.cos(angle),Math.sin(angle)];
});

// Stable profile extracted from Prototype C claySurface; no width noise or deformation.
export function writeBead(move: Move, fraction: number, positions: Float32Array,
  normals: Float32Array, offset = 0) {
  if (move.kind === 'deposition' || move.kind === 'infill') {
    for (let ring=0;ring<2;ring++) {
      const centre=ring===0?move.beadStart:fraction===1?move.beadEnd:
        move.beadStart.map((value,axis)=>value+fraction*(move.beadEnd[axis]-value));
      const radius=Math.hypot(centre[0],centre[1]), radialX=-centre[0]/radius, radialY=-centre[1]/radius;
      const width=(move.beadWidthMm+ring*fraction*((move.beadEndWidthMm??move.beadWidthMm)-move.beadWidthMm))/2, height=move.beadHeightMm/2;
      if(move.beadFrames){
        const [start,end]=move.beadFrames,t=ring*fraction,round=start.round+t*(end.round-start.round);
        const lateral=start.side.map((v,k)=>v+t*(end.side[k]-v)),up=start.up.map((v,k)=>v+t*(end.up[k]-v));
        for(let side=0;side<SIDES;side++){
          const [radial,vertical,slope,depth,cos,sin]=contourSection[side];
          const across=width*(radial+round*(cos-radial)),above=height*(vertical+round*(sin-vertical));
          const normalR=height*((1-round)*slope+0.002*round*cos),normalZ=width*((1-round)*depth+0.002*round*sin);
          const norm=Math.hypot(normalR,normalZ);
          for(let axis=0;axis<3;axis++){
            const idx=offset+(ring*SIDES+side)*3+axis;
            positions[idx]=centre[axis]+lateral[axis]*across+up[axis]*above;
            normals[idx]=(lateral[axis]*normalR+up[axis]*normalZ)/norm;
          }
        }
        continue;
      }
      for(let side=0;side<SIDES;side++) {
        const [radial,vertical,slope,depth]=contourSection[side], normalR=slope*height, normalZ=depth*width;
        const norm=Math.sqrt(normalR*normalR+normalZ*normalZ), index=offset+(ring*SIDES+side)*3;
        positions[index]=centre[0]+radial*width*radialX; positions[index+1]=centre[1]+radial*width*radialY; positions[index+2]=centre[2]+vertical*height;
        normals[index]=normalR*radialX/norm; normals[index+1]=normalR*radialY/norm; normals[index+2]=normalZ/norm;
      }
    }
    return;
  }
  const d = move.beadEnd.map((v, i) => (v - move.beadStart[i]) / move.lengthMm);
  const horizontal = Math.hypot(d[0], d[1]);
  const side: XYZ = horizontal > 1e-8 ? [-d[1] / horizontal, d[0] / horizontal, 0] : [1, 0, 0];
  const cross = [d[1] * side[2] - d[2] * side[1], d[2] * side[0] - d[0] * side[2], d[0] * side[1] - d[1] * side[0]];
  const up = cross.map(v => v / Math.hypot(...cross));
  const height = move.beadHeightMm / 2;

  const profile = (angle: number, width: number) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [c * width, s * height];
  };
  for (let ring = 0; ring < 2; ring++) {
    const width = (move.beadWidthMm + ring * fraction * ((move.beadEndWidthMm ?? move.beadWidthMm) - move.beadWidthMm)) / 2;
    const centre = move.beadStart.map((v, k) => v + ring * fraction * (move.beadEnd[k] - v));
    const radial = side, vertical = up;
    for (let j = 0; j < SIDES; j++) {
      const angle = j / SIDES * Math.PI * 2, [r, z] = profile(angle, width);
      const before = profile(angle - 0.001, width), after = profile(angle + 0.001, width);
      const nr = after[1] - before[1], nz = before[0] - after[0];
      const normal = radial.map((v, k) => nr * v + nz * vertical[k]);
      const norm = Math.hypot(...normal);
      for (let k = 0; k < 3; k++) {
        const index = offset + (ring * SIDES + j) * 3 + k;
        positions[index] = centre[k] + r * radial[k] + z * vertical[k];
        normals[index] = normal[k] / norm;
      }
    }
  }
}

export function beadBuffers(path: Pick<Toolpath, 'moves'>) {
  const count = path.moves.filter(m => m.extrude).length;
  const positions = new Float32Array(count * FLOATS_PER_MOVE);
  const normals = new Float32Array(positions.length);
  const indices = new Uint32Array(count * INDICES_PER_MOVE);
  const indexBefore = new Uint32Array(path.moves.length);
  let deposited = 0;
  path.moves.forEach((move, i) => {
    indexBefore[i] = deposited * INDICES_PER_MOVE;
    if (!move.extrude) return;
    writeBead(move, 1, positions, normals, deposited * FLOATS_PER_MOVE);
    const vertex = deposited * SIDES * 2;
    for (let j = 0; j < SIDES; j++) {
      const a = vertex + j, b = vertex + (j + 1) % SIDES;
      indices.set([a, b, a + SIDES, b, b + SIDES, a + SIDES], deposited * INDICES_PER_MOVE + j * 6);
    }
    deposited++;
  });
  return { positions, normals, indices, indexBefore };
}
