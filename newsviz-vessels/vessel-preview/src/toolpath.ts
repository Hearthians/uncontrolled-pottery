import {FORM, PRINT} from './config.ts';
import type {Geometry, XYZ} from './geometry.ts';
export type {XYZ} from './geometry.ts';
export type BeadFrame = {side:XYZ; up:XYZ; round:number};

export type Move = Readonly<{
  kind: 'deposition' | 'infill' | 'transition' | 'travel'; layerId: number; extrude: boolean;
  eventId?: number | null; sourceType?: 'gaps' | 'buldges' | 'misalignment' | 'sagging' | 'stable';
  flowMultiplier?:number; // Mean requested volume per unit length relative to nominal flow.
  beadFrames?:readonly [BeadFrame,BeadFrame];
  start: XYZ; end: XYZ; beadStart: XYZ; beadEnd: XYZ;
  beadWidthMm: number; beadEndWidthMm?: number; beadHeightMm: number; feedrateMmMin: number;
  lengthMm: number; startTimeS: number; endTimeS: number;
}>;

// start/end are nozzle-tip coordinates; beadStart/beadEnd are the nominal deposited centreline.
export function generateToolpath(geometry: Geometry) {
  const moves: Move[] = [], layerEndTimes: number[] = [];
  let time = 0, length = 0, depositedLength = 0;
  const tip = (p: XYZ): XYZ => Object.freeze([p[0], p[1], p[2] + PRINT.nozzleAboveBeadCentreMm]);
  const add = (a: XYZ, b: XYZ, layerId: number, kind: Move['kind']) => {
    const lengthMm = Math.hypot(...b.map((v, i) => v - a[i]));
    const feedrateMmMin = kind === 'travel' ? PRINT.travelFeedrateMmMin : PRINT.feedrateMmMin;
    const endTimeS = time + lengthMm * 60 / feedrateMmMin;
    moves.push(Object.freeze({kind, layerId, extrude: kind !== 'travel',
      start: tip(a), end: tip(b), beadStart: a, beadEnd: b,
      beadWidthMm: PRINT.beadWidthMm, beadHeightMm: PRINT.beadHeightMm,
      feedrateMmMin, lengthMm, startTimeS: time, endTimeS}));
    time = endTimeS; length += lengthMm;
    if (kind !== 'travel') depositedLength += lengthMm;
  };
  const first = geometry.contours[0].points[0];
  add(Object.freeze([first[0], first[1], first[2] + PRINT.clearanceMm]), first, 1, 'travel');
  for (const contour of geometry.contours) {
    if (contour.layerId > 1) add(moves.at(-1)!.beadEnd, contour.points[0], contour.layerId, 'transition');
    if (contour.layerId <= FORM.bottomLayers) {
      // Interpolate from a bead-radius core to this course's polar boundary.
      // At the widest lobe the tracks share a small bonding overlap.
      const radius = PRINT.beadWidthMm / 2;
      const outer = Math.max(...contour.points.map(([x,y]) => Math.hypot(x,y)));
      const tracks = Math.ceil((outer - radius) / (0.95 * PRINT.beadWidthMm));
      for (let track = 0; track < tracks; track++) {
        const fraction = track / tracks;
        let firstPoint: XYZ | undefined;
        // Sample aligned polar vertices, with fewer short moves near the centre.
        const stride = fraction < 0.25 ? 8 : 4;
        for (let i = 0; i < contour.points.length - 1; i += stride) {
          const [x,y,z] = contour.points[i];
          const scale = fraction + (1-fraction) * radius / Math.hypot(x,y);
          const point: XYZ = [x*scale,y*scale,z];
          add(moves.at(-1)!.beadEnd, point, contour.layerId, i ? 'infill' : 'travel');
          firstPoint ??= point;
        }
        add(moves.at(-1)!.beadEnd, firstPoint!, contour.layerId, 'infill');
      }
      add(moves.at(-1)!.beadEnd, contour.points[0], contour.layerId, 'travel');
    }
    for (let i = 1; i < contour.points.length; i++) add(contour.points[i - 1], contour.points[i], contour.layerId, 'deposition');
    layerEndTimes.push(time);
  }
  const last = moves.at(-1)!;
  add(last.beadEnd, Object.freeze([last.beadEnd[0], last.beadEnd[1], last.beadEnd[2] + PRINT.clearanceMm]), last.layerId, 'travel');
  return Object.freeze({geometry, moves: Object.freeze(moves), layerEndTimes: Object.freeze(layerEndTimes),
    durationS: time, lengthMm: length, depositedLengthMm: depositedLength});
}
export type Toolpath = ReturnType<typeof generateToolpath>;

// Binary-search playback sampling extracted from the previous toolpath module.
export function sampleToolpath(path: Toolpath, elapsedS: number) {
  if (!Number.isFinite(elapsedS)) throw new Error('Playback time must be finite');
  const time = Math.max(0, Math.min(path.durationS, elapsedS));
  let low = 0, high = path.moves.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (path.moves[mid].endTimeS <= time) low = mid + 1;
    else high = mid;
  }
  const move = path.moves[low];
  const fraction = Math.min(1, (time - move.startTimeS) / (move.endTimeS - move.startTimeS));
  const position = move.start.map((v, i) => v + (move.end[i] - v) * fraction) as unknown as XYZ;
  return {moveIndex: low, fraction, position, elapsedS: time};
}
export type PathSample = ReturnType<typeof sampleToolpath>;
