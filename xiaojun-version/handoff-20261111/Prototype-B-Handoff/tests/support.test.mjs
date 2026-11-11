import test from "node:test";
import assert from "node:assert/strict";
import {generateGeometry} from "../src/geometry.ts";
import {createGeometryManifest,serializeFullGeometry} from "../src/serialization.ts";
import {applyGaps,gapResultToToolpath} from "../src/gaps.ts";
import {scheduleFromHeightIntervals} from "../src/failureSchedule.ts";
import {createResiduePlan} from "../src/clayResidue.ts";
import {analyzeSupport,SUPPORT_CALIBRATION} from "../src/support.ts";
import {beadBuffers,writeBead,hasDepositedMaterial,FLOATS_PER_MOVE,INDICES_PER_MOVE} from "../src/claySurface.ts";
const make=(baseProfile="cylinder",modifier="none",heightMm=20)=>generateGeometry({geometry:{baseProfile,modifier,heightMm,radiusMm:15,seed:123,
 parameters:{foldAmplitude:.7,sculpturalIntensity:.7}},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
const derive=(g,intensity)=>applyGaps(g,scheduleFromHeightIntervals(createGeometryManifest(g),[{start:0,end:1,failureType:"gaps",intensity}]),51);
test("continuous cylinder stays identical; gaps propagate spatial support loss through predicted layers",async()=>{
 const g=await make(),snapshot=serializeFullGeometry(g);
 for(const intensity of [0,.5,1]){
  const r=await derive(g,intensity),p=gapResultToToolpath(r),residue=createResiduePlan(p,51),before=JSON.stringify(p);
  const off=analyzeSupport(p,residue,g.geometryId,r.derivedId,false),on=analyzeSupport(p,residue,g.geometryId,r.derivedId);
  assert.equal(JSON.stringify(p),before);assert.equal(serializeFullGeometry(g),snapshot);
  assert.deepEqual(on,analyzeSupport(p,residue,g.geometryId,r.derivedId));
  const a=beadBuffers(p,residue),b=beadBuffers(p,residue,on.segments);
  if(!intensity){assert.equal(on.metrics.unsupportedRegions,0);assert.deepEqual(a,b);}
  else{
   assert.ok(on.metrics.unsupportedRegions>0);assert.ok(on.metrics.maximumDisplacementMm>0);
   assert.notDeepEqual(on.segments.map(s=>s?.coverage),off.segments.map(s=>s?.coverage),"lower predicted deformation changes subsequent contact");
   assert.notDeepEqual(a.positions,b.positions);
  }
  assert.equal(off.metrics.maximumDisplacementMm,0);assert.equal(off.metrics.continuityChangedSegments,0);
  assert.equal(a.indices.length-b.indices.length,on.metrics.continuityChangedSegments*INDICES_PER_MOVE);
  assert.ok(on.metrics.maximumDisplacementMm<=SUPPORT_CALIBRATION.maxReachHeights+2*SUPPORT_CALIBRATION.maxReachWidths+1e-9);
  for(const s of on.segments.filter(Boolean))for(const lower of s.supportMoves){
   assert.ok(lower<s.sourceMove);assert.ok(p.moves[lower].extrude);assert.ok(p.moves[lower].layerId<s.layerId);
   assert.ok(!on.segments[lower].omitted,"absent predicted material never supports later clay");
  }
  if(intensity===.5)assert.ok(on.metrics.short&&on.metrics.medium&&on.metrics.long&&on.warnings.length>1);
 }
});
for(const base of ["cylinder","tapered","bulbous"])for(const modifier of ["soft-organic-fold","twisted","ribbed"])
test(`${base}/${modifier}: valid material, immutable commands, safe partial playback`,async()=>{
 const g=await make(base,modifier,8),r=await derive(g,.5),p=gapResultToToolpath(r),residue=createResiduePlan(p,51);
 const original=JSON.stringify(r),s=analyzeSupport(p,residue,g.geometryId,r.derivedId),b=beadBuffers(p,residue,s.segments);
 assert.equal(JSON.stringify(r),original);assert.ok(b.positions.every(Number.isFinite));
 let slot=0;
 for(let i=0;i<p.moves.length;i++){
  const m=p.moves[i];if(!m.extrude){assert.equal(s.segments[i],undefined);if(i+1<p.moves.length)assert.equal(b.indexBefore[i],b.indexBefore[i+1]);continue;}
  if(!hasDepositedMaterial(m,s.segments[i])){assert.ok(s.segments[i].omitted);assert.equal(b.indexBefore[i],b.indexBefore[i+1]);continue;}
  const pos=new Float32Array(FLOATS_PER_MOVE),normal=new Float32Array(FLOATS_PER_MOVE);
  for(const f of [.3,1]){writeBead(m,f,pos,normal,0,residue[i],s.segments[i]);assert.ok(pos.every(Number.isFinite));
   for(let k=0;k<pos.length;k+=3){assert.ok(pos[k+2]>=-1e-5&&pos[k+2]<=8+1e-5);assert.ok(Math.hypot(pos[k],pos[k+1])<=95+1e-5);}
  }
  assert.deepEqual(pos,b.positions.slice(slot*FLOATS_PER_MOVE,(slot+1)*FLOATS_PER_MOVE));slot++;
 }
 assert.equal(b.indices.length,slot*INDICES_PER_MOVE);
 assert.throws(()=>{s.segments.find(Boolean).coverage=0;},TypeError);
});

test("broken end taper stays continuous with retained neighbours and partial playback matches full buffers",async()=>{
 const g=await make(),r=await derive(g,1),p=gapResultToToolpath(r),residue=createResiduePlan(p,51);
 const s=analyzeSupport(p,residue,g.geometryId,r.derivedId),b=beadBuffers(p,residue,s.segments);
 const positions=new Float32Array(FLOATS_PER_MOVE),normal=new Float32Array(FLOATS_PER_MOVE),previous=new Float32Array(FLOATS_PER_MOVE);
 for(let i=0;i<p.moves.length;i++){
  const m=p.moves[i];if(!hasDepositedMaterial(m,s.segments[i]))continue;
  writeBead(m,1,positions,normal,0,residue[i],s.segments[i]);
  const slot=b.indexBefore[i]/INDICES_PER_MOVE;
  assert.deepEqual(positions,b.positions.slice(slot*FLOATS_PER_MOVE,(slot+1)*FLOATS_PER_MOVE));
  if(m.kind==="deposition"&&p.moves[i-1]?.kind==="deposition"&&hasDepositedMaterial(p.moves[i-1],s.segments[i-1])){
   writeBead(p.moves[i-1],1,previous,normal,0,residue[i-1],s.segments[i-1]);
   for(let k=0;k<FLOATS_PER_MOVE/2;k++)assert.ok(Math.abs(positions[k]-previous[k+FLOATS_PER_MOVE/2])<1e-5);
  }
 }
});
test("spatial misalignment affects contact even with no gap mask, and limits are enforced",async()=>{
 const g=await make("bulbous","twisted",8),r=await derive(g,0),p=gapResultToToolpath(r),residue=createResiduePlan(p,51);
 assert.equal(r.events.length,0);
 assert.ok(analyzeSupport(p,residue,g.geometryId,r.derivedId).metrics.unsupportedRegions>0);
 const large={...p,moves:Array(200001).fill(p.moves[0])};assert.throws(()=>analyzeSupport(large,[],"g","d"),/200000/);
 const bad=structuredClone(p);for(const m of bad.moves)m.beadWidthMm=300;
 assert.throws(()=>analyzeSupport(bad,residue,"g","d"),/Build-volume/);
});

