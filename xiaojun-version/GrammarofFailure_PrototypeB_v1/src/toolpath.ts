import { MACHINE, BuildVolumeError, requireBuildVolume } from "./machine.ts";
import type { BuildVolumeValidation } from "./machine.ts";
import { generateShape, shapeFromSeed } from "./shapes.ts";
import type { ShapeDescriptor, ShapeRequest } from "./shapes.ts";
export type XYZ = readonly [number, number, number];
/** Geometry dimensions only; all coordinates and lengths use millimetres. */
export type GeometryDimensions = { heightMm: number; radiusMm: number };
/** Layer spacing; angular sampling policy remains unchanged and is versioned separately. */
export type ContourSamplingParameters = { layerHeightMm: number };
export type DepositionSettings = { beadWidthMm: number; feedrateMmMin: number };
/** Backward-compatible input used by the existing UI and playback pipeline. */
export type CylinderParameters = GeometryDimensions & ContourSamplingParameters & DepositionSettings;
export const CONTOUR_SAMPLING_POLICY = Object.freeze({
  angularPolicy: "uniform-angle-reference-radius" as const, referenceArcStepMm: 1, minSegments: 32, featureSamples: 24, maxSharpRibSamples: 48,
});
export const TOOLPATH_CONVENTIONS = Object.freeze({ travelFeedrateMmMin: 1800, clearanceMm: 5 });
export const DEFAULT_PARAMETERS: CylinderParameters = {
  heightMm: 20, radiusMm: 15, layerHeightMm: 1,
  beadWidthMm: 2, feedrateMmMin: 600,
};
export type Contour = {
  layerId: number; zMm: number; beadHeightMm: number; points: XYZ[];
};
export type Move = {
  kind: "deposition" | "transition" | "travel";
  start: XYZ; end: XYZ; layerId: number;
  feedrateMmMin: number; extrude: boolean;
  beadWidthMm: number; beadHeightMm: number;
  lengthMm: number; startTimeS: number; endTimeS: number;
};
export type Toolpath = {
  parameters: CylinderParameters; contours: Contour[]; moves: Move[];
  durationS: number; lengthMm: number; shape: ShapeDescriptor; buildVolume: BuildVolumeValidation;
};

export function cylinderContours(parameters: CylinderParameters): Contour[] {
  const { heightMm, radiusMm, layerHeightMm, beadWidthMm, feedrateMmMin } = parameters;
  for (const [name, value] of Object.entries({ heightMm, radiusMm, layerHeightMm, beadWidthMm, feedrateMmMin })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
  }
  if (heightMm > MACHINE.heightMm)
    throw new BuildVolumeError(`Build-volume rejected: model height ${heightMm} mm exceeds nominal height ${MACHINE.heightMm} mm.`);
  // Keep interactive allocations bounded; this prototype is not a general slicer.
  if (layerHeightMm < 0.1 ||
      beadWidthMm >= radiusMm * 2 || feedrateMmMin > 12000) {
    throw new Error("Outside prototype limits: layer ≥0.1 mm, bead < diameter, feed ≤12000 mm/min");
  }
  const segments = Math.max(CONTOUR_SAMPLING_POLICY.minSegments,
    Math.ceil(2 * Math.PI * radiusMm / CONTOUR_SAMPLING_POLICY.referenceArcStepMm));
  const count = Math.max(1, Math.ceil(heightMm / layerHeightMm - 1e-10));
  if (count * segments > 200000) throw new Error("Path exceeds the interactive limit of 200000 segments");
  return Array.from({ length: count }, (_, layerId) => {
    const bottom = layerId * layerHeightMm;
    const beadHeightMm = Math.min(layerHeightMm, heightMm - bottom);
    const zMm = bottom + beadHeightMm / 2;
    const points: XYZ[] = Array.from({ length: segments }, (_, i) => {
      const theta = i / segments * 2 * Math.PI;
      return [radiusMm * Math.cos(theta), radiusMm * Math.sin(theta), zMm];
    });
    points.push([...points[0]]); // Exact closure, including floating-point coordinates.
    return { layerId, zMm, beadHeightMm, points };
  });
}

export function generateToolpath(parameters: CylinderParameters, shape: ShapeRequest = { family: "cylinder", seed: 0 }, safetyMarginMm: number = MACHINE.safetyMarginMm): Toolpath {
  const { contours, descriptor } = generateShape(parameters, cylinderContours(parameters), shape);
  const moves: Move[] = [];
  let time = 0, length = 0;
  const add = (start: XYZ, end: XYZ, contour: Contour, kind: Move["kind"]) => {
    const lengthMm = Math.hypot(...end.map((value, i) => value - start[i]));
    const feedrateMmMin = kind === "travel" ? TOOLPATH_CONVENTIONS.travelFeedrateMmMin : parameters.feedrateMmMin;
    const endTimeS = time + lengthMm / (feedrateMmMin / 60);
    moves.push({ start, end, kind, layerId: contour.layerId, extrude: kind !== "travel",
      beadWidthMm: parameters.beadWidthMm, beadHeightMm: contour.beadHeightMm,
      feedrateMmMin, lengthMm, startTimeS: time, endTimeS });
    time = endTimeS;
    length += lengthMm;
  };
  const first = contours[0];
  const firstPoint = first.points[0];
  add([firstPoint[0], firstPoint[1], firstPoint[2] + TOOLPATH_CONVENTIONS.clearanceMm], firstPoint, first, "travel");
  for (const contour of contours) {
    if (contour.layerId > 0) {
      add(moves.at(-1)!.end, contour.points[0], contour, "transition");
    }
    for (let i = 1; i < contour.points.length; i++) {
      add(contour.points[i - 1], contour.points[i], contour, "deposition");
    }
  }
  const last = contours.at(-1)!;
  const end = moves.at(-1)!.end;
  add(end, [end[0], end[1], end[2] + TOOLPATH_CONVENTIONS.clearanceMm], last, "travel");
  return { parameters: { ...parameters }, contours, moves, durationS: time, lengthMm: length, shape: descriptor, buildVolume: requireBuildVolume(moves, safetyMarginMm) };
}

// Retry seeds, never dimensions or deformation. The accepted seed fully reproduces the result.
export function randomValidShape(parameters: CylinderParameters, seed: number, safetyMarginMm: number = MACHINE.safetyMarginMm, selection?: Pick<ShapeRequest, "family" | "modifier">) {
  let lastError: BuildVolumeError | undefined;
  for (let attempt = 0; attempt < 24; attempt++) {
    const shape = { ...shapeFromSeed(seed), ...selection };
    try { generateToolpath(parameters, shape, safetyMarginMm); return shape; }
    catch (error) { if (!(error instanceof BuildVolumeError)) throw error; lastError = error; }
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  }
  throw new BuildVolumeError(`No valid random shape after 24 attempts. ${lastError!.message}`);
}

export type PathSample = {
  moveIndex: number; fraction: number; position: XYZ; elapsedS: number;
};
export function sampleToolpath(path: Toolpath, elapsedS: number): PathSample {
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
  return { moveIndex: low, fraction, position, elapsedS: time };
}
