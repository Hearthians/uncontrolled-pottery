import {generateBaseGeometry,geometryToToolpath} from "../src/geometry.ts";
import {serializeGeometryManifest,serializeFullGeometry,importFullGeometry} from "../src/serialization.ts";
import type {GeometryManifest} from "../src/serialization.ts";
import {exampleSchedule} from "./manifest-consumer.ts";

export async function handoffExample() {
  const generated=await generateBaseGeometry({geometry:{baseProfile:"bulbous",modifier:"ribbed",seed:123,
    heightMm:3,radiusMm:8,parameters:{sculpturalIntensity:.7}},sampling:{layerHeightMm:1},
    printing:{beadWidthMm:2,feedrateMmMin:600}});
  if(!generated.ok)throw new Error(generated.errors[0].message);
  const manifestJson=serializeGeometryManifest(generated.geometry);
  // This example reads its own trusted export; transport authentication remains external.
  const manifest=JSON.parse(manifestJson) as GeometryManifest;
  const schedule=exampleSchedule(manifest);
  const fullJson=serializeFullGeometry(generated.geometry);
  const imported=await importFullGeometry(fullJson);
  if(!imported.ok)throw new Error(imported.errors[0].message);
  if(JSON.stringify(imported.geometry.contours)!==JSON.stringify(generated.geometry.contours))
    throw new Error("Round-trip coordinates changed.");
  const path=geometryToToolpath(imported.geometry);
  return {manifestJson,fullJson,schedule,geometryId:imported.geometry.geometryId,
    layerCount:imported.geometry.contours.length,moveCount:path.moves.length};
}
