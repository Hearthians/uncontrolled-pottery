import type { Move, Toolpath, XYZ } from "./toolpath.ts";

export const SIDES = 8;
export const INDICES_PER_MOVE = SIDES * 6;
export const FLOATS_PER_MOVE = SIDES * 2 * 3;

// Geometry remains in millimetres, Z up. No renderer or DOM dependencies.
export function writeBead(move: Move, fraction: number, positions: Float32Array,
  normals: Float32Array, offset = 0) {
  const d = move.end.map((v, i) => (v - move.start[i]) / move.lengthMm);
  const horizontal = Math.hypot(d[0], d[1]);
  const side: XYZ = horizontal > 1e-8 ? [-d[1] / horizontal, d[0] / horizontal, 0] : [1, 0, 0];
  const up = [d[1] * side[2] - d[2] * side[1], d[2] * side[0] - d[0] * side[2], d[0] * side[1] - d[1] * side[0]];
  const width = move.beadWidthMm / 2;
  const height = (horizontal > 1e-8 ? move.beadHeightMm : move.beadWidthMm) / 2;
  for (let ring = 0; ring < 2; ring++) {
    for (let j = 0; j < SIDES; j++) {
      const angle = j / SIDES * Math.PI * 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      const n = side.map((v, axis) => c / width * v + s / height * up[axis]);
      const norm = Math.hypot(...n);
      for (let axis = 0; axis < 3; axis++) {
        const index = offset + (ring * SIDES + j) * 3 + axis;
        positions[index] = move.start[axis] + ring * fraction * (move.end[axis] - move.start[axis]) +
          width * c * side[axis] + height * s * up[axis];
        normals[index] = n[axis] / norm;
      }
    }
  }
}

export function beadBuffers(path: Toolpath) {
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
