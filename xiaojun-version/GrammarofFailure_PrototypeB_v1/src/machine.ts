import type { Move } from "./toolpath.ts";
import { BEAD_WIDTH_VARIATION } from "./claySurface.ts";

export const MACHINE = Object.freeze({
  name: "Delta WASP 2040 Clay", volume: "cylindrical",
  diameterMm: 200, heightMm: 400, centreXY: Object.freeze([0, 0] as const),
  surfaceZMm: 0, safetyMarginMm: 5,
});
export class BuildVolumeError extends Error {}
export type Envelope = { min: number[]; max: number[]; radiusMm: number };
export type BuildVolumeValidation = {
  valid: boolean; safetyMarginMm: number; nozzle: Envelope; deposited: Envelope; issues: string[];
};

// Convex swept envelopes bound every point on linear moves, including partial beads.
// Side/top clearance is optional; the bed remains Z=0 for first-layer contact.
export function validateBuildVolume(moves: readonly Move[], safetyMarginMm: number = MACHINE.safetyMarginMm): BuildVolumeValidation {
  if (!Number.isFinite(safetyMarginMm) || safetyMarginMm < 0 || safetyMarginMm >= MACHINE.diameterMm / 2)
    throw new Error("Safety margin must be finite and between 0 and 100 mm (exclusive upper limit).");
  const empty = (): Envelope => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], radiusMm: 0 });
  const nozzle = empty(), deposited = empty(), issues: string[] = [];
  const include = (box: Envelope, p: readonly number[], xy: number, z: number) => {
    const extent = [xy, xy, z];
    for (let axis = 0; axis < 3; axis++) {
      box.min[axis] = Math.min(box.min[axis], p[axis] - extent[axis]);
      box.max[axis] = Math.max(box.max[axis], p[axis] + extent[axis]);
    }
    box.radiusMm = Math.max(box.radiusMm, Math.hypot(p[0] - MACHINE.centreXY[0], p[1] - MACHINE.centreXY[1]) + xy);
  };
  if (!moves.length) issues.push("Toolpath is empty.");
  for (const move of moves) {
    if (![...move.start, ...move.end].every(Number.isFinite) || move.start.length !== 3 || move.end.length !== 3) {
      issues.push("Toolpath coordinates must be finite XYZ values."); break;
    }
    for (const p of [move.start, move.end]) include(nozzle, p, 0, 0);
    if (!move.extrude) continue;
    if (![move.beadWidthMm, move.beadHeightMm].every(v => Number.isFinite(v) && v > 0)) {
      issues.push("Deposited bead dimensions must be positive and finite."); break;
    }
    const width = move.beadWidthMm / 2 * (1 + BEAD_WIDTH_VARIATION), height = move.beadHeightMm / 2;
    const dx = move.end[0] - move.start[0], dy = move.end[1] - move.start[1], dz = move.end[2] - move.start[2];
    const length = Math.hypot(dx, dy, dz);
    if (!length) { issues.push("Depositing moves must have nonzero length."); break; }
    const xy = move.kind === "deposition" ? width : Math.max(width, height * Math.abs(dz) / length);
    const z = move.kind === "deposition" ? height : height * Math.hypot(dx, dy) / length;
    for (const p of [move.start, move.end]) include(deposited, p, xy, z);
  }
  const check = (box: Envelope, label: string) => {
    if (box.min[0] === Infinity) return;
    const radius = MACHINE.diameterMm / 2, top = MACHINE.surfaceZMm + MACHINE.heightMm;
    if (box.radiusMm > radius + 1e-7)
      issues.push(`${label}: radial extent ${box.radiusMm.toFixed(3)} mm exceeds nominal radius ${radius} mm.`);
    else if (box.radiusMm > radius - safetyMarginMm + 1e-7)
      issues.push(`${label}: radial extent ${box.radiusMm.toFixed(3)} mm exceeds safety radius ${radius - safetyMarginMm} mm (${safetyMarginMm} mm margin).`);
    if (box.min[2] < MACHINE.surfaceZMm - 1e-7)
      issues.push(`${label}: Z=${box.min[2].toFixed(3)} mm is below the build surface Z=${MACHINE.surfaceZMm} mm.`);
    if (box.max[2] > top + 1e-7)
      issues.push(`${label}: Z=${box.max[2].toFixed(3)} mm exceeds nominal height ${top} mm.`);
    else if (box.max[2] > top - safetyMarginMm + 1e-7)
      issues.push(`${label}: Z=${box.max[2].toFixed(3)} mm exceeds safety height ${top - safetyMarginMm} mm (${safetyMarginMm} mm margin).`);
  };
  check(nozzle, "Nozzle path"); check(deposited, "Deposited clay envelope");
  return { valid: !issues.length, safetyMarginMm, nozzle, deposited, issues };
}

export function requireBuildVolume(moves: readonly Move[], safetyMarginMm: number = MACHINE.safetyMarginMm) {
  const result = validateBuildVolume(moves, safetyMarginMm);
  if (!result.valid) throw new BuildVolumeError(`Build-volume rejected: ${result.issues.join(" ")}`);
  return result;
}
