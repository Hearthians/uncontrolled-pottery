// Independent data-workstream example: type-only imports, no generator or renderer needed.
import type { GeometryManifest, ExternalFailureSchedule } from "../src/serialization.ts";
export function exampleSchedule(manifest: GeometryManifest): ExternalFailureSchedule {
  return {schemaVersion:"1.0.0",geometryId:manifest.geometryId,
    geometrySchemaVersion:manifest.schemaVersion,generatorVersion:manifest.generatorVersion,mappingSeed:42,
    entries:manifest.layers.filter(layer=>layer.normalizedHeight>=.25&&layer.normalizedHeight<.75)
      .map(layer=>({layerId:layer.layerId,failureType:"example/unimplemented",intensity:.25}))};
}
