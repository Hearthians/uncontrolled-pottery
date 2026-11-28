import {ENVELOPE, FORM, PRINT} from './config.ts';
import type {Toolpath, XYZ} from './toolpath.ts';
import {FLOATS_PER_MOVE, writeBead} from './beadGeometry.ts';

export function validateToolpath(path: Toolpath, envelope: {diameterMm: number; heightMm: number} = ENVELOPE) {
  const fail = (message: string): never => {throw new Error(message);};
  const within = (p: readonly number[] | Float32Array) => p.length === 3 && p.every(Number.isFinite) &&
    Math.hypot(p[0], p[1]) <= envelope.diameterMm / 2 + 1e-5 && p[2] >= -1e-5 && p[2] <= envelope.heightMm + 1e-5;
  if (![envelope.diameterMm, envelope.heightMm].every(n => Number.isFinite(n) && n > 0)) fail('Invalid envelope');
  if (path.geometry.contours.length !== FORM.layerCount) fail('Incorrect layer count');
  let maxLayerShiftMm = 0;
  for (const [i, contour] of path.geometry.contours.entries()) {
    const points = contour.points, n = points.length - 1;
    if (contour.layerId !== i + 1 || contour.zMm !== (i + 0.5) * FORM.layerHeightMm || n !== FORM.segments) fail('Invalid contour metadata');
    if (!points[0].every((v, k) => v === points[n][k])) fail('Contour is not closed');
    let turn = 0;
    for (let j = 0; j < n; j++) {
      const a = points[j], b = points[j + 1];
      if (!within(a) || a[2] !== contour.zMm) fail('Invalid contour coordinates');
      const cross = a[0] * b[1] - a[1] * b[0];
      if (!(cross > 0)) fail('Invalid contour winding');
      turn += Math.atan2(cross, a[0] * b[0] + a[1] * b[1]);
      if (i) {
        const lower = path.geometry.contours[i - 1].points[j];
        maxLayerShiftMm = Math.max(maxLayerShiftMm, Math.hypot(a[0] - lower[0], a[1] - lower[1]));
      }
    }
    if (Math.abs(turn - 2 * Math.PI) > 1e-7) fail('Invalid polar contour');
  }
  if (path.moves.length > 200000 || !path.moves.length) fail('Invalid command count');
  let endTime = 0, totalLength = 0, radius = 0, top = 0, bottom = Infinity;
  const positions = new Float32Array(FLOATS_PER_MOVE), normals = new Float32Array(FLOATS_PER_MOVE);
  for (const [i, m] of path.moves.entries()) {
    if (!['travel', 'deposition', 'infill', 'transition'].includes(m.kind) || typeof m.extrude !== 'boolean' ||
      (m.kind === 'travel' && m.extrude) || (m.kind === 'transition' && !m.extrude) ||
      !Number.isInteger(m.layerId) || m.layerId < 1 || m.layerId > FORM.layerCount ||
      ![m.lengthMm, m.feedrateMmMin, m.startTimeS, m.endTimeS, m.beadWidthMm, m.beadHeightMm].every(Number.isFinite) ||
      m.lengthMm <= 0 || m.feedrateMmMin <= 0 || m.beadWidthMm <= 0 || m.beadHeightMm <= 0 ||
      m.startTimeS !== endTime || m.endTimeS <= m.startTimeS) fail('Invalid command sequence');
    if (!within(m.start) || !within(m.end)) fail('Nozzle exceeds envelope');
    if (i && !m.start.every((v, k) => v === path.moves[i - 1].end[k])) fail('Disconnected commands');
    const length = Math.hypot(...m.end.map((v, k) => v - m.start[k]));
    if (Math.abs(length - m.lengthMm) > 1e-7 || Math.abs(m.endTimeS - m.startTimeS - length * 60 / m.feedrateMmMin) > 1e-7) fail('Invalid command timing');
    for (const [tip, bead] of [[m.start, m.beadStart], [m.end, m.beadEnd]] as [XYZ, XYZ][]) {
      if (!bead.every(Number.isFinite) || tip[0] !== bead[0] || tip[1] !== bead[1] || Math.abs(tip[2] - bead[2] - PRINT.nozzleAboveBeadCentreMm) > 1e-7) fail('Invalid nozzle/bead convention');
    }
    if (m.extrude) {
      writeBead(m, 1, positions, normals);
      for (let j = 0; j < positions.length; j += 3) {
        const p = positions.subarray(j, j + 3);
        if (!within(p)) fail('Deposited bead exceeds envelope');
        radius = Math.max(radius, Math.hypot(p[0], p[1]));
        top = Math.max(top, p[2]); bottom = Math.min(bottom, p[2]);
      }
    }
    totalLength += length; endTime = m.endTimeS;
  }
  if (endTime !== path.durationS || Math.abs(totalLength - path.lengthMm) > 1e-6) fail('Incorrect path totals');
  if (maxLayerShiftMm > PRINT.beadWidthMm / 4) fail('Baseline layer displacement exceeds overlap allowance');
  return Object.freeze({diameterMm: radius * 2, heightMm: top - bottom, maxLayerShiftMm});
}
