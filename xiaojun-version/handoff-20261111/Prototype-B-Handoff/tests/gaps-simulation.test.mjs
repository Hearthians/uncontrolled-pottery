import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {generateGeometry,geometryToToolpath} from "../src/geometry.ts";
import {createGeometryManifest,serializeFullGeometry,importFullGeometry} from "../src/serialization.ts";
import {scheduleFromHeightIntervals} from "../src/failureSchedule.ts";
import {simulateGaps} from "../src/gapsSimulation.ts";
import {gapResultToToolpath,GAP_CALIBRATION} from "../src/gaps.ts";
import {beadBuffers} from "../src/claySurface.ts";
import {Playback} from "../src/playback.ts";
import {gapsIntegration} from "../examples/gaps-integration.ts";
import {mockMappingJson} from "../examples/mock-emotion-mapping.ts";
const make=(baseProfile="cylinder",modifier="none",heightMm=20)=>generateGeometry({
 geometry:{baseProfile,modifier,heightMm,radiusMm:15,seed:123,parameters:{foldAmplitude:.7,sculpturalIntensity:.7}},
 sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
const schedule=(g,intensity,start=0,end=1)=>scheduleFromHeightIntervals(createGeometryManifest(g),[{start,end,failureType:"gaps",intensity}],42);

test("manual and external schedules share exact events, material, support and effective identity",async()=>{
 const g=await make(),before=serializeFullGeometry(g),manual=schedule(g,.75,.5);
 const external=structuredClone(manual);
 external.entries.push(...g.contours.filter(c=>c.layerId<10).map(c=>({layerId:c.layerId,failureType:"stable",intensity:0})));
 external.entries.reverse();
 const a=await simulateGaps(g,manual,42),b=await simulateGaps(g,JSON.stringify(external),42);
 assert.equal(a.simulationId,b.simulationId);assert.deepEqual(a.gaps,b.gaps);
 assert.deepEqual(a.assignments,b.assignments);assert.deepEqual(a.material,b.material);
 assert.deepEqual(a.residue,b.residue);assert.deepEqual(a.support,b.support);assert.deepEqual(a.warnings,b.warnings);
 assert.equal(a.targetedLayerCount,10);assert.equal(serializeFullGeometry(g),before);
 const p=gapResultToToolpath(a.gaps);
 assert.notDeepEqual(a.material.positions,beadBuffers(p).positions,"material residue and support reach actual vertices");
 assert.notDeepEqual(a.material.positions,beadBuffers(p,a.residue).positions,"support affects renderer buffers");
 assert.deepEqual(a.material,beadBuffers(p,a.residue,a.support.segments));
 assert.throws(()=>{a.gaps.toolpath.moves[0].extrude=true;},TypeError);
 assert.throws(()=>{a.schedule.entries[0].intensity=0;},TypeError);
 // Buffers are renderer-owned, not canonical data; repeated results do not alias them.
 a.material.positions[0]=999;assert.notEqual(b.material.positions[0],999);
 assert.equal(serializeFullGeometry(g),before);
});

for(const height of [20,35])test(`64-bin JSON mock completes ${height} physical layers with correct stable and varying regions`,async()=>{
 const r=await gapsIntegration(height),s=r.simulation;
 assert.equal(r.sourceStepCount,64);assert.equal(r.geometry.contours.length,height);assert.ok(r.completed);
 const expected=r.geometry.descriptor.layers.map(l=>[0,.25,.5,1][Math.floor(Math.min(63,Math.floor(l.normalizedHeight*64))/16)]);
 assert.deepEqual(s.gaps.appliedIntensities.map(l=>l.intensity),expected);
 assert.equal(s.targetedLayerCount,expected.filter(i=>i>0).length);
 for(const e of s.gaps.events)assert.equal(e.intensity,expected[e.layerId]);
 const stableIds=expected.flatMap((intensity,id)=>intensity===0?[id]:[]);
 assert.deepEqual(s.gaps.toolpath.moves.filter(m=>stableIds.includes(m.layerId)),r.geometry.toolpath.moves.filter(m=>stableIds.includes(m.layerId)));
 assert.ok(s.material.positions.every(Number.isFinite));
 assert.ok(s.residue.some(Boolean));assert.ok(s.support.metrics.unsupportedRegions>0);
 assert.equal(s.gaps.settings.version,"1.0.0");
 console.log("Schedule integration",JSON.stringify({layers:height,targeted:s.targetedLayerCount,events:s.gaps.metrics.eventCount,
  missingRatio:s.gaps.metrics.missingDepositionRatio,maxSupportDropMm:s.support.metrics.maximumDisplacementMm,completed:r.completed}));
});

test("upper-only leaves lower commands intact; zero intensity is unchanged; activity increases",async()=>{
 const g=await make(),original=geometryToToolpath(g);let previous=0;
 for(const intensity of [0,.25,.5,1]){
  const r=await simulateGaps(g,schedule(g,intensity,.5),42),p=gapResultToToolpath(r.gaps);
  assert.deepEqual(p.moves.filter(m=>m.layerId<10),original.moves.filter(m=>m.layerId<10));
  assert.ok(r.gaps.events.every(e=>e.layerId>=10));
  if(intensity===0){assert.equal(r.gaps.events.length,0);assert.deepEqual(p,original);assert.deepEqual(r.material,beadBuffers(original));}
  else assert.ok(r.gaps.metrics.eventCount>previous);
  previous=r.gaps.metrics.eventCount;
 }
});

for(const base of ["cylinder","tapered","bulbous"])for(const modifier of ["soft-organic-fold","twisted","ribbed"])
test(`shared pipeline ${base}/${modifier}: complete playback, no teleportation or travel deposition`,async()=>{
 const g=await make(base,modifier,8),before=serializeFullGeometry(g),r=await simulateGaps(g,JSON.stringify(schedule(g,.75)),42);
 const p=gapResultToToolpath(r.gaps),playback=new Playback(p);
 assert.equal(p.durationS,g.toolpath.durationS);assert.ok(r.gaps.events.length>0);
 for(let i=1;i<p.moves.length;i++){
  assert.deepEqual(p.moves[i].start,p.moves[i-1].end);
  if(!p.moves[i-1].extrude)assert.equal(r.material.indexBefore[i],r.material.indexBefore[i-1]);
 }
 playback.play();playback.advance(p.durationS/2);playback.pause();const paused=playback.sample();
 playback.advance(100);assert.deepEqual(playback.sample(),paused);
 playback.play();playback.advance(p.durationS);assert.equal(playback.elapsedS,p.durationS);
 assert.equal(serializeFullGeometry(g),before);assert.ok(r.material.positions.every(Number.isFinite));
});

test("invalid/unsupported schedules and inherited fabrication/performance guards reject atomically",async()=>{
 const g=await make(),s=schedule(g,.5),before=serializeFullGeometry(g);
 for(const [key,value] of [["geometryId","wrong"],["schemaVersion","2.0.0"],["geometrySchemaVersion","2.0.0"],["generatorVersion","2.0.0"]])
  await assert.rejects(()=>simulateGaps(g,{...s,[key]:value},42));
 for(const entry of [{...s.entries[0]},{layerId:0,failureType:"stable",intensity:0},{layerId:0,failureType:"sagging",intensity:.5}])
  await assert.rejects(()=>simulateGaps(g,{...s,entries:[...s.entries,entry]},42));
 await assert.rejects(()=>simulateGaps(g,"{broken",42));
 await assert.rejects(()=>simulateGaps(g,mockMappingJson(JSON.stringify(createGeometryManifest(g))),42),/unsupported/);
 await assert.rejects(()=>simulateGaps(g,s,-1),/seed/);
 await assert.rejects(()=>simulateGaps(g,s,42,{...GAP_CALIBRATION,maxLengthMm:7}),/calibration/);
 const fake=structuredClone(g);for(const m of fake.toolpath.moves)m.beadWidthMm=300;
 await assert.rejects(()=>simulateGaps(fake,s,42),/Build-volume/);
 assert.throws(()=>scheduleFromHeightIntervals(createGeometryManifest(g),[
  {start:0,end:.6,failureType:"gaps",intensity:.5},{start:.5,end:1,failureType:"gaps",intensity:1}]),/overlap|ordered|disjoint/i);
 assert.equal(serializeFullGeometry(g),before);
});

test("shipped Gaps-only JSON works with unchanged canonical full-geometry import",async()=>{
 const full=await readFile(new URL("../examples/handoff/full-geometry.json",import.meta.url),"utf8");
 const imported=await importFullGeometry(full);assert.ok(imported.ok);
 const json=await readFile(new URL("../examples/handoff/gaps-schedule.json",import.meta.url),"utf8");
 const r=await simulateGaps(imported.geometry,json,42);
 assert.equal(r.targetedLayerCount,2);assert.ok(r.gaps.events.length>0);
 assert.equal(r.sourceGeometryId,imported.geometry.geometryId);
});
