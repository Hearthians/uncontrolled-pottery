import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {generateGeometry} from "../src/geometry.ts";
import {createGeometryManifest,serializeFullGeometry} from "../src/serialization.ts";
import {validateFailureSchedule,scheduleFromHeightIntervals,FAILURE_TYPES} from "../src/failureSchedule.ts";
import {mock64StepIntervals,mockMappingJson} from "../examples/mock-emotion-mapping.ts";
import {mockIntegration} from "../examples/mock-integration.ts";

const generate = heightMm => generateGeometry({geometry:{baseProfile:"cylinder",modifier:"none",seed:5,heightMm,radiusMm:8},
  sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
const schedule = (m,entries=[]) => ({schemaVersion:"1.0.0",geometryId:m.geometryId,
  geometrySchemaVersion:m.schemaVersion,generatorVersion:m.generatorVersion,mappingSeed:42,entries});

for (const height of [20,35]) test(`64 source bins address ${height} physical layers without changing geometry`,async()=>{
  const g=await generate(height),m=createGeometryManifest(g),before=serializeFullGeometry(g),bins=mock64StepIntervals();
  assert.equal(bins.length,64);
  const json=mockMappingJson(JSON.stringify(m)),result=validateFailureSchedule(json,m);
  assert.ok(result.ok,result.errors?.join(" "));assert.equal(result.assignments.length,height);
  for (const layer of m.layers) {
    const bin=bins[Math.min(63,Math.floor(64*layer.normalizedHeight))],a=result.assignments[layer.layerId];
    assert.equal(a.zMm,layer.zMm);assert.equal(a.normalizedHeight,layer.zMm/height);
    assert.deepEqual(a.failures,[{failureType:bin.failureType,intensity:bin.intensity}]);
  }
  assert.deepEqual(new Set(result.assignments.flatMap(a=>a.failures.map(f=>f.failureType))),new Set(FAILURE_TYPES));
  assert.equal(mockMappingJson(JSON.stringify(m)),json);assert.equal(serializeFullGeometry(g),before);
  const demo=await mockIntegration(height);assert.equal(demo.layerCount,height);assert.equal(demo.sourceStepCount,64);
  assert.equal(validateFailureSchedule(demo.scheduleJson,JSON.parse(demo.manifestJson)).ok,true);
});

test("interval boundaries use layer centres, including fractional final layers and stable uncovered regions",async()=>{
  const m=createGeometryManifest(await generate(2.5)); // u = .2, .6, .9, not layerId/(count-1).
  const s=scheduleFromHeightIntervals(m,[{start:0,end:.2,failureType:"stable",intensity:0},
    {start:.2,end:.6,failureType:"gaps",intensity:.25},{start:.9,end:1,failureType:"sagging",intensity:1}]);
  const r=validateFailureSchedule(s,m);assert.ok(r.ok);
  assert.deepEqual(r.assignments.map(a=>a.failures[0].failureType),["gaps","stable","sagging"]);
  assert.equal(r.assignments[2].zMm,2.25);
});

test("all intervals are checked even when no layer centre samples them",async()=>{
  const m=createGeometryManifest(await generate(20));
  for (const bad of [
    [{start:0,end:0,failureType:"gaps",intensity:.1}],
    [{start:-.1,end:.2,failureType:"gaps",intensity:.1}],
    [{start:0,end:1.1,failureType:"gaps",intensity:.1}],
    [{start:NaN,end:.2,failureType:"gaps",intensity:.1}],
    [{start:0,end:Infinity,failureType:"gaps",intensity:.1}],
    [{start:0,end:1/64,failureType:"gaps",intensity:1.1}],
    [{start:0,end:1/64,failureType:"emotion/happy",intensity:.1}],
    [{start:0,end:.6,failureType:"gaps",intensity:.1},{start:.5,end:1,failureType:"sagging",intensity:.2}],
    [{start:.5,end:1,failureType:"gaps",intensity:.1},{start:0,end:.5,failureType:"sagging",intensity:.2}],
  ]) assert.throws(()=>scheduleFromHeightIntervals(m,bad));
  assert.throws(()=>scheduleFromHeightIntervals(m,[],1.5),/seed/);
});

test("schedule validation rejects incompatible identity, versions, references, types and intensity",async()=>{
  const m=createGeometryManifest(await generate(20));
  for (const edit of [
    s=>s.geometryId="other",s=>s.schemaVersion="2.0.0",s=>s.geometrySchemaVersion="1.0.0",s=>s.generatorVersion="1.1.0",
    s=>s.mappingSeed=-1,s=>s.mappingSeed=4294967296,s=>s.mappingSeed=.5,
    s=>s.entries[0].layerId=20,s=>s.entries[0].layerId=-1,s=>s.entries[0].layerId=.5,
    s=>s.entries[0].failureType="bulge",s=>s.entries[0].intensity=-.1,s=>s.entries[0].intensity=1.1,
    s=>s.entries[0].intensity=NaN,s=>s.entries[0].intensity=Infinity,s=>s.entries[0].intensity="0.5",
    s=>s.entries[0].failureType="stable",s=>delete s.entries[0].intensity,
    s=>s.entries[0].sculpturalIntensity=.5,s=>s.entries.push({...s.entries[0]}),
    s=>s.entries.push({layerId:0,failureType:"stable",intensity:0}),
  ]) {const input=schedule(m,[{layerId:0,failureType:"gaps",intensity:.5}]);edit(input);
    const r=validateFailureSchedule(input,m);assert.equal(r.ok,false);assert.equal("assignments" in r,false);}
  for (const input of [null,[],"{",{}," ".repeat(4*1024*1024+1),{...schedule(m),entries:Array(24001).fill({})},
    {...schedule(m),entries:new Array(3)}]) assert.equal(validateFailureSchedule(input,m).ok,false);
  const other=createGeometryManifest(await generate(35));
  assert.equal(validateFailureSchedule(schedule(m),other).ok,false);
});

test("stable defaults, multiple distinct types and defensive isolation preserve the original v1.0 shape",async()=>{
  const m=createGeometryManifest(await generate(3));
  const input=schedule(m,[{layerId:2,failureType:"sagging",intensity:0},
    {layerId:0,failureType:"layer-offset",intensity:1},{layerId:0,failureType:"material-accumulation",intensity:.5}]);
  const original=JSON.stringify(input),r=validateFailureSchedule(input,m);assert.ok(r.ok);
  assert.equal(JSON.stringify(input),original);assert.equal(r.schedule.schemaVersion,"1.0.0");
  assert.deepEqual(r.assignments[1].failures,[{failureType:"stable",intensity:0}]);
  assert.equal(r.assignments[0].failures.length,2);
  input.entries[1].intensity=.1;assert.equal(r.assignments[0].failures[0].intensity,1);
  assert.throws(()=>{r.schedule.entries[0].intensity=0;},TypeError);
  assert.throws(()=>{r.assignments[0].failures[0].intensity=0;},TypeError);
  assert.equal(validateFailureSchedule(JSON.stringify(r.schedule),m).ok,true);
  assert.ok(validateFailureSchedule(schedule(m),m).assignments.every(a=>a.failures[0].failureType==="stable"));
});

test("bad manifest addressing metadata cannot be used for integration",async()=>{
  const manifest=createGeometryManifest(await generate(20));
  for (const edit of [m=>m.layerCount=64,m=>m.schemaVersion="2.0.0",m=>m.generatorVersion="2.0.0",
    m=>m.geometryId="other",m=>m.coordinates.units="cm",m=>m.coordinates.upAxis="Y",
    m=>m.geometry.heightMm=0,m=>m.layers[1].layerId=0,m=>m.layers[0].normalizedHeight=0,
    m=>m.layers[1].zMm=NaN,m=>m.layers.reverse()]) {
    const m=JSON.parse(JSON.stringify(manifest));edit(m);assert.equal(validateFailureSchedule(schedule(m),m).ok,false);
  }
});

test("legacy dummy schedule and new teammate JSON reference remain consumable",async()=>{
  const read=name=>readFile(new URL(`../examples/handoff/${name}.json`,import.meta.url),"utf8");
  const m=JSON.parse(await read("manifest"));
  const old=validateFailureSchedule(await read("schedule"),m);assert.ok(old.ok);
  assert.equal(old.assignments[1].failures[0].failureType,"example/unimplemented");
  const next=validateFailureSchedule(await read("failure-schedule"),m);assert.ok(next.ok);
  assert.deepEqual(new Set(next.assignments.flatMap(a=>a.failures.map(f=>f.failureType))),new Set(FAILURE_TYPES));
  const source=await readFile(new URL("../src/failureSchedule.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source.replace(/^import type.*$/gm,""),/\bimport\s|three|generateGeometry\(/);
});
