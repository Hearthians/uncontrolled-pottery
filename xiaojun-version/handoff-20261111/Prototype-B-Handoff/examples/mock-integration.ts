import {generateBaseGeometry} from "../src/geometry.ts";
import {createGeometryManifest,serializeGeometryManifest,serializeFullGeometry} from "../src/serialization.ts";
import {validateFailureSchedule} from "../src/failureSchedule.ts";
import {mockMappingJson} from "./mock-emotion-mapping.ts";

export async function mockIntegration(heightMm = 20) {
  const result = await generateBaseGeometry({geometry:{baseProfile:"bulbous",modifier:"ribbed",seed:123,
    heightMm,radiusMm:8,parameters:{sculpturalIntensity:.7}},sampling:{layerHeightMm:1},
    printing:{beadWidthMm:2,feedrateMmMin:600}});
  if (!result.ok) throw new Error(result.errors[0].message);
  const geometry = result.geometry, before = serializeFullGeometry(geometry);
  const manifestJson = serializeGeometryManifest(geometry);
  const scheduleJson = mockMappingJson(manifestJson);
  // Workstream A validates against its authoritative manifest, not returned metadata.
  const checked = validateFailureSchedule(scheduleJson,createGeometryManifest(geometry));
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  if (serializeFullGeometry(geometry) !== before) throw new Error("Mock integration changed base geometry.");
  return {geometryId:geometry.geometryId,sourceStepCount:64,layerCount:geometry.contours.length,
    manifestJson,scheduleJson,assignments:checked.assignments};
}
