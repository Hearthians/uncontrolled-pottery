import {generateGeometry} from "../src/geometry.ts";
import {serializeGeometryManifest,serializeFullGeometry} from "../src/serialization.ts";
import {simulateGaps} from "../src/gapsSimulation.ts";
import {gapResultToToolpath} from "../src/gaps.ts";
import {Playback} from "../src/playback.ts";
import {mockMappingJson} from "./mock-emotion-mapping.ts";

/** Complete JSON handoff using the existing mock's explicit stable/Gaps-only mode. */
export async function gapsIntegration(heightMm=20){
  const geometry=await generateGeometry({geometry:{baseProfile:"bulbous",modifier:"ribbed",seed:123,
    heightMm,radiusMm:8,parameters:{sculpturalIntensity:.7}},sampling:{layerHeightMm:1},
    printing:{beadWidthMm:2,feedrateMmMin:600}});
  const before=serializeFullGeometry(geometry),manifestJson=serializeGeometryManifest(geometry);
  // Independent module sees only JSON metadata, never paths, meshes or canonical objects.
  const scheduleJson=mockMappingJson(manifestJson,true);
  const simulation=await simulateGaps(geometry,scheduleJson,42);
  const playback=new Playback(gapResultToToolpath(simulation.gaps));
  playback.play();playback.advance(playback.path.durationS);
  if(serializeFullGeometry(geometry)!==before)throw new Error("Integration changed canonical geometry.");
  return {geometry,manifestJson,scheduleJson,sourceStepCount:64,simulation,completed:playback.elapsedS===playback.path.durationS};
}
