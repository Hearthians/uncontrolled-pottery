/** Versioned transport for canonical base geometry; no Three.js dependencies. */
import { generateBaseGeometry, GEOMETRY_SCHEMA_VERSION, GEOMETRY_GENERATOR_VERSION } from "./geometry.ts";
import type { GeometryResult, GeometryGeneration, GeometryRequest, DeepReadonly } from "./geometry.ts";
export const GEOMETRY_FORMAT_VERSION = "1.0.0" as const;
export const MAX_GEOMETRY_JSON_BYTES = 32 * 1024 * 1024;
export type GeometryManifest = DeepReadonly<Pick<GeometryResult,
  "schemaVersion" | "generatorVersion" | "geometryId" | "coordinates" | "geometry"> & {
  format: "gof-geometry-manifest"; formatVersion: typeof GEOMETRY_FORMAT_VERSION;
  layerCount: number; layers: GeometryResult["descriptor"]["layers"];
  validation: Pick<GeometryResult["validation"], "status" | "warnings">;
}>;
export type FullGeometryExport = DeepReadonly<Omit<GeometryResult, "toolpath"> & {
  format: "gof-geometry-full"; formatVersion: typeof GEOMETRY_FORMAT_VERSION;
}>;
export function createGeometryManifest(geometry: GeometryResult): GeometryManifest {
  return Object.freeze({format:"gof-geometry-manifest",formatVersion:GEOMETRY_FORMAT_VERSION,
    schemaVersion:geometry.schemaVersion,generatorVersion:geometry.generatorVersion,geometryId:geometry.geometryId,
    coordinates:geometry.coordinates,geometry:geometry.geometry,layerCount:geometry.contours.length,
    layers:geometry.descriptor.layers,validation:Object.freeze({status:geometry.validation.status,warnings:geometry.validation.warnings})});
}
export function serializeGeometryManifest(geometry: GeometryResult): string {
  return JSON.stringify(createGeometryManifest(geometry));
}
function fullExport(geometry: GeometryResult): FullGeometryExport {
  const {toolpath: _moves, ...data}=geometry;
  return {format:"gof-geometry-full",formatVersion:GEOMETRY_FORMAT_VERSION,...data};
}
export function serializeFullGeometry(geometry: GeometryResult): string {
  const text=JSON.stringify(fullExport(geometry));
  if(new TextEncoder().encode(text).byteLength>MAX_GEOMETRY_JSON_BYTES) throw new Error("Geometry JSON exceeds 32 MiB.");
  return text;
}

// Bound untrusted object input as well as parsed JSON before replay/geometry allocation.
function inspectJson(value: unknown, depth=0, budget={nodes:0,characters:0}): void {
  if(depth>24 || ++budget.nodes>1500000) throw new Error("Oversized or excessively nested geometry data.");
  if(typeof value==="number") {if(!Number.isFinite(value)) throw new Error("Nonfinite JSON number.");return;}
  if(typeof value==="string") {budget.characters+=value.length;if(budget.characters>MAX_GEOMETRY_JSON_BYTES)throw new Error("Oversized strings.");return;}
  if(value===null || typeof value==="boolean")return;
  if(typeof value!=="object")throw new Error("Invalid JSON value.");
  const proto=Object.getPrototypeOf(value);
  if(!Array.isArray(value) && proto!==Object.prototype && proto!==null)throw new Error("JSON objects must be plain records.");
  const keys=Object.keys(value);
  if(keys.length>200001)throw new Error("Oversized JSON array or object.");
  if(Array.isArray(value) && value.length!==keys.length)throw new Error("Sparse JSON arrays are unsupported.");
  for(const key of keys) {
    if(["__proto__","constructor","prototype"].includes(key))throw new Error("Unsafe JSON field.");
    const property=Object.getOwnPropertyDescriptor(value,key)!;
    if(!("value" in property))throw new Error("JSON accessors are unsupported.");
    inspectJson(property.value,depth+1,budget);
  }
}
function equalJson(a: unknown,b: unknown): boolean {
  if(a===b)return true;
  if(!a || !b || typeof a!=="object" || typeof b!=="object" || Array.isArray(a)!==Array.isArray(b))return false;
  const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x);
  return keys.length===Object.keys(y).length && keys.every(k=>Object.hasOwn(y,k)&&equalJson(x[k],y[k]));
}
/** Accepts a JSON string or plain parsed object. Replay is verification, never a silent repair. */
export async function importFullGeometry(input: unknown): Promise<GeometryGeneration> {
  try {
    if(typeof input==="string") {
      if(input.length>MAX_GEOMETRY_JSON_BYTES || new TextEncoder().encode(input).byteLength>MAX_GEOMETRY_JSON_BYTES)
        throw new Error("Geometry JSON exceeds 32 MiB.");
      input=JSON.parse(input);
    }
    inspectJson(input);
    const data=input as FullGeometryExport;
    if(!data || data.format!=="gof-geometry-full" || data.formatVersion!==GEOMETRY_FORMAT_VERSION)
      throw new Error("Unsupported full geometry format/version.");
    if(data.schemaVersion!==GEOMETRY_SCHEMA_VERSION || data.generatorVersion!==GEOMETRY_GENERATOR_VERSION)
      throw new Error(`Unsupported geometry version. Expected schema ${GEOMETRY_SCHEMA_VERSION}, generator ${GEOMETRY_GENERATOR_VERSION}.`);
    if(!Array.isArray(data.contours) || !data.contours.length || data.contours.length>4000)
      throw new Error("Missing or oversized layer array.");
    let segments=0;
    for(const layer of data.contours) {
      if(!layer || !Array.isArray(layer.points) || layer.points.length<4)throw new Error("Invalid contour points.");
      segments+=layer.points.length-1;
      if(segments>200000)throw new Error("Import exceeds 200000 segments.");
      for(const point of layer.points) if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite))
        throw new Error("Contour coordinates must be finite XYZ tuples.");
    }
    for(const [label,value] of Object.entries({geometry:data.geometry,sampling:data.sampling,printing:data.printing,
      descriptor:data.descriptor,validation:data.validation,machine:data.validation?.machine,buildVolume:data.validation?.buildVolume}))
      if(!value || typeof value!=="object" || Array.isArray(value))throw new Error(`Missing or invalid ${label} record.`);
    const request: GeometryRequest={geometry:{...data.geometry,modifier:data.descriptor.modifier ?? data.geometry.modifier},
      sampling:{layerHeightMm:data.sampling.layerHeightMm},
      printing:{beadWidthMm:data.printing.beadWidthMm,feedrateMmMin:data.printing.feedrateMmMin},
      machine:data.validation.machine,validation:{safetyMarginMm:data.validation.buildVolume.safetyMarginMm,
        maxLayerDisplacementMm:data.descriptor.maxLayerDisplacementMm}};
    const checked=await generateBaseGeometry(request);
    if(!checked.ok)return checked;
    // Checks every field/coordinate, not just untrusted validation flags or a recipe hash.
    if(!equalJson(data,fullExport(checked.geometry)))
      throw new Error("Geometry identity, coordinates or metadata differ from the validated recipe; import rejected without replacement.");
    return checked;
  } catch(error) {
    return Object.freeze({ok:false,errors:Object.freeze([Object.freeze({code:"invalid-geometry" as const,
      message:error instanceof Error?error.message:"Invalid full geometry JSON."})])});
  }
}

// Preserve the existing import location and v1.0.0 JSON contract.
export type { ExternalFailureSchedule } from "./failureSchedule.ts";
