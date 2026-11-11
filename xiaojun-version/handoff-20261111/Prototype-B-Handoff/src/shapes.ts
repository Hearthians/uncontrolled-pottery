import type { Contour, CylinderParameters, XYZ } from "./toolpath.ts";

export const SHAPE_FAMILIES = ["cylinder", "tapered", "bulbous"] as const;
export type ShapeFamily = typeof SHAPE_FAMILIES[number];
export const SHAPE_LABELS: Record<ShapeFamily, string> = {
  cylinder: "Cylinder", tapered: "Tapered", bulbous: "Bulbous",
};
export const SCULPTURAL_MODIFIERS = ["soft-organic-fold", "twisted", "ribbed"] as const;
export type SculpturalModifier = "none" | typeof SCULPTURAL_MODIFIERS[number];
export const MODIFIER_LABELS = { "soft-organic-fold": "Soft Organic Folded", twisted: "Spiral / Twisted", ribbed: "Ribbed / Patterned Relief" };
export type ShapeParameters = {
  taper: number; bulge: number;
  sculpturalIntensity: number; twistAngle: number; twistDirection: number; twistVariation: number;
  lobeCount: number; twistAmplitude: number; twistPhase: number;
  ribCount: number; ribDepth: number; ribSharpness: number; ribPhase: number; ribHeightVariation: number;
  foldAmplitude: number; foldCount: number; foldPosition: number;
  foldHeight: number; foldSpread: number; asymmetry: number;
};
export type ShapeRequest = {
  family: ShapeFamily; seed: number; modifier?: SculpturalModifier;
  parameters?: Partial<ShapeParameters>;
  maxLayerDisplacementMm?: number;
};
export type ShapeWarning = {
  code: "layer-displacement" | "tight-curvature" | "minimum-radius";
  layerId: number; measuredMm: number; limitMm: number; message: string;
};
export type ShapeDescriptor = {
  modifier?: SculpturalModifier;
  version: 2; family: ShapeFamily; seed: number; parameters: ShapeParameters;
  heightMm: number; radiusMm: number; layerHeightMm: number; layerCount: number;
  maxLayerDisplacementMm: number;
  layers: { layerId: number; zMm: number; normalizedHeight: number;
    contourLengthMm: number; maxLateralDisplacementMm: number }[];
  warnings: ShapeWarning[];
};

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Initial/random family selection is itself reproducible from the recorded seed.
export function shapeFromSeed(seed: number): ShapeRequest {
  const rng = random(seed);
  return { family: SHAPE_FAMILIES[Math.floor(rng() * SHAPE_FAMILIES.length)], seed,
    modifier: SCULPTURAL_MODIFIERS[Math.floor(rng() * 3)], parameters: { foldAmplitude: .6 } };
}

export function resolveShape(request: ShapeRequest): ShapeParameters {
  if (!SHAPE_FAMILIES.includes(request.family) || !Number.isInteger(request.seed) ||
      request.seed < 0 || request.seed > 4294967295)
    throw new Error("Choose a valid base shape and an integer seed from 0 to 4294967295.");
  if (request.modifier && request.modifier !== "none" && !SCULPTURAL_MODIFIERS.includes(request.modifier))
    throw new Error("Unknown sculptural modifier.");
  const rng = random(request.seed);
  const ribbed = request.modifier === "ribbed";
  const p: ShapeParameters = {
    taper: request.family === "tapered" ? .2 : 0,
    bulge: request.family === "bulbous" ? .2 : 0,
    foldAmplitude: 0, foldCount: 2 + Math.floor(rng() * 2),
    foldPosition: rng() * Math.PI * 2, foldHeight: .35 + rng() * .3,
    foldSpread: .25 + rng() * .1, asymmetry: .2 + rng() * .3,
    sculpturalIntensity: .6, twistAngle: Math.PI * (.6 + rng()), twistDirection: rng() < .5 ? -1 : 1,
    twistVariation: (rng() - .5), lobeCount: 3 + Math.floor(rng() * 3),
    twistAmplitude: .1 + rng() * .06, twistPhase: rng() * Math.PI * 2,
    ribCount: 8 + Math.floor(rng() * (ribbed ? 5 : 9)), ribDepth: (ribbed ? .10 : .06) + rng() * (ribbed ? .02 : .06),
    ribSharpness: (ribbed ? 1.1 : 1) + rng() * (ribbed ? .4 : 2), ribPhase: rng() * Math.PI * 2,
    ribHeightVariation: (ribbed ? .05 : .2) + rng() * (ribbed ? .1 : .5),
    ...request.parameters,
  };
  const limits: Record<keyof ShapeParameters, [number, number]> = {
    sculpturalIntensity: [0, 1], twistAngle: [0, Math.PI * 2], twistDirection: [-1, 1], twistVariation: [-.8, .8],
    lobeCount: [2, 6], twistAmplitude: [0, .18], twistPhase: [-Math.PI * 2, Math.PI * 2],
    ribCount: [4, 24], ribDepth: [0, .15], ribSharpness: [1, 4], ribPhase: [-Math.PI * 2, Math.PI * 2], ribHeightVariation: [0, 1],
    taper: [-.35, .35], bulge: [0, .4], foldAmplitude: [0, 1], foldCount: [2, 4],
    foldPosition: [-Math.PI * 2, Math.PI * 2], foldHeight: [.2, .8],
    foldSpread: [.2, .4], asymmetry: [0, .6],
  };
  for (const key of Object.keys(limits) as (keyof ShapeParameters)[]) {
    const [min, max] = limits[key];
    if (!Number.isFinite(p[key]) || p[key] < min || p[key] > max)
      throw new Error(`Shape parameter out of range: ${key}`);
  }
  if (!Number.isInteger(p.foldCount)) throw new Error("Fold count must be an integer.");
  if (!Number.isInteger(p.lobeCount) || !Number.isInteger(p.ribCount) || Math.abs(p.twistDirection) !== 1)
    throw new Error("Feature counts must be integers; twist direction must be -1 or 1.");
  return p;
}

// Neutral silhouette and folds share one P(theta,z); no mesh/library dependencies.
export function vesselPoint(theta: number, zMm: number, dimensions: CylinderParameters,
  p: ShapeParameters, modifier: SculpturalModifier = "soft-organic-fold"): XYZ {
  const u = zMm / dimensions.heightMm;
  const smoothHeight = u * u * (3 - 2 * u);
  const profile = 1 + p.taper * (2 * smoothHeight - 1) + p.bulge * Math.sin(Math.PI * u) ** 2;
  const radius = dimensions.radiusMm * profile;
  const angle = theta - p.foldPosition;
  const envelope = Math.sin(Math.PI * u) ** 2 *
    Math.exp(-.5 * ((u - p.foldHeight) / p.foldSpread) ** 2);
  const folds = (Math.sin(p.foldCount * angle) + p.asymmetry * Math.cos(angle)) / (1 + p.asymmetry);
  // At most 18% relative deviation, reduced for short wide shapes. Amplitude gates
  // every modifier term, so zero recovers the neutral shape even with asymmetry.
  const strength = .18 * p.foldAmplitude * Math.min(1, dimensions.heightMm / (2 * dimensions.radiusMm));
  let deformation = modifier === "soft-organic-fold" ? strength * envelope * folds : 0;
  const damping = Math.min(1, dimensions.heightMm / (2 * dimensions.radiusMm));
  if (modifier === "twisted") {
    const phase = p.twistPhase + p.twistDirection * p.twistAngle *
      (u + p.twistVariation * Math.sin(2 * Math.PI * u) / (2 * Math.PI));
    deformation = damping * p.sculpturalIntensity * p.twistAmplitude * Math.cos(p.lobeCount * (theta - phase));
  } else if (modifier === "ribbed") {
    const wave = 2 * ((1 + Math.cos(p.ribCount * (theta - p.ribPhase))) / 2) ** p.ribSharpness - 1;
    deformation = damping * p.sculpturalIntensity * p.ribDepth * wave *
      (1 - p.ribHeightVariation + p.ribHeightVariation * Math.sin(Math.PI * u) ** 2);
  }
  const r = radius * (1 + deformation);
  if (!(r > 0) || !Number.isFinite(r)) throw new Error("Shape radius must remain positive and finite.");
  return [r * Math.cos(theta), r * Math.sin(theta), zMm];
}

/** @internal Raw contour stage; use generateBaseGeometry for validated library results. */
export function generateShape(dimensions: CylinderParameters, layers: Contour[], request: ShapeRequest) {
  const parameters = resolveShape(request);
  const threshold = request.maxLayerDisplacementMm ?? .7;
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error("Layer displacement threshold must be positive.");
  const modifier = request.modifier ?? "soft-organic-fold";
  let segments = layers[0].points.length - 1;
  // At least 24 samples/feature, rising to 48 for the sharpest supported ribs.
  if (parameters.sculpturalIntensity > 0) {
    if (modifier === "twisted" && parameters.twistAmplitude > 0) segments = Math.max(segments, parameters.lobeCount * 24);
    if (modifier === "ribbed" && parameters.ribDepth > 0) segments = Math.max(segments,
      parameters.ribCount * Math.ceil(24 * Math.sqrt(parameters.ribSharpness)));
  }
  if (segments * layers.length > 200000) throw new Error("Shape exceeds the interactive limit of 200000 segments.");
  // Positive radii in ordered angular wedges (< pi) guarantee simple closed polygons.
  const contours = layers.map(layer => {
    const points = Array.from({ length: segments }, (_, i) =>
      vesselPoint(i / segments * 2 * Math.PI, layer.zMm, dimensions, parameters, modifier));
    points.push([...points[0]]);
    return { ...layer, points };
  });
  const warnings: ShapeWarning[] = [];
  const summaries = contours.map((layer, i) => {
    let length = 0, displacement = 0, minCurvatureRadius = Infinity, minRadius = Infinity;
    for (let j = 0; j < segments; j++) {
      const a = layer.points[j], b = layer.points[j + 1], c = layer.points[(j + 2) % segments];
      if (!a.every(Number.isFinite) || Math.hypot(a[0], a[1]) <= 0) throw new Error("Invalid contour radius or coordinates.");
      minRadius = Math.min(minRadius, Math.hypot(a[0], a[1]));
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
      length += ab;
      if (i) {
        const prev = contours[i - 1].points[j];
        displacement = Math.max(displacement, Math.hypot(a[0] - prev[0], a[1] - prev[1]));
      }
      const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (cross > 1e-10) minCurvatureRadius = Math.min(minCurvatureRadius,
        ab * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(c[0] - a[0], c[1] - a[1]) / (2 * cross));
    }
    if (minRadius < dimensions.beadWidthMm) warnings.push({ code: "minimum-radius", layerId: i,
      measuredMm: minRadius, limitMm: dimensions.beadWidthMm,
      message: `Layer ${i + 1}: radius approaches bead width; local clearance may be insufficient.` });
    if (displacement > threshold) warnings.push({ code: "layer-displacement", layerId: i,
      measuredMm: displacement, limitMm: threshold,
      message: `Layer ${i + 1}: lateral shift ${displacement.toFixed(2)} mm exceeds ${threshold.toFixed(2)} mm; support may be insufficient.` });
    if (minCurvatureRadius < dimensions.beadWidthMm / 2) warnings.push({ code: "tight-curvature", layerId: i,
      measuredMm: minCurvatureRadius, limitMm: dimensions.beadWidthMm / 2,
      message: `Layer ${i + 1}: tight curvature may cause bead overlap.` });
    return { layerId: i, zMm: layer.zMm, normalizedHeight: layer.zMm / dimensions.heightMm,
      contourLengthMm: length, maxLateralDisplacementMm: displacement };
  });
  const descriptor: ShapeDescriptor = { version: 2, modifier, family: request.family, seed: request.seed,
    parameters, heightMm: dimensions.heightMm, radiusMm: dimensions.radiusMm,
    layerHeightMm: dimensions.layerHeightMm, layerCount: contours.length,
    maxLayerDisplacementMm: threshold, layers: summaries, warnings };
  return { contours, descriptor };
}
