import test from "node:test";
import assert from "node:assert/strict";
import {generateGeometry,geometryToToolpath} from "../src/geometry.ts";
import {serializeFullGeometry} from "../src/serialization.ts";
import {simulateBulges,bulgeProgress,bulgeTiming,BULGE_CALIBRATION} from "../src/bulges.ts";
import {beadBuffers,FLOATS_PER_MOVE,SIDES} from "../src/claySurface.ts";
import {beadSegmentVolume,writeSwelling} from "../src/beadSwelling.ts";
import {createHash} from "node:crypto";
import {Playback} from "../src/playback.ts";
const make=(baseProfile="cylinder",modifier="none",radiusMm=15)=>generateGeometry({geometry:{baseProfile,modifier,heightMm:20,radiusMm,seed:123,parameters:{sculpturalIntensity:.7,foldAmplitude:.7}},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
test("fixed candidates, monotonic measured volume, immutable source and deterministic material",async()=>{
 const g=await make(),original=serializeFullGeometry(g),metrics=[];let prior;
 for(const intensity of [0,.25,.5,.75,1]){
  const r=await simulateBulges(g,intensity,51);metrics.push({intensity,...r.metrics});
  assert.equal(serializeFullGeometry(g),original);assert.deepEqual(r,await simulateBulges(g,intensity,51));
  assert.ok(Math.abs(r.metrics.predictedExtraVolumeMm3-r.metrics.totalExtraVolumeMm3)<1e-4);
  if(!intensity){assert.equal(r.events.length,0);assert.equal(r.patches.length,0);assert.equal(r.durationS,g.toolpath.durationS);}
  else {assert.ok(r.events.length>0);assert.ok(r.metrics.totalExtraVolumeMm3>prior.metrics.totalExtraVolumeMm3);
   if(prior.events.length)assert.deepEqual(r.events.map(e=>[e.id,e.position,e.pathTimeS]),prior.events.map(e=>[e.id,e.position,e.pathTimeS]));
   for(const e of r.events){assert.equal(g.toolpath.moves[e.moveIndex].kind,"deposition");assert.ok(e.dwellS>0);assert.ok(Math.abs(e.dwellS*e.flowMm3S*e.flowMultiplier-e.extraVolumeMm3)<1e-8);}
  }prior=r;
 }
 console.log("BULGES METRICS",JSON.stringify(metrics));
});
for(const base of ["cylinder","tapered","bulbous"])for(const modifier of ["soft-organic-fold","twisted","ribbed"])for(const intensity of [.5,1])
test(`${base}/${modifier}/${intensity}: event-only geometry, explicit stationary dwell, safe pause/reset and completion`,async()=>{
 const g=await make(base,modifier),r=await simulateBulges(g,intensity,51),path=geometryToToolpath(g),timing=bulgeTiming(path,r),playback=new Playback(path,timing);
 for(const e of r.events){
  assert.equal(bulgeProgress(e,e.startTimeS),0);assert.equal(bulgeProgress(e,e.endTimeS),1);
  const a=timing.sample(e.startTimeS+e.dwellS*.1),b=timing.sample(e.startTimeS+e.dwellS*.9);
  assert.deepEqual(a.position,b.position);assert.ok(Math.hypot(...a.position.map((v,k)=>v-e.position[k]))<1e-8);
  assert.ok(Math.abs(bulgeProgress(e,e.startTimeS+e.dwellS*.5)-.5)<1e-10);
 }
 const mesh=r.material;assert.ok(mesh.positions.every(Number.isFinite));assert.ok(mesh.normals.every(Number.isFinite));
 for(let j=0;j<mesh.positions.length;j+=3){const x=mesh.positions[j],y=mesh.positions[j+1],z=mesh.positions[j+2];assert.ok(Math.hypot(x,y)<=95+1e-5&&z>=0&&z<=395);}
 const baseline=beadBuffers(path),neutral=beadBuffers(path);
 assert.deepEqual(mesh.indices,baseline.indices,"unchanged topology; no overlay meshes or extra openings");
 for(let i=0;i<r.patches.length;i++){
  const patch=r.patches[i],event=r.events[i];
  assert.ok(patch.inwardShare>=.35&&patch.inwardShare<=.5);
  let inward=0,outward=0;
  for(const m of patch.moves)for(const ring of [0,1]){
   const n=ring?m.endNormal:m.startNormal;
   assert.ok(Math.abs(Math.hypot(...n)-1)<1e-8);
   for(let j=0;j<SIDES;j++){
    const o=m.offset+(ring*SIDES+j)*3,shift=(mesh.positions[o]-neutral.positions[o])*n[0]+(mesh.positions[o+1]-neutral.positions[o+1])*n[1];
    if(j===0)inward=Math.max(inward,-shift);if(j===SIDES/2)outward=Math.max(outward,shift);
   }
  }
  assert.ok(inward>.01&&outward>.01,"both physical surfaces genuinely expand");
  for(const progress of [0,.25,.5,.75,1]){
   writeSwelling(path,patch,progress,baseline.positions,baseline.normals);
   const volume=patch.moves.reduce((v,m)=>v+beadSegmentVolume(baseline.positions,m.offset),0)-patch.baselineVolumeMm3;
   assert.ok(Math.abs(volume-event.extraVolumeMm3*progress)<1e-4,"incremental volume tracks dwell progress");
  }
  for(const m of patch.moves)assert.ok(m.moveIndex<event.moveIndex,"never changes an unprinted segment");
  for(let k=1;k<patch.moves.length;k++){
   const a=patch.moves[k-1].offset+SIDES*3,b=patch.moves[k].offset;
   assert.ok(mesh.positions.slice(a,a+SIDES*3).every((v,j)=>Math.abs(v-mesh.positions[b+j])<1e-5),"shared rings stay joined");
   assert.ok(mesh.normals.slice(a,a+SIDES*3).every((v,j)=>Math.abs(v-mesh.normals[b+j])<1e-6),"smooth shading across joins");
  }
 }
 // Face winding and supplied shading normals agree, including steep swelling shoulders.
 for(let i=0;i<mesh.indices.length;i+=3){
  const [a,b,c]=Array.from(mesh.indices.slice(i,i+3),x=>x*3),p=mesh.positions,n=mesh.normals;
  const u=[0,1,2].map(k=>p[b+k]-p[a+k]),v=[0,1,2].map(k=>p[c+k]-p[a+k]);
  const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  assert.ok(cross.reduce((sum,x,k)=>sum+x*(n[a+k]+n[b+k]+n[c+k]),0)>-1e-7,"no inverted surface");
 }

 playback.play();playback.advance(r.events[0].startTimeS+r.events[0].dwellS/2);playback.pause();const paused=playback.sample();playback.advance(999);assert.deepEqual(playback.sample(),paused);
 playback.play();playback.advance(r.durationS);assert.equal(playback.elapsedS,r.durationS);playback.reset();assert.equal(playback.elapsedS,0);
 assert.deepEqual(path.moves,geometryToToolpath(g).moves);assert.ok(path.moves.filter(m=>m.kind==="deposition").every(m=>m.extrude));
});
test("invalid input and additional material beyond the cylindrical envelope reject without rescaling",async()=>{
 const g=await make();for(const value of [-1,NaN,2])await assert.rejects(()=>simulateBulges(g,value,51),/intensity/);
 await assert.rejects(()=>simulateBulges(g,.5,-1),/seed/);await assert.rejects(()=>simulateBulges(g,.5,51,{...BULGE_CALIBRATION,version:"2.0.0"}),/calibration/);
 const edge=await make("cylinder","none",93.9);await assert.rejects(()=>simulateBulges(edge,1,51),/envelope/);
});

test("3B.1 event locations, budgets and complete timing remain byte-identical at all intensities",async()=>{
 const g=await generateGeometry({geometry:{baseProfile:"cylinder",modifier:"none",heightMm:35,radiusMm:15,seed:123},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
 const hashes=["80979c979111af7d79fafff8778cbf79f8638e7a906cbd9f402acd59f5343ac5","58db9bd0d2b56a0a8e538ed228eceb51afbea180fbbae2dff4983d4bc51779ca","693d9fb15f0cbd55a32b00b2d77e4b8996268e4a1a6429faeaa39901797c998d","6b4af2e6daa7e0115dac60ec858d2c714b25d022677fb1706c7b3ffefcdb9125","c553c980ca031ca7411c411d6ebf21b697a494892f9659b973e892b9e29b9d23"];
 const path=geometryToToolpath(g),base=beadBuffers(path);
 for(const [i,intensity] of [0,.25,.5,.75,1].entries()){
  const r=await simulateBulges(g,intensity,42);
  assert.equal(createHash("sha256").update(JSON.stringify([r.events,r.instructions,r.durationS])).digest("hex"),hashes[i]);
  if(!intensity)assert.deepEqual(r.material,base);
  for(let k=0;k<base.positions.length;k+=3){
   assert.equal(r.material.positions[k+2],base.positions[k+2],"no vertical/interlayer deformation");

  }
  for(const patch of r.patches){
   writeSwelling(path,patch,0,r.material.positions,r.material.normals);
   for(const m of patch.moves)assert.deepEqual(r.material.positions.slice(m.offset,m.offset+FLOATS_PER_MOVE),base.positions.slice(m.offset,m.offset+FLOATS_PER_MOVE),"reset restores baseline");
  }
 }
});

test("bounded seeded distribution, local contour normals and conservative interior rejection",async()=>{
 const g=await make("bulbous","ribbed"),a=await simulateBulges(g,.5,42),b=await simulateBulges(g,.5,43),path=geometryToToolpath(g);
 assert.notDeepEqual(a.patches.map(p=>p.inwardShare),b.patches.map(p=>p.inwardShare));
 assert.ok(a.warnings.some(w=>w.includes("neighboring beads or future nozzle paths")));
 for(const patch of a.patches)for(const m of patch.moves){
  const move=path.moves[m.moveIndex],prev=path.moves[m.moveIndex-1];
  const t=[0,1].map(k=>(move.end[k]-move.start[k])/move.lengthMm+(prev?.kind==="deposition"&&prev.layerId===move.layerId?(prev.end[k]-prev.start[k])/prev.lengthMm:0));
  assert.ok(Math.abs(t[0]*m.startNormal[0]+t[1]*m.startNormal[1])<1e-7,"normal follows local contour tangent");
 }
 await assert.rejects(()=>make("cylinder","none",1.5).then(g=>simulateBulges(g,1,51)),/fold or self-intersect|interior axis/);
});
