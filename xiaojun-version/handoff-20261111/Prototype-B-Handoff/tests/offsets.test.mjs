import test from "node:test";
import assert from "node:assert/strict";
import {generateGeometry,geometryToToolpath} from "../src/geometry.ts";
import {serializeFullGeometry} from "../src/serialization.ts";
import {simulateOffsets} from "../src/offsets.ts";
import {beadBuffers,writeBead,FLOATS_PER_MOVE,SIDES} from "../src/claySurface.ts";
import {sampleToolpath} from "../src/toolpath.ts";
import {Playback} from "../src/playback.ts";
const make=(baseProfile="cylinder",modifier="none",heightMm=35,radiusMm=15)=>generateGeometry({geometry:{baseProfile,modifier,heightMm,radiusMm,seed:123,parameters:{sculpturalIntensity:.7,foldAmplitude:.7}},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);

test("zero intensity exactly preserves the stable path and material in every mode",async()=>{
 const g=await make(),path=geometryToToolpath(g);
 for(const mode of ["sudden","local","combined"]){const r=await simulateOffsets(g,mode,0,42);
  assert.deepEqual(r.path,path);assert.deepEqual(r.material,beadBuffers(path));assert.equal(r.events.length,0);
 }
});
for(const [base,modifier] of [["cylinder","none"],["bulbous","soft-organic-fold"],["tapered","twisted"],["bulbous","ribbed"]])
for(const mode of ["sudden","local","combined"])
test(`${base}/${modifier}/${mode}: coherent paths, real translated beads, explicit travel and playback`,async()=>{
 const g=await make(base,modifier),before=serializeFullGeometry(g),original=geometryToToolpath(g),r=await simulateOffsets(g,mode,.7,42);
 assert.equal(serializeFullGeometry(g),before);assert.deepEqual(r,await simulateOffsets(g,mode,.7,42));assert.equal(r.path.contours.length,35);
 for(const c of r.path.contours){const offset=r.layers[c.layerId].displacementMm,base=original.contours[c.layerId];
  assert.deepEqual(c.points[0],c.points.at(-1));assert.equal(c.points.length,base.points.length);
  c.points.forEach((p,i)=>{close(p[0]-base.points[i][0],offset[0]);close(p[1]-base.points[i][1],offset[1]);assert.equal(p[2],base.zMm);});
 }
 let time=0;const originalDeposition=original.moves.filter(m=>m.kind==="deposition"),shifted=r.path.moves.filter(m=>m.kind==="deposition");
 assert.equal(shifted.length,originalDeposition.length);
 const p=new Float32Array(FLOATS_PER_MOVE),n=new Float32Array(FLOATS_PER_MOVE),bp=new Float32Array(FLOATS_PER_MOVE),bn=new Float32Array(FLOATS_PER_MOVE);
 shifted.forEach((m,i)=>{
  assert.equal(m.extrude,true);close(m.lengthMm,originalDeposition[i].lengthMm);assert.equal(m.beadWidthMm,2);assert.equal(m.beadHeightMm,1);
  writeBead(m,1,p,n);writeBead(originalDeposition[i],1,bp,bn);const d=r.layers[m.layerId].displacementMm;
  for(let k=0;k<p.length;k++){close(p[k]-bp[k],k%3===2?0:d[k%3],1e-5);close(n[k],bn[k],1e-5);}
 });
 for(let i=0;i<r.path.moves.length;i++){
  const m=r.path.moves[i];assert.equal(m.startTimeS,time);time=m.endTimeS;
  if(i)assert.deepEqual(m.start,r.path.moves[i-1].end,"no nozzle teleportation");
  close(m.endTimeS-m.startTimeS,m.lengthMm*60/m.feedrateMmMin);
  if(m.kind==="travel")assert.equal(m.extrude,false);
  const mid=sampleToolpath(r.path,(m.startTimeS+m.endTimeS)/2);
  mid.position.forEach((v,k)=>close(v,(m.start[k]+m.end[k])/2));
 }
 assert.equal(r.material.indices.length,r.path.moves.filter(m=>m.extrude).length*SIDES*6,"travel deposits no clay");
 assert.ok(r.path.buildVolume.valid);assert.ok(r.metrics.travelBoundaries>0);
 const playback=new Playback(r.path);playback.play();playback.advance(r.path.durationS/2);playback.pause();const paused=playback.sample();
 playback.advance(9999);assert.deepEqual(playback.sample(),paused);playback.play();playback.advance(r.path.durationS);assert.equal(playback.elapsedS,r.path.durationS);
 playback.reset();assert.equal(playback.elapsedS,0);assert.equal(serializeFullGeometry(g),before);
});
test("persistent baseline, temporary recovery, bounded groups and monotonic intensity",async()=>{
 const g=await make();
 for(const mode of ["sudden","local","combined"]){let previous;
  for(const intensity of [.15,.5,1]){
   const r=await simulateOffsets(g,mode,intensity,42);
   if(previous){assert.ok(r.events.length>=previous.events.length);assert.ok(r.metrics.affectedLayerCount>=previous.metrics.affectedLayerCount);assert.ok(r.metrics.requestedEventMagnitudeMm>previous.metrics.requestedEventMagnitudeMm);}
   for(const layer of r.layers){const expected=[0,0];for(const e of r.events)if(layer.layerId>=e.startLayerId&&layer.layerId<e.endLayerIdExclusive)for(let k=0;k<2;k++)expected[k]+=e.displacementMm[k];
    assert.deepEqual(layer.displacementMm,expected);
   }
   for(const e of r.events){if(e.type==="sudden")assert.equal(e.endLayerIdExclusive,35);
    else{const recovered=r.layers[e.endLayerIdExclusive],baseline=r.events.filter(s=>s.type==="sudden"&&s.startLayerId<=recovered.layerId).reduce((sum,s)=>sum.map((v,k)=>v+s.displacementMm[k]),[0,0]);assert.deepEqual(recovered.displacementMm,baseline);}
   }
   assert.deepEqual(r.layers[0].displacementMm,[0,0]);previous=r;
  }
 }
});
test("clearance constraints are explicit, heights stay physical, invalid requests reject",async()=>{
 const edge=await make("cylinder","none",20,93.9),r=await simulateOffsets(edge,"combined",1,42);
 assert.ok(r.metrics.clearanceScale<1);assert.ok(r.warnings.some(w=>w.includes("constrained")));assert.ok(r.path.buildVolume.valid);assert.ok(r.path.buildVolume.deposited.radiusMm<=95+1e-7);
 for(const height of [1,2,20,35]){const x=await simulateOffsets(await make("cylinder","none",height),"local",.5,42);assert.equal(x.path.contours.length,height);if(height<3)assert.equal(x.events.length,0);}
 const g=await make();for(const intensity of [-1,NaN,2])await assert.rejects(()=>simulateOffsets(g,"sudden",intensity,42),/intensity/);
 await assert.rejects(()=>simulateOffsets(g,"unknown",.5,42),/mode/);await assert.rejects(()=>simulateOffsets(g,"local",.5,-1),/seed/);
 await assert.rejects(()=>make("cylinder","none",20,93.994).then(g=>simulateOffsets(g,"sudden",1,42)),/clearance/);
 const encoded=JSON.parse(JSON.stringify(r.path));assert.deepEqual(encoded.moves,r.path.moves,"modified toolpath is JSON exportable");assert.ok(!JSON.stringify(encoded).includes("buildPlate"));
});

test("20-layer schedules separate the persistent step and the short recovery band",async()=>{
 const geometry=await make("cylinder","none",20);
 const sudden=await simulateOffsets(geometry,"sudden",.7,42);
 const local=await simulateOffsets(geometry,"local",.7,42);
 const combined=await simulateOffsets(geometry,"combined",.7,42);
 assert.deepEqual(combined.events,[...sudden.events,...local.events]);
 assert.deepEqual(combined.events.map(e=>[e.type,e.startLayerId,e.endLayerIdExclusive]),[
  ["sudden",7,20],["local",13,16],
 ]);
 for(const event of combined.events)close(Math.hypot(...event.displacementMm),1.14);
 assert.equal(local.metrics.affectedLayerCount,3);
 assert.equal(sudden.metrics.affectedLayerCount,13);
 assert.deepEqual(combined.layers[12].displacementMm,sudden.layers[12].displacementMm);
 assert.deepEqual(combined.layers[16].displacementMm,sudden.layers[16].displacementMm);
 assert.notDeepEqual(combined.layers[13].displacementMm,sudden.layers[13].displacementMm);
 for(const result of [sudden,local,combined]){
  const boundaries=[...new Set(result.events.flatMap(e=>[e.startLayerId,e.endLayerIdExclusive]))].filter(id=>id<20);
  assert.equal(result.metrics.travelBoundaries,boundaries.length);
  for(const layerId of boundaries){
   const first=result.path.moves.findIndex(m=>m.layerId===layerId&&m.kind==="deposition");
   const travel=result.path.moves.slice(first-3,first);
   assert.ok(travel.every(m=>m.layerId===layerId&&m.kind==="travel"&&!m.extrude));
  }
 }
 for(const [intensity,layers] of [[.15,1],[.5,2],[1,3]]){
  const result=await simulateOffsets(geometry,"local",intensity,42);
  assert.equal(result.events.length,1);
  assert.equal(result.metrics.affectedLayerCount,layers);
 }
 const tall=await make();
 for(const [intensity,slots] of [[.15,1],[.7,2],[1,3]]){
  const result=await simulateOffsets(tall,"combined",intensity,42);
  assert.equal(result.events.length,slots*2);
 }
});
