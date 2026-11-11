/** Public base-geometry library entry point. No renderer, memory or emotion dependencies. */
import { generateToolpath, CONTOUR_SAMPLING_POLICY, TOOLPATH_CONVENTIONS } from "./toolpath.ts";
import type { GeometryDimensions, ContourSamplingParameters, DepositionSettings, Contour, Move } from "./toolpath.ts";
import type { ShapeDescriptor, ShapeFamily, ShapeParameters, SculpturalModifier } from "./shapes.ts";
import { validateGeneratedContours } from "./geometryValidation.ts";
import { resolveShape, SCULPTURAL_MODIFIERS } from "./shapes.ts";
import { MACHINE, BuildVolumeError } from "./machine.ts";
import type { BuildVolumeValidation } from "./machine.ts";

export { BuildVolumeError } from "./machine.ts";
export type { BuildVolumeValidation } from "./machine.ts";
export type { GeometryDimensions, ContourSamplingParameters, DepositionSettings, Contour, Move } from "./toolpath.ts";
export type { ShapeDescriptor, ShapeFamily, ShapeParameters, SculpturalModifier } from "./shapes.ts";
export const GEOMETRY_SCHEMA_VERSION = "1.1.0" as const;
export const GEOMETRY_GENERATOR_VERSION = "1.1.1" as const;
export const COORDINATE_CONVENTIONS = Object.freeze({
  units: "mm", upAxis: "Z", handedness: "right-handed",
  origin: "build-plate-centre-at-surface", layerZ: "bead-centre",
  normalizedHeight: "zMm/heightMm", winding: "counterclockwise-viewed-from-positive-Z",
  closure: "repeated-first-point", seam: "theta=0-positive-X",
} as const);
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/** All four input groups are independent. Omitted validation options use existing defaults. */
export type GeometryRequest = DeepReadonly<{
  geometry: GeometryDimensions & { baseProfile: ShapeFamily; modifier?: SculpturalModifier; seed: number; parameters?: Partial<ShapeParameters> };
  sampling: ContourSamplingParameters & Partial<typeof CONTOUR_SAMPLING_POLICY>;
  machine?: Omit<typeof MACHINE, "safetyMarginMm"> & { safetyMarginMm?: number };
  printing: DepositionSettings;
  validation?: { safetyMarginMm?: number; maxLayerDisplacementMm?: number };
}>;
/** Extends the existing contour with the corresponding descriptor's layer metadata. */
export type GeometryLayer = DeepReadonly<Contour & ShapeDescriptor["layers"][number]>;
export type GeometryResult = DeepReadonly<{
  schemaVersion: typeof GEOMETRY_SCHEMA_VERSION;
  generatorVersion: typeof GEOMETRY_GENERATOR_VERSION;
  /** SHA-256 of canonical resolved generation identity; excludes printing/validation settings. */
  geometryId: string;
  coordinates: typeof COORDINATE_CONVENTIONS;
  geometry: GeometryDimensions & { baseProfile: ShapeFamily; modifier: SculpturalModifier; seed: number; parameters: ShapeParameters };
  sampling: ContourSamplingParameters & typeof CONTOUR_SAMPLING_POLICY & { segmentsPerContour: number };
  printing: DepositionSettings & typeof TOOLPATH_CONVENTIONS;
  descriptor: ShapeDescriptor;
  contours: GeometryLayer[];
  toolpath: { moves: Move[]; lengthMm: number; durationS: number };
  validation: {
    status: "valid" | "valid-with-warnings";
    warnings: ShapeDescriptor["warnings"];
    machine: Omit<typeof MACHINE, "safetyMarginMm">;
    buildVolume: BuildVolumeValidation;
  };
}>;

/** Layer-addressed handoff only. Parameter names/units belong to the future operator schema. */
export type FailureParameterSchedule<TParameters extends Record<string, number>> = DeepReadonly<{
  schemaVersion: "1.0.0";
  geometryId: string;
  /** Namespaced, versioned identifier agreed by the two workstreams. */
  parameterSchema: string;
  entries: { layerId: number; parameters: TParameters }[];
}>;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value as DeepReadonly<T>;
}

/** Generates and validates an immutable snapshot; invalid geometry throws before publication.
 * Async only for portable SHA-256 (Web Crypto in modern browsers and Node 24).
 */
export async function generateGeometry(request: GeometryRequest): Promise<GeometryResult> {
  validateRequest(request);
  const { heightMm, radiusMm, baseProfile, seed, parameters } = request.geometry;
  const sampling = { layerHeightMm: request.sampling.layerHeightMm, ...CONTOUR_SAMPLING_POLICY };
  const printing = { beadWidthMm: request.printing.beadWidthMm,
    feedrateMmMin: request.printing.feedrateMmMin, ...TOOLPATH_CONVENTIONS };
  const path = generateToolpath({ heightMm, radiusMm, layerHeightMm: sampling.layerHeightMm,
    beadWidthMm: printing.beadWidthMm, feedrateMmMin: printing.feedrateMmMin },
    { family: baseProfile, modifier: request.geometry.modifier, seed, parameters, maxLayerDisplacementMm: request.validation?.maxLayerDisplacementMm },
    request.validation?.safetyMarginMm ?? request.machine?.safetyMarginMm ?? MACHINE.safetyMarginMm);
  validateGeneratedContours(path);
  const selectedModifier = request.geometry.modifier ?? "soft-organic-fold";
  const p = path.shape.parameters;
  const modifier: SculpturalModifier = selectedModifier === "soft-organic-fold"
    ? (p.foldAmplitude === 0 ? "none" : selectedModifier)
    : (p.sculpturalIntensity === 0 ? "none" : selectedModifier);
  const geometry = { heightMm, radiusMm, baseProfile, modifier, seed, parameters: path.shape.parameters };
  const resolvedSampling = { ...sampling, segmentsPerContour: path.contours[0].points.length - 1 };
  // An explicit field order and sorted parameter keys avoid input property-order differences.
  const identity = JSON.stringify([GEOMETRY_GENERATOR_VERSION, COORDINATE_CONVENTIONS,
    heightMm, radiusMm, baseProfile, modifier, seed,
    Object.entries(geometry.parameters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0), resolvedSampling]);
  const { safetyMarginMm: _defaultMargin, ...machine } = MACHINE;
  const snapshot = {
    schemaVersion: GEOMETRY_SCHEMA_VERSION, generatorVersion: GEOMETRY_GENERATOR_VERSION,
    coordinates: COORDINATE_CONVENTIONS, geometry, sampling: resolvedSampling, printing,
    descriptor: path.shape,
    contours: path.contours.map((contour, i) => ({ ...contour, ...path.shape.layers[i] })),
    toolpath: { moves: path.moves, lengthMm: path.lengthMm, durationS: path.durationS },
    validation: { status: path.shape.warnings.length ? "valid-with-warnings" as const : "valid" as const,
      warnings: path.shape.warnings, machine, buildVolume: path.buildVolume },
  };
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const geometryId = `gof-geometry-${GEOMETRY_GENERATOR_VERSION}-${Array.from(new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, "0")).join("")}`;
  return deepFreeze({ ...snapshot, geometryId });
}


export type GeometryGeneration =
  | { readonly ok: true; readonly geometry: GeometryResult }
  | { readonly ok: false; readonly errors: readonly { readonly code: "invalid-geometry" | "machine-envelope"; readonly message: string }[] };

/** Preferred public boundary. Never publishes partial or rejected geometry. */
export async function generateBaseGeometry(request: GeometryRequest): Promise<GeometryGeneration> {
  try { return Object.freeze({ ok: true, geometry: await generateGeometry(request) }); }
  catch (error) {
    return deepFreeze({ ok: false, errors: [{ code: error instanceof BuildVolumeError ? "machine-envelope" : "invalid-geometry",
      message: error instanceof Error ? error.message : "Geometry generation failed." }] });
  }
}

/** Defensive adapter for existing mutable playback/render APIs; copied once, never per frame. */
export function geometryToToolpath(result: GeometryResult): import("./toolpath.ts").Toolpath {
  return structuredClone({ parameters: {heightMm:result.geometry.heightMm, radiusMm:result.geometry.radiusMm,
    layerHeightMm:result.sampling.layerHeightMm, beadWidthMm:result.printing.beadWidthMm,
    feedrateMmMin:result.printing.feedrateMmMin}, contours:result.contours,
    moves:result.toolpath.moves, durationS:result.toolpath.durationS, lengthMm:result.toolpath.lengthMm,
    shape:result.descriptor, buildVolume:result.validation.buildVolume }) as unknown as import("./toolpath.ts").Toolpath;
}

function validateRequest(request: GeometryRequest): void {
  const object = (value: unknown, keys: readonly string[], label: string) => {
    if(!value || typeof value!=="object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    for(const key of Object.keys(value)) if(!keys.includes(key)) throw new Error(`Unsupported ${label} field: ${key}`);
  };
  object(request,["geometry","sampling","printing","validation","machine"],"request");
  object(request.geometry,["heightMm","radiusMm","baseProfile","modifier","seed","parameters"],"geometry");
  object(request.sampling,["layerHeightMm",...Object.keys(CONTOUR_SAMPLING_POLICY)],"sampling");
  object(request.printing,["beadWidthMm","feedrateMmMin"],"printing");
  if(request.geometry.modifier!==undefined && request.geometry.modifier!=="none" &&
    !SCULPTURAL_MODIFIERS.includes(request.geometry.modifier)) throw new Error("Unknown sculptural modifier.");
  if(request.geometry.parameters!==undefined) object(request.geometry.parameters,
    Object.keys(resolveShape({family:"cylinder",seed:0})),"shape parameters");
  if(request.validation!==undefined) object(request.validation,["safetyMarginMm","maxLayerDisplacementMm"],"validation");
  for(const [key,value] of Object.entries(request.validation ?? {}))
    if(value!==undefined && !Number.isFinite(value)) throw new Error(`Invalid validation setting: ${key}`);
  for(const [key,value] of Object.entries(CONTOUR_SAMPLING_POLICY)) {
    const supplied=(request.sampling as Record<string, unknown>)[key];
    if(supplied!==undefined && supplied!==value) throw new Error(`Unsupported sampling policy: ${key}`);
  }
  if(request.machine!==undefined) {
    object(request.machine,Object.keys(MACHINE),"machine");
    for(const [key,value] of Object.entries(MACHINE)) if(key!=="safetyMarginMm" &&
      JSON.stringify((request.machine as Record<string,unknown>)[key])!==JSON.stringify(value))
      throw new Error(`Unsupported machine configuration: ${key}. Only Delta WASP 2040 Clay is supported.`);
    if(request.machine.safetyMarginMm!==undefined && (!Number.isFinite(request.machine.safetyMarginMm) ||
      request.machine.safetyMarginMm<0 || request.machine.safetyMarginMm>=100)) throw new Error("Invalid machine safety margin.");
    if(request.machine.safetyMarginMm!==undefined && request.validation?.safetyMarginMm!==undefined &&
      request.machine.safetyMarginMm!==request.validation.safetyMarginMm) throw new Error("Conflicting safety margins.");
  }
}
