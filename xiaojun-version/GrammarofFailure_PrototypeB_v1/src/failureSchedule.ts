/** Metadata-only integration boundary. No geometry generation or failure execution. */
import type { GeometryManifest } from "./serialization.ts";
import type { DeepReadonly } from "./geometry.ts";

export const FAILURE_SCHEDULE_VERSION = "1.0.0" as const;
export const FAILURE_TYPES = ["stable", "gaps", "material-accumulation", "layer-offset", "sagging"] as const;
export type FailureType = typeof FAILURE_TYPES[number];
/** Kept for the shipped 2B.4 fixture; never an executable failure operator. */
export type RecognizedFailureType = FailureType | "example/unimplemented";
export type ExternalFailureSchedule = DeepReadonly<{
  schemaVersion: typeof FAILURE_SCHEDULE_VERSION;
  geometryId: string; geometrySchemaVersion: string; generatorVersion: string;
  mappingSeed?: number;
  // Retain the original string field for source compatibility; validate before use.
  entries: { layerId: number; failureType: string; intensity: number }[];
}>;
export type LayerFailureAssignment = DeepReadonly<{
  layerId: number; zMm: number; normalizedHeight: number;
  failures: { failureType: RecognizedFailureType; intensity: number }[];
}>;
export type FailureScheduleValidation =
  | { readonly ok: true; readonly schedule: ExternalFailureSchedule; readonly assignments: readonly LayerFailureAssignment[] }
  | { readonly ok: false; readonly errors: readonly string[] };
/** Adapter input, not a second JSON schedule format. Ordered, disjoint height bins. */
export type HeightFailureInterval = Readonly<{ start: number; end: number; failureType: FailureType; intensity: number }>;
const MAX_ENTRIES = 24000; // Up to six recognized types per supported geometry layer.
const MAX_JSON_BYTES = 4 * 1024 * 1024;

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Expected a plain JSON record.");
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new Error(`Unknown schedule field: ${key}`);
    if (!("value" in Object.getOwnPropertyDescriptor(value, key)!)) throw new Error("JSON accessors are unsupported.");
  }
  return value as Record<string, unknown>;
}
function checkFailure(type: unknown, intensity: unknown): asserts type is RecognizedFailureType {
  if (typeof type !== "string" || (type !== "example/unimplemented" && !FAILURE_TYPES.includes(type as FailureType)))
    throw new Error(`Unknown failure type: ${String(type)}`);
  if (typeof intensity !== "number" || !Number.isFinite(intensity) || intensity < 0 || intensity > 1)
    throw new Error("Failure intensity must be finite and within [0,1].");
  if (type === "stable" && intensity !== 0) throw new Error("Stable printing requires intensity 0.");
}
function checkManifest(manifest: GeometryManifest): void {
  if (manifest?.format !== "gof-geometry-manifest" || manifest.formatVersion !== "1.0.0" ||
    manifest.schemaVersion !== "1.1.0" || manifest.generatorVersion !== "1.1.1")
    throw new Error("Unsupported manifest/geometry version; expected 1.0.0 / 1.1.0 / 1.1.1.");
  if (typeof manifest.geometryId !== "string" || !/^gof-geometry-1\.1\.1-[a-f0-9]{64}$/.test(manifest.geometryId))
    throw new Error("Invalid geometry ID.");
  if (manifest.coordinates?.units !== "mm" || manifest.coordinates.upAxis !== "Z" ||
    manifest.coordinates.normalizedHeight !== "zMm/heightMm") throw new Error("Unsupported coordinate conventions.");
  const height = manifest.geometry?.heightMm;
  if (!Number.isFinite(height) || height <= 0 || !Array.isArray(manifest.layers) ||
    !manifest.layers.length || manifest.layers.length > 4000 || manifest.layerCount !== manifest.layers.length)
    throw new Error("Invalid manifest dimensions or layer count.");
  let previousZ = 0;
  for (let i = 0; i < manifest.layers.length; i++) {
    const layer = manifest.layers[i];
    if (!layer || layer.layerId !== i || !Number.isFinite(layer.zMm) || layer.zMm <= previousZ || layer.zMm >= height ||
      !Number.isFinite(layer.normalizedHeight) || layer.normalizedHeight !== layer.zMm / height)
      throw new Error("Invalid layer IDs, order or normalized heights.");
    previousZ = layer.zMm;
  }
}

/** Checks JSON compatibility and returns immutable assignments, including implicit stable layers. */
export function validateFailureSchedule(input: unknown, manifest: GeometryManifest): FailureScheduleValidation {
  try {
    checkManifest(manifest);
    if (typeof input === "string") {
      if (input.length > MAX_JSON_BYTES || new TextEncoder().encode(input).byteLength > MAX_JSON_BYTES)
        throw new Error("Schedule JSON exceeds 4 MiB.");
      input = JSON.parse(input);
    }
    const data = record(input, ["schemaVersion", "geometryId", "geometrySchemaVersion", "generatorVersion", "mappingSeed", "entries"]);
    if (data.schemaVersion !== FAILURE_SCHEDULE_VERSION) throw new Error("Unsupported failure schedule version; expected 1.0.0.");
    if (data.geometryId !== manifest.geometryId) throw new Error("Schedule geometry ID does not match the manifest.");
    if (data.geometrySchemaVersion !== manifest.schemaVersion || data.generatorVersion !== manifest.generatorVersion)
      throw new Error("Schedule geometry versions do not match the manifest.");
    if (data.mappingSeed !== undefined && (typeof data.mappingSeed !== "number" || !Number.isInteger(data.mappingSeed) ||
      data.mappingSeed < 0 || data.mappingSeed > 4294967295)) throw new Error("Mapping seed must be an unsigned 32-bit integer.");
    if (!Array.isArray(data.entries) || data.entries.length > MAX_ENTRIES || Object.keys(data.entries).length !== data.entries.length)
      throw new Error("Invalid or oversized schedule entries.");
    const groups: { failureType: RecognizedFailureType; intensity: number }[][] = manifest.layers.map(() => []);
    const entries = data.entries.map(value => {
      const entry = record(value, ["layerId", "failureType", "intensity"]);
      if (typeof entry.layerId !== "number" || !Number.isInteger(entry.layerId) || entry.layerId < 0 || entry.layerId >= groups.length)
        throw new Error("Schedule references an unknown layer ID.");
      checkFailure(entry.failureType, entry.intensity);
      const group = groups[entry.layerId], type = entry.failureType;
      if (group.some(item => item.failureType === type)) throw new Error("Duplicate layer/failure type entry.");
      if (group.length && (type === "stable" || group.some(item => item.failureType === "stable")))
        throw new Error("Stable printing cannot share a layer with another schedule entry.");
      group.push(Object.freeze({ failureType: type, intensity: entry.intensity as number }));
      return Object.freeze({ layerId: entry.layerId, failureType: type, intensity: entry.intensity as number });
    });
    entries.sort((a,b) => a.layerId-b.layerId || (a.failureType < b.failureType ? -1 : a.failureType > b.failureType ? 1 : 0));
    const schedule = Object.freeze({ schemaVersion: FAILURE_SCHEDULE_VERSION, geometryId: manifest.geometryId,
      geometrySchemaVersion: manifest.schemaVersion, generatorVersion: manifest.generatorVersion,
      ...(data.mappingSeed === undefined ? {} : {mappingSeed: data.mappingSeed as number}), entries: Object.freeze(entries) });
    const assignments = Object.freeze(manifest.layers.map((layer, i) => Object.freeze({
      layerId: layer.layerId, zMm: layer.zMm, normalizedHeight: layer.normalizedHeight,
      failures: Object.freeze(groups[i].length ? groups[i].sort((a,b) => a.failureType < b.failureType ? -1 : 1)
        : [Object.freeze({failureType:"stable" as const,intensity:0})]),
    })));
    return Object.freeze({ok:true, schedule, assignments});
  } catch (error) {
    return Object.freeze({ok:false, errors:Object.freeze([error instanceof Error ? error.message : "Invalid failure schedule."])});
  }
}

/** Uses bead-centre normalized heights; throws on invalid bins, including unsampled bins. */
export function scheduleFromHeightIntervals(manifest: GeometryManifest, intervals: readonly HeightFailureInterval[], mappingSeed?: number): ExternalFailureSchedule {
  checkManifest(manifest);
  if (!Array.isArray(intervals) || intervals.length > MAX_ENTRIES) throw new Error("Invalid or oversized height intervals.");
  let previousEnd = 0;
  for (const interval of intervals) {
    const item = record(interval, ["start", "end", "failureType", "intensity"]);
    if (typeof item.start !== "number" || typeof item.end !== "number" || !Number.isFinite(item.start) || !Number.isFinite(item.end) ||
      item.start < 0 || item.start >= item.end || item.end > 1 || item.start < previousEnd)
      throw new Error("Height intervals must be ordered, non-overlapping and within [0,1].");
    checkFailure(item.failureType, item.intensity);
    if (item.failureType === "example/unimplemented") throw new Error("Use a supported failure type for new height intervals.");
    previousEnd = item.end;
  }
  let index = 0;
  const entries: {layerId:number;failureType:string;intensity:number}[] = [];
  for (const layer of manifest.layers) {
    const u = layer.normalizedHeight;
    while (index < intervals.length && u >= intervals[index].end && intervals[index].end < 1) index++;
    const bin = intervals[index];
    if (bin && u >= bin.start && (u < bin.end || bin.end === 1 && u === 1))
      entries.push({layerId:layer.layerId, failureType:bin.failureType, intensity:bin.intensity});
  }
  const checked = validateFailureSchedule({schemaVersion:FAILURE_SCHEDULE_VERSION,geometryId:manifest.geometryId,
    geometrySchemaVersion:manifest.schemaVersion,generatorVersion:manifest.generatorVersion,
    ...(mappingSeed === undefined ? {} : {mappingSeed}),entries},manifest);
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return checked.schedule;
}
