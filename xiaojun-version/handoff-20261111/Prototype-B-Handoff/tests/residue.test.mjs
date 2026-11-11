import test from "node:test";
import assert from "node:assert/strict";
import {generateGeometry} from "../src/geometry.ts";
import {applyGaps,gapResultToToolpath} from "../src/gaps.ts";
import {createGeometryManifest,serializeFullGeometry} from "../src/serialization.ts";
import {scheduleFromHeightIntervals} from "../src/failureSchedule.ts";
import {createResiduePlan} from "../src/clayResidue.ts";
import {beadBuffers,writeBead,FLOATS_PER_MOVE,INDICES_PER_MOVE} from "../src/claySurface.ts";
const make=(baseProfile="cylinder",modifier="none")=>generateGeometry({geometry:{baseProfile,modifier,heightMm:20,radiusMm:15,seed:123,
 parameters:{foldAmplitude:.7,sculpturalIntensity:.7}},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
const derive=(g,intensity)=>applyGaps(g,scheduleFromHeightIntervals(createGeometryManifest(g),[{start:0,end:1,failureType:"gaps",intensity}]),51);
test("residue preserves commanded metrics and zero baseline at all five intensities",async()=>{
 const g=await make(),before=serializeFullGeometry(g),rows=[];
 for(const intensity of [0,.25,.5,.75,1]){
  const r=await derive(g,intensity),snapshot=JSON.stringify(r),p=gapResultToToolpath(r),plan=createResiduePlan(p,51);
  const original=beadBuffers(p),refined=beadBuffers(p,plan);
  assert.deepEqual(plan,createResiduePlan(p,51));assert.deepEqual(refined,beadBuffers(p,plan));
  if(intensity>0)assert.notDeepEqual(plan,createResiduePlan(p,52));
  if(intensity===0)assert.deepEqual(refined,original);else assert.notDeepEqual(refined.positions,original.positions);
  assert.equal(JSON.stringify(r),snapshot);assert.equal(serializeFullGeometry(g),before);
  assert.deepEqual(refined.indices,original.indices);assert.deepEqual(refined.indexBefore,original.indexBefore);
  rows.push({intensity,...r.metrics});
 }
 console.log("Seed 51 unchanged commanded metrics:",JSON.stringify(rows));
});
for(const base of ["cylinder","tapered","bulbous"])for(const modifier of ["soft-organic-fold","twisted","ribbed"])
test(`${base}/${modifier}: localized finite residue, continuous joins and playback-safe buffers`,async()=>{
 const p=gapResultToToolpath(await derive(await make(base,modifier),.75)),plan=createResiduePlan(p,51);
 const a=beadBuffers(p),b=beadBuffers(p,plan);let slot=0;
 for(let i=0;i<p.moves.length;i++){
  const m=p.moves[i];
  if(!m.extrude){assert.equal(plan[i],undefined);if(i+1<p.moves.length)assert.equal(b.indexBefore[i],b.indexBefore[i+1]);continue;}
  if(!plan[i])assert.deepEqual(a.positions.slice(slot*FLOATS_PER_MOVE,(slot+1)*FLOATS_PER_MOVE),b.positions.slice(slot*FLOATS_PER_MOVE,(slot+1)*FLOATS_PER_MOVE));
  else {
   assert.equal(m.kind,"deposition");
   for(const f of [0,.25,.5,.75,1]){
    const pos=new Float32Array(FLOATS_PER_MOVE),norm=new Float32Array(FLOATS_PER_MOVE);
    writeBead(m,f,pos,norm,0,plan[i]);assert.ok(pos.every(Number.isFinite));assert.ok(norm.every(Number.isFinite));
    for(let k=0;k<pos.length;k+=3){assert.ok(Math.hypot(pos[k],pos[k+1])<=95+1e-5);assert.ok(pos[k+2]>=-1e-5&&pos[k+2]<=395);}
    if(f===1)assert.deepEqual(pos,b.positions.slice(slot*FLOATS_PER_MOVE,(slot+1)*FLOATS_PER_MOVE));
   }
  }
  slot++;
 }
 for(let i=1;i<p.moves.length;i++)if(p.moves[i-1].kind==="deposition"&&p.moves[i].kind==="deposition"){
  const previousSlot=b.indexBefore[i-1]/INDICES_PER_MOVE,nextSlot=b.indexBefore[i]/INDICES_PER_MOVE;
  for(let k=0;k<FLOATS_PER_MOVE/2;k++)assert.ok(Math.abs(b.positions[previousSlot*FLOATS_PER_MOVE+FLOATS_PER_MOVE/2+k]-b.positions[nextSlot*FLOATS_PER_MOVE+k])<1e-5);
 }
 assert.equal(b.indices.length,slot*INDICES_PER_MOVE);
 assert.ok(plan.some(e=>e?.end?.liftMm>0));
});
