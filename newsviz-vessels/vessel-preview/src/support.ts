import {supportCell} from './sagFold.ts';
import type {Toolpath, XYZ} from './toolpath.ts';

const distanceXY = (p: XYZ, a: XYZ, b: XYZ) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

// shortcut: XY bead-strip midpoint sampling ignores forces and seam transitions; upgrade after support calibration.
export function supportDiagnostics(path: Toolpath) {
  const occupancy = path.geometry.contours.map(c => path.moves.filter(m => m.layerId === c.layerId && (m.kind === 'deposition' || m.kind === 'infill') && m.extrude));
  return occupancy.map((depositedSegments, i) => {
    const previousLayerOccupancy = i ? occupancy[i - 1] : [];
    const samples: {position: XYZ; lengthMm: number; overlap: number; startMm: number}[] = [];
    const unsupportedSpans: {startMm: number; endMm: number; lengthMm: number}[] = [];
    let arc = 0, overlapLength = 0, depositedLength = 0;
    for (const m of path.moves.filter(m => m.layerId === i + 1 && (m.kind === 'deposition' || m.kind === 'infill'))) {
      if (m.extrude) {
        const count = Math.ceil(m.lengthMm / 0.5), lengthMm = m.lengthMm / count;
        for (let j = 0; j < count; j++) {
          const position = m.beadStart.map((v, k) => v + (m.beadEnd[k] - v) * (j + 0.5) / count) as unknown as XYZ;
          let overlap = i === 0 ? 1 : 0;
          for (const lower of supportCell(previousLayerOccupancy,position)) overlap = Math.max(overlap, 1 - distanceXY(position, lower.beadStart, lower.beadEnd) / ((m.beadWidthMm + lower.beadWidthMm) / 2));
          const startMm = arc + j * lengthMm;
          samples.push({position, lengthMm, overlap, startMm});
          overlapLength += overlap * lengthMm; depositedLength += lengthMm;
          if (overlap === 0) {
            const last = unsupportedSpans.at(-1);
            if (last && Math.abs(last.endMm - startMm) < 1e-8) {last.endMm += lengthMm; last.lengthMm += lengthMm;}
            else unsupportedSpans.push({startMm, endMm: startMm + lengthMm, lengthMm});
          }
        }
      }
      arc += m.lengthMm;
    }
    // Merge a span crossing the closed-contour seam; endMm may exceed contour length.
    const first = unsupportedSpans[0], last = unsupportedSpans.at(-1);
    if (unsupportedSpans.length > 1 && first.startMm < 1e-8 && last && Math.abs(last.endMm - arc) < 1e-8) {
      last.endMm += first.lengthMm; last.lengthMm += first.lengthMm; unsupportedSpans.shift();
    }
    return {layerId: i + 1, depositedSegments, previousLayerOccupancy, samples, unsupportedSpans,
      overlapCoverage: depositedLength ? overlapLength / depositedLength : 0,
      unsupportedLengthMm: unsupportedSpans.reduce((sum, s) => sum + s.lengthMm, 0)};
  });
}
