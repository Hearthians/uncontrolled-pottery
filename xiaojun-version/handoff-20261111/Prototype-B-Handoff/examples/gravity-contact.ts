import {generateGeometry} from "../src/geometry.ts";
import {createGeometryManifest} from "../src/serialization.ts";
import {scheduleFromHeightIntervals} from "../src/failureSchedule.ts";
import {simulateGaps} from "../src/gapsSimulation.ts";
/** Layer 1 has 8 mm interruptions; layer 2 still extrudes above intact layer 0. */
export async function gravityContactExample(){
 const geometry=await generateGeometry({geometry:{baseProfile:"cylinder",modifier:"none",heightMm:20,radiusMm:15,seed:123},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
 const schedule=scheduleFromHeightIntervals(createGeometryManifest(geometry),[{start:.05,end:.1,failureType:"gaps",intensity:1}],51);
 const simulation=await simulateGaps(geometry,schedule,51,{version:"1.0.0",spacingMm:24,minLengthMm:8,maxLengthMm:8});
 return {geometry,schedule,simulation};
}
