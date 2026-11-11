import test from "node:test";
import assert from "node:assert/strict";
import {generateGeometry,geometryToToolpath} from "../src/geometry.ts";
import {createGeometryManifest,serializeFullGeometry} from "../src/serialization.ts";
import {scheduleFromHeightIntervals} from "../src/failureSchedule.ts";
import {applyGaps,gapResultToToolpath,GAP_CALIBRATION} from "../src/gaps.ts";
import {sampleToolpath} from "../src/toolpath.ts";
import {Playback} from "../src/playback.ts";
import {beadBuffers,INDICES_PER_MOVE} from "../src/claySurface.ts";
const make=(baseProfile="cylinder",modifier="none",heightMm=20,radiusMm=15)=>generateGeometry({
 geometry:{baseProfile,modifier,heightMm,radiusMm,seed:123,parameters:{foldAmplitude:.7,sculpturalIntensity:.7}},
 sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
const schedule=(g,intensity,start=0,end=1)=>scheduleFromHeightIntervals(createGeometryManifest(g),[{start,end,failureType:"gaps",intensity}],42);

test("fixed candidates yield nested events and monotonic missing length at all five intensities",async()=>{
 const g=await make(),before=serializeFullGeometry(g);let previous;
 const rows=[];
 for(const intensity of [0,.25,.5,.75,1]){
  const r=await applyGaps(g,schedule(g,intensity),42);
  rows.push({intensity,...r.metrics});
  if(intensity===0)assert.deepEqual(gapResultToToolpath(r),geometryToToolpath(g));
  else assert.ok(r.metrics.eventCount>0);
  if(previous){assert.ok(r.metrics.eventCount>previous.metrics.eventCount);assert.ok(r.metrics.interruptedLengthMm>previous.metrics.interruptedLengthMm);
   for(const e of previous.events)assert.ok(r.events.some(n=>n.layerId===e.layerId&&n.candidateId===e.candidateId&&n.startMm===e.startMm&&n.endMm===e.endMm));}
  for(const c of g.contours){const ev=r.events.filter(e=>e.layerId===c.layerId);for(let i=1;i<ev.length;i++)assert.ok(ev[i].startMm>ev[i-1].endMm);}
  previous=r;
 }
 assert.equal(serializeFullGeometry(g),before);
 assert.deepEqual(await applyGaps(g,schedule(g,1),42),previous);
 assert.throws(()=>{previous.toolpath.moves[0].extrude=true;},TypeError);
 console.log("Gap calibration metrics",JSON.stringify(rows));
});
for(const base of ["cylinder","tapered","bulbous"])for(const modifier of ["soft-organic-fold","twisted","ribbed"])
test(`${base}/${modifier}: interruptions preserve motion, timing, scope and rendering semantics`,async()=>{
 const g=await make(base,modifier),original=geometryToToolpath(g),r=await applyGaps(g,schedule(g,.75,.25,.75),42),p=gapResultToToolpath(r);
 assert.ok(r.events.every(e=>{const u=g.descriptor.layers[e.layerId].normalizedHeight;return u>=.25&&u<.75;}));
 assert.equal(p.durationS,original.durationS);assert.equal(p.lengthMm,original.lengthMm);
 for(let i=0;i<=30;i++){
  const time=p.durationS*i/30,a=sampleToolpath(p,time),b=sampleToolpath(original,time);
  assert.ok(Math.hypot(...a.position.map((v,j)=>v-b.position[j]))<1e-7);
 }
 let missing=0;
 const buffers=beadBuffers(p);
 p.moves.forEach((m,i)=>{
  assert.ok(m.lengthMm>0);if(i)assert.deepEqual(m.start,p.moves[i-1].end);
  if(!m.extrude){assert.equal(m.kind,"travel");if(i+1<p.moves.length)assert.equal(buffers.indexBefore[i+1],buffers.indexBefore[i]);
   if(m.feedrateMmMin===600)missing+=m.lengthMm;}
 });
 assert.ok(Math.abs(missing-r.metrics.interruptedLengthMm)<1e-7);
 assert.equal(buffers.indices.length,p.moves.filter(m=>m.extrude).length*INDICES_PER_MOVE);
 assert.deepEqual(p.moves.filter(m=>m.kind==="transition"),original.moves.filter(m=>m.kind==="transition"));
 const playback=new Playback(p);playback.play();playback.advance(p.durationS/3);playback.pause();const s=playback.sample();
 playback.advance(100);assert.deepEqual(playback.sample(),s);playback.play();playback.advance(p.durationS);assert.equal(playback.elapsedS,p.durationS);
});
test("reject unsupported composition, invalid inputs, machine violations and derived allocations",async()=>{
 const g=await make(),s=JSON.parse(JSON.stringify(schedule(g,.5)));
 s.entries.push({layerId:0,failureType:"sagging",intensity:.5});await assert.rejects(()=>applyGaps(g,s,42),/unsupported/);
 await assert.rejects(()=>applyGaps(g,schedule(g,.5),-1),/seed/);
 await assert.rejects(()=>applyGaps(g,schedule(g,.5),42,{...GAP_CALIBRATION,maxLengthMm:7}),/calibration/);
 const fake=structuredClone(g);for(const move of fake.toolpath.moves)move.beadWidthMm=300;
 await assert.rejects(()=>applyGaps(fake,schedule(g,.5),42),/Build-volume/);
 const large=await make("cylinder","none",380,80);
 await assert.rejects(()=>applyGaps(large,schedule(large,1),42),/200000/);
});
