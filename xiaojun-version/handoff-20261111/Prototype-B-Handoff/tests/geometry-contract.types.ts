import type { GeometryResult, FailureParameterSchedule } from "../src/geometry.ts";
import type { GeometryManifest, FullGeometryExport, ExternalFailureSchedule } from "../src/serialization.ts";

// Compile-only assertions; this function is never executed.
export function checkReadonly(geometry: GeometryResult, schedule: FailureParameterSchedule<{ example: number }>) {
  const x: number = geometry.contours[0].points[0][0];
  // @ts-expect-error Public contours are immutable.
  geometry.contours.push(geometry.contours[0]);
  // @ts-expect-error Nested coordinates are immutable.
  geometry.contours[0].points[0][0] = 1;
  // @ts-expect-error Resolved parameters are immutable.
  geometry.geometry.parameters.foldAmplitude = 0;
  // @ts-expect-error Command data is immutable.
  geometry.toolpath.moves[0].extrude = false;
  // @ts-expect-error A schedule is a separate readonly handoff.
  schedule.entries[0].parameters.example = 1;
  return x;
}

export function checkTransportReadonly(manifest: GeometryManifest, full: FullGeometryExport, schedule: ExternalFailureSchedule) {
  // @ts-expect-error Manifest metadata is immutable.
  manifest.layers[0].normalizedHeight = 0;
  // @ts-expect-error Full export coordinates are immutable.
  full.contours[0].points[0][0] = 0;
  // @ts-expect-error External schedule is a separate readonly contract.
  schedule.entries[0].intensity = 1;
}
