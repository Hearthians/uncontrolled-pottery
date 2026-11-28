export const FORM = Object.freeze({
  version: 'fixed-twist-2', seed: 42,
  heightMm: 100, radiusMm: 49 / 1.075,
  lobes: 3, amplitude: 0.075, twistRadians: 150 * Math.PI / 180,
  taperStart: 0.25, topRadiusScale: 0.84,
  bottomLayers: 3, layerCount: 100, layerHeightMm: 1, segments: 320,
});
export const PRINT = Object.freeze({
  beadWidthMm: 2, beadHeightMm: 1, feedrateMmMin: 1200,
  travelFeedrateMmMin: 1800, clearanceMm: 5,
  // Nominal bead top; printer/nozzle calibration must replace this assumption.
  nozzleAboveBeadCentreMm: 0.5,
});
export const ENVELOPE = Object.freeze({diameterMm: 120, heightMm: 180});
