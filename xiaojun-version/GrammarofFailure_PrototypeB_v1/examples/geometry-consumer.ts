import { generateGeometry } from "../src/geometry.ts";
import type { GeometryResult, FailureParameterSchedule } from "../src/geometry.ts";

/** A consumer reads geometry and constructs a separate layer-addressed handoff. */
export function consumeGeometry(geometry: GeometryResult) {
  const layerMetadata = geometry.contours.map(layer => ({
    layerId: layer.layerId, normalizedHeight: layer.normalizedHeight,
    zMm: layer.zMm, contourLengthMm: layer.contourLengthMm,
    firstPointMm: layer.points[0], pointCount: layer.points.length,
  }));
  // Empty payloads illustrate addressing only; no failure operators or emotion data exist here.
  const schedule: FailureParameterSchedule<Record<string, never>> = {
    schemaVersion: "1.0.0", geometryId: geometry.geometryId, parameterSchema: "example/empty-v1",
    entries: layerMetadata.filter(layer => layer.normalizedHeight >= .25 && layer.normalizedHeight < .75)
      .map(layer => ({ layerId: layer.layerId, parameters: {} })),
  };
  // Future simulation receives geometry + schedule and creates a separate output; never edits the base.
  return { geometryId: geometry.geometryId, layerCount: layerMetadata.length, layerMetadata, schedule };
}

export async function example() {
  return consumeGeometry(await generateGeometry({
    geometry: { baseProfile: "bulbous", seed: 123, heightMm: 35, radiusMm: 15,
      parameters: { foldAmplitude: .6 } },
    sampling: { layerHeightMm: 1 }, printing: { beadWidthMm: 2, feedrateMmMin: 600 },
  }));
}
