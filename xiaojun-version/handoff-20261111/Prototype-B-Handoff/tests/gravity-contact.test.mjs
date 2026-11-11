import test from "node:test";
import assert from "node:assert/strict";
import {gravityContactExample} from "../examples/gravity-contact.ts";
import {DepositedSurface} from "../src/supportContact.ts";
import {writeBead,FLOATS_PER_MOVE,beadBuffers} from "../src/claySurface.ts";
import {gapResultToToolpath} from "../src/gaps.ts";
import {analyzeSupport} from "../src/support.ts";
import {serializeFullGeometry} from "../src/serialization.ts";
test("gravity retains upper extrusion, settles onto layer two below and respects actual surface collision constraints",async()=>{
 const {geometry,simulation:r}=await gravityContactExample(),snapshot=serializeFullGeometry(geometry),commands=JSON.stringify(r.gaps);
 const p=gapResultToToolpath(r.gaps),s=r.support;
 assert.ok(s.segments.some(v=>v?.layerId===2&&v.contacts.some(c=>c.layerId===0)&&v.materialState==="contacted"));
 assert.ok(s.metrics.maximumDisplacementMm>=.99);assert.ok(s.metrics.deepContactSegments>0);
 const short=s.segments.filter(v=>v?.classification==="short");assert.ok(short.length);
 assert.ok(short.every(v=>Math.max(v.startDropMm,v.endDropMm)<=.15+1e-5));
 assert.equal(s.metrics.continuityChangedSegments,0);
 for(const row of s.layerAccounting){assert.equal(row.supportRemovedMm,0);assert.equal(row.renderOmittedMm,0);assert.equal(row.remainingCommandedExtrusionMm,row.predictedInputLengthMm);}
 assert.ok(p.moves.filter(m=>m.layerId===2&&m.kind==="deposition").every(m=>m.extrude));
 const index=new DepositedSurface(2,20000000),pos=new Float32Array(FLOATS_PER_MOVE),normal=new Float32Array(FLOATS_PER_MOVE);
 for(let layer=0;layer<20;layer++){
  const ids=p.moves.flatMap((m,i)=>m.layerId===layer&&m.kind==="deposition"?[i]:[]);
  for(const i of ids){
   writeBead(p.moves[i],1,pos,normal,0,r.residue[i]);
   for(const c of index.limits(pos,10)){
    const v=s.segments[i],drop=(1-c.t)*v.startDropMm+c.t*v.endDropMm;
    assert.ok(drop<=c.clearanceMm+1e-5,"settled surface cannot cross any earlier top surface");
   }
  }
  for(const i of ids){writeBead(p.moves[i],1,pos,normal,0,r.residue[i],s.segments[i]);
   if(layer===2)for(let j=2;j<pos.length;j+=3)assert.ok(pos[j]>=1-1e-5,"upper bead stays above intact layer-0 top at Z=1 mm");
   index.add(pos,i,layer);}
 }
 assert.equal(JSON.stringify(r.gaps),commands);assert.equal(serializeFullGeometry(geometry),snapshot);
 assert.deepEqual(s,analyzeSupport(p,r.residue,geometry.geometryId,r.gaps.derivedId));
 assert.equal(r.material.indices.length,beadBuffers(p,r.residue).indices.length);
});
test("spatial contact searches actual XY surfaces rather than layer/angular correspondence",()=>{
 const index=new DepositedSurface(2,10000),pos=new Float32Array(FLOATS_PER_MOVE),normal=new Float32Array(FLOATS_PER_MOVE);
 const move={start:[10,0,.5],end:[10,2,.5],lengthMm:2,kind:"deposition",extrude:true,beadWidthMm:2,beadHeightMm:1};
 writeBead(move,1,pos,normal);index.add(pos,3,0);
 assert.equal(index.below(10,1,3,10).move,3);
 assert.equal(index.below(20,1,3,10).move,-1);
});
