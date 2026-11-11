import test from "node:test";
import assert from "node:assert/strict";
import {saggingFixture} from "../scripts/fixtures/sagging.mjs";
import {simulateSagging,SAGGING_CALIBRATION} from "../src/sagging.ts";
import {geometryToToolpath} from "../src/geometry.ts";
import {serializeFullGeometry} from "../src/serialization.ts";
import {beadBuffers,writeBead,FLOATS_PER_MOVE,INDICES_PER_MOVE,SIDES} from "../src/claySurface.ts";
import {Playback} from "../src/playback.ts";

test("zero intensity and fully supported cylinder preserve the complete clay surface",async()=>{
 const g=await saggingFixture("cylinder"),base=beadBuffers(geometryToToolpath(g));
 for(const intensity of [0,1]){
  const result=await simulateSagging(g,intensity,42);
  assert.deepEqual(result.material,base);
  assert.equal(result.metrics.maximumDropMm,0);
  assert.equal(result.metrics.hangingStrands,0);
 }
 await assert.rejects(()=>simulateSagging(g,-1,42),/intensity/);
 await assert.rejects(()=>simulateSagging(g,.5,-1),/seed/);
});

for(const [name,intensity] of [["twist",.4],["fold",1],["overhang",1]])
test(`${name}: actual unsupported deposition droops within machine limits`,async()=>{
 const g=await saggingFixture(name),before=serializeFullGeometry(g),base=geometryToToolpath(g);
 const r=await simulateSagging(g,intensity,42),stable=beadBuffers(base);
 assert.equal(serializeFullGeometry(g),before);
 assert.deepEqual(r.path,base);
 assert.deepEqual(r.material.indices,stable.indices,"all commanded clay stays connected as swept beads");
 assert.ok(r.metrics.maximumDropMm>0);
 assert.ok(r.metrics.hangingStrands<=SAGGING_CALIBRATION.maximumStrands);
 assert.ok(r.metrics.maximumDropMm<=SAGGING_CALIBRATION.strandHeights);
 for(const region of r.regions){
  assert.ok(region.layerId>0);
  assert.ok(r.segments.slice(region.firstMove,region.lastMove+1).some(s=>s.coverage<.8));
 }
 for(let i=0;i<r.material.positions.length;i+=3){
  const [x,y,z]=r.material.positions.subarray(i,i+3);
  assert.ok(Number.isFinite(z)&&z>=-1e-5&&z<=395&&Math.hypot(x,y)<=95+1e-5);
  assert.equal(x,stable.positions[i]);assert.equal(y,stable.positions[i+1]);
  assert.ok(z<=stable.positions[i+2]+1e-6);
 }
 for(const [i,s] of r.segments.entries()){
  if(!s||r.path.moves[i].kind!=="deposition")continue;
  const move=r.path.moves[i];
  assert.ok(Math.abs(s.endDropMm-s.startDropMm)<=SAGGING_CALIBRATION.maxSlope*move.lengthMm+1e-7);
  const next=r.path.moves[i+1];
  if(next?.kind==="deposition"&&next.layerId===move.layerId)assert.equal(s.endDropMm,r.segments[i+1].startDropMm);
 }
 if(name==="overhang"){
  const low=await simulateSagging(g,.4,42);
  assert.ok(r.metrics.maximumDropMm>low.metrics.maximumDropMm);
  assert.ok(r.metrics.hangingStrands>0&&r.metrics.slumps>0);
  assert.equal(low.metrics.hangingStrands,0);
  assert.deepEqual(r,await simulateSagging(g,1,42));
  const another=await simulateSagging(g,.4,43);
  assert.notDeepEqual(another.material.positions,low.material.positions);
 }
});

test("partial clay uses the same drop interpolation and the nozzle stays on the command",async()=>{
 const g=await saggingFixture("twist"),r=await simulateSagging(g,.4,42);
 const i=r.segments.findIndex(s=>s&&s.startDropMm+s.endDropMm>.1&&r.path.moves[s.sourceMove].kind==="deposition");
 assert.ok(i>=0);
 const move=r.path.moves[i],playback=new Playback(r.path),p=new Float32Array(FLOATS_PER_MOVE),n=new Float32Array(FLOATS_PER_MOVE);
 playback.play();const sample=playback.advance((move.startTimeS+move.endTimeS)/2);
 assert.equal(sample.moveIndex,i);
 assert.equal(sample.position[2],move.start[2]);
 writeBead(move,sample.fraction,p,n,0,undefined,r.segments[i]);
 const stable=new Float32Array(FLOATS_PER_MOVE);
 writeBead(move,sample.fraction,stable,n);
 const s=r.segments[i],drop=s.startDropMm+(s.endDropMm-s.startDropMm)*sample.fraction;
 assert.ok(Math.abs(stable[SIDES*3+2]-p[SIDES*3+2]-drop)<1e-5);
 writeBead(move,1,p,n,0,undefined,s);
 const offset=r.material.indexBefore[i]/INDICES_PER_MOVE*FLOATS_PER_MOVE;
 assert.deepEqual(p,r.material.positions.slice(offset,offset+FLOATS_PER_MOVE));
 playback.pause();assert.deepEqual(playback.advance(10),sample);
 playback.play();assert.equal(playback.advance(r.path.durationS).elapsedS,r.path.durationS);
 playback.reset();assert.equal(playback.elapsedS,0);
});

test("gentle twist activates by changing only local deposition commands after contact blocks the nominal response",async()=>{
 const g=await saggingFixture("gentle"),base=geometryToToolpath(g);
 const baseline=await simulateSagging(g,0,45),medium=await simulateSagging(g,.5,45);
 const high=await simulateSagging(g,1,45);
 assert.deepEqual(baseline.path,base);
 assert.deepEqual(baseline.material,beadBuffers(base));
 assert.equal(high.diagnostics.nominal.committed,0);
 assert.equal(high.diagnostics.nominal.selected,high.diagnostics.nominal.rejected.contact);
 assert.ok(high.diagnostics.nominal.selected>0);
 assert.ok(high.diagnostics.nominal.candidates.some(r=>r.clearance?.afterBedMm>.25));
 assert.equal(medium.instability.events.length,2);
 assert.equal(high.instability.events.length,3);
 assert.ok(medium.metrics.maximumDropMm>.25&&high.metrics.maximumDropMm>medium.metrics.maximumDropMm);
 assert.deepEqual(high,await simulateSagging(g,1,45));
 for(const result of [medium,high]){
  assert.deepEqual(result.nominalPath,base);
  assert.deepEqual(result.material.indices,baseline.material.indices);
  assert.equal(result.path.moves.length,base.moves.length);
  for(const [i,move] of result.path.moves.entries()){
   const original=base.moves[i];
   assert.equal(move.extrude,original.extrude);
   assert.equal(move.kind,original.kind);
   assert.equal(move.feedrateMmMin,original.feedrateMmMin);
   if(i)assert.deepEqual(move.start,result.path.moves[i-1].end);
   const inside=result.instability.events.some(e=>i>=e.firstMove&&i<=e.lastMove);
   if(!inside){assert.deepEqual(move.start,original.start);assert.deepEqual(move.end,original.end);}
   else assert.equal(move.kind,"deposition");
  }
  for(const event of result.instability.events){
   assert.deepEqual(result.path.moves[event.firstMove].start,base.moves[event.firstMove].start);
   assert.deepEqual(result.path.moves[event.lastMove].end,base.moves[event.lastMove].end);
   assert.ok(result.regions.some(r=>r.firstMove<=event.lastMove&&r.lastMove>=event.firstMove));
  }
  const commandBeads=beadBuffers(result.path);
  assert.notDeepEqual(result.material.positions,commandBeads.positions);
  for(let i=2;i<result.material.positions.length;i+=3){
   assert.ok(result.material.positions[i]>=-1e-5);
   assert.ok(result.material.positions[i]<=commandBeads.positions[i]+1e-6);
  }
 }
});

test("expressive mode adds connected hanging loops to a supported cylinder with controlled intensity",async()=>{
 const g=await saggingFixture("cylinder"),base=geometryToToolpath(g),stable=beadBuffers(base);
 for(const mode of ["reactive","expressive","combined"]){
  const zero=await simulateSagging(g,0,42,mode);
  assert.deepEqual(zero.path,base);
  assert.deepEqual(zero.material,stable);
  assert.equal(zero.metrics.expressiveEvents,0);
 }
 const reactive=await simulateSagging(g,1,42,"reactive");
 assert.deepEqual(reactive.material,stable);
 const medium=await simulateSagging(g,.5,42,"expressive"),high=await simulateSagging(g,1,42,"expressive");
 assert.ok(medium.metrics.hangingLoops>0);
 assert.ok(high.metrics.hangingLoops>medium.metrics.hangingLoops);
 assert.ok(high.metrics.maximumDropMm>medium.metrics.maximumDropMm);
 assert.deepEqual(high,await simulateSagging(g,1,42,"expressive"));
 assert.equal(high.metrics.reactiveRegions,0);
 assert.deepEqual(high.nominalPath,base);
 assert.deepEqual(high.material.indices,stable.indices);
 assert.ok(high.path.buildVolume.valid);
 for(const [i,move] of high.path.moves.entries()){
  assert.equal(move.extrude,base.moves[i].extrude);
  assert.equal(move.kind,base.moves[i].kind);
  if(i)assert.deepEqual(move.start,high.path.moves[i-1].end);
  if(!high.expressiveEvents.some(e=>i>=e.firstMove&&i<=e.lastMove)){
   assert.deepEqual(move.start,base.moves[i].start);
   assert.deepEqual(move.end,base.moves[i].end);
  }
 }
 for(const event of high.expressiveEvents){
  assert.ok(event.layerId>=5&&event.addedCommandLengthMm>0&&event.settledLengthMm>0);
  assert.deepEqual(high.path.moves[event.firstMove].start,base.moves[event.firstMove].start);
  assert.deepEqual(high.path.moves[event.lastMove].end,base.moves[event.lastMove].end);
  assert.equal(high.segments[event.firstMove].startDropMm,0);
  assert.equal(high.segments[event.lastMove].endDropMm,0);
  assert.ok(high.segments.slice(event.firstMove,event.lastMove+1).some(s=>s.coverage<.8));
  assert.ok(event.maximumOutwardMm<=3.1+1e-6);
  for(let i=event.firstMove;i<=event.lastMove;i++){
   const {start,end,lengthMm}=high.path.moves[i],{startDropMm,endDropMm}=high.segments[i];
   const settled=Math.hypot(end[0]-start[0],end[1]-start[1],end[2]-start[2]+startDropMm-endDropMm);
   assert.ok(settled<=lengthMm*1.15+1e-7,"the hanging bead stays within the local stretch budget");
  }
 }
});

test("combined twisted vessel settles both effects in disjoint spans on the executed path",async()=>{
 const g=await saggingFixture("mixed");
 const overhang=await saggingFixture("overhang");
 const reactive=await simulateSagging(overhang,1,42,"reactive");
 assert.deepEqual(reactive.path,geometryToToolpath(overhang));
 assert.ok(reactive.metrics.reactiveRegions>0);
 assert.equal(reactive.metrics.expressiveEvents,0);
 const combined=await simulateSagging(g,1,42,"combined");
 assert.ok(combined.metrics.reactiveRegions>0&&combined.metrics.hangingLoops>0);
 assert.ok(combined.regions.some(region=>region.effect==="expressive"));
 for(const region of combined.regions.filter(region=>region.effect!=="expressive"))
  assert.ok(combined.expressiveEvents.every(event=>region.lastMove<event.firstMove||region.firstMove>event.lastMove));
 assert.deepEqual(combined.material,beadBuffers(combined.path,undefined,combined.segments));
 assert.equal(combined.path.contours.length,20);
});
