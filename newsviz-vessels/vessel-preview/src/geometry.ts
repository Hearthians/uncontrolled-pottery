import {FORM} from './config.ts';

export type VesselForm = {
  version: string; seed: number; heightMm: number; radiusMm: number;
  lobes: number; amplitude: number; twistRadians: number;
  taperStart: number; topRadiusScale: number;
  bottomLayers: number; layerCount: number; layerHeightMm: number; segments: number;
};

export type XYZ = readonly [number, number, number];
export type Contour = Readonly<{layerId: number; zMm: number; points: readonly XYZ[]}>;
export function twistAt(zMm:number, form: VesselForm = FORM) {
  const u=zMm/form.heightMm;
  return form.twistRadians*u*u*(2-u);
}

// Adapted from Prototype C vesselPoint: one fixed polar contour with progressive twist.
export function vesselPoint(theta: number, zMm: number, form: VesselForm = FORM): XYZ {
  const u = zMm / form.heightMm;
  // Ease twist away from the base; taper smoothly above the lower quarter.
  const phase = twistAt(zMm, form);
  const t = Math.max(0, (u - form.taperStart) / (1 - form.taperStart));
  const taper = 1 - (1 - form.topRadiusScale) * t * t * (3 - 2 * t);
  const radius = form.radiusMm * taper * (1 + form.amplitude * Math.cos(form.lobes * (theta - phase)));
  return Object.freeze([radius * Math.cos(theta), radius * Math.sin(theta), zMm]);
}

export function generateGeometry(form: VesselForm = FORM) {
  const contours: Contour[] = Array.from({length: form.layerCount}, (_, i) => {
    const zMm = (i + 0.5) * form.layerHeightMm;
    const points = Array.from({length: form.segments}, (_, j) => vesselPoint(j * 2 * Math.PI / form.segments, zMm, form));
    points.push(points[0]);
    return Object.freeze({layerId: i + 1, zMm, points: Object.freeze(points)});
  });
  return Object.freeze({id: form.version, seed: form.seed, contours: Object.freeze(contours)});
}
export type Geometry = ReturnType<typeof generateGeometry>;
