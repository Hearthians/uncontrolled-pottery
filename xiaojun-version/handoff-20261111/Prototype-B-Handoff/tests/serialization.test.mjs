import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {generateGeometry,geometryToToolpath} from "../src/geometry.ts";
import {createGeometryManifest,serializeGeometryManifest,serializeFullGeometry,importFullGeometry,MAX_GEOMETRY_JSON_BYTES} from "../src/serialization.ts";
import {SHAPE_FAMILIES,SCULPTURAL_MODIFIERS} from "../src/shapes.ts";
import {handoffExample} from "../examples/serialization-handoff.ts";
import {exampleSchedule} from "../examples/manifest-consumer.ts";
const make=(baseProfile="bulbous",modifier="ribbed",parameters={},heightMm=3)=>generateGeometry({
 geometry:{baseProfile,modifier,seed:123,heightMm,radiusMm:8,parameters:{foldAmplitude:.7,sculpturalIntensity:.7,...parameters}},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
for(const family of SHAPE_FAMILIES)for(const modifier of SCULPTURAL_MODIFIERS)
 test(`${family}/${modifier}: manifest and full round trip preserve geometry and toolpath`,async()=>{
  const original=await make(family,modifier),manifest=createGeometryManifest(original),text=serializeFullGeometry(original);
  assert.equal(manifest.layerCount,3);assert.equal(manifest.geometryId,original.geometryId);
  assert.doesNotMatch(serializeGeometryManifest(original),/"points"|"moves"|"contours"|"toolpath"/);
  assert.doesNotMatch(text,/"moves"|"toolpath"/);
  assert.deepEqual(manifest.layers,original.descriptor.layers);
  const input=JSON.parse(text),result=await importFullGeometry(input);
  assert.ok(result.ok,result.errors?.[0]?.message);
  assert.deepEqual(result.geometry,original);assert.equal(serializeFullGeometry(result.geometry),text);
  assert.deepEqual(geometryToToolpath(result.geometry),geometryToToolpath(original));
  input.contours[0].points[0][0]=999;
  assert.notEqual(result.geometry.contours[0].points[0][0],999);
  assert.throws(()=>{result.geometry.contours[0].points[0][0]=999;},TypeError);
  assert.ok(Object.isFrozen(manifest.layers));
 });
test("zero-intensity selected modifier survives identity/descriptor round trip",async()=>{
 for(const modifier of SCULPTURAL_MODIFIERS){const g=await make("cylinder",modifier,{foldAmplitude:0,sculpturalIntensity:0});
  const r=await importFullGeometry(serializeFullGeometry(g));assert.ok(r.ok);assert.deepEqual(r.geometry,g);}
});
test("untrusted coordinates, identity, metadata and flags reject rather than silently repair",async()=>{
 const g=await make(),text=serializeFullGeometry(g);
 for(const edit of [
  d=>d.contours[0].points[0][0]+=1,
  d=>d.contours[0].points[0][0]=NaN,
  d=>d.contours[0].points.reverse(),
  d=>d.contours[0].points.pop(),
  d=>d.contours[1].layerId=0,
  d=>d.contours[1].normalizedHeight=.99,
  d=>d.geometryId="forged",
  d=>d.validation.status=d.validation.status==="valid"?"valid-with-warnings":"valid",
  d=>d.validation.buildVolume.valid=false,
  d=>d.geometry.radiusMm=99,
  d=>d.geometry.heightMm=401,
  d=>d.validation.machine.diameterMm=2000,
  d=>d.sampling.segmentsPerContour=3,
  d=>delete d.geometry,
  d=>delete d.geometry.parameters.ribDepth,
  d=>d.toolpath={moves:[]},
 ]) {const data=JSON.parse(text);edit(data);const r=await importFullGeometry(data);assert.equal(r.ok,false);assert.equal("geometry" in r,false);}
});
test("malformed, unsupported, excessively nested and oversized imports reject safely",async()=>{
 const text=serializeFullGeometry(await make());
 for(const input of ["{",null,[],"1e999",{"__proto__":null}," ".repeat(MAX_GEOMETRY_JSON_BYTES+1)])
  assert.equal((await importFullGeometry(input)).ok,false);
 for(const key of ["schemaVersion","generatorVersion","formatVersion"]){const d=JSON.parse(text);d[key]="99.0.0";
  const r=await importFullGeometry(d);assert.equal(r.ok,false);assert.match(r.errors[0].message,/version/i);}
 const over=JSON.parse(text);over.contours=[{points:Array(200002).fill([1,2,3])}];
 assert.equal((await importFullGeometry(over)).ok,false);
 const many=JSON.parse(text);many.contours=Array(4001).fill(many.contours[0]);
 assert.equal((await importFullGeometry(many)).ok,false);
 const cycle={};cycle.self=cycle;assert.equal((await importFullGeometry(cycle)).ok,false);
 const accessor={};Object.defineProperty(accessor,"x",{enumerable:true,get(){throw Error("must not execute");}});
 assert.match((await importFullGeometry(accessor)).errors[0].message,/accessors/);
});
test("handoff fixture and independent schedule consumer never mutate base data",async()=>{
 const g=await make(),m=createGeometryManifest(g),before=serializeFullGeometry(g),schedule=exampleSchedule(m);
 assert.equal(schedule.geometryId,g.geometryId);assert.equal(schedule.geometrySchemaVersion,g.schemaVersion);
 assert.equal(schedule.entries[0].layerId,1);assert.equal(schedule.entries[0].failureType,"example/unimplemented");
 assert.equal(before,serializeFullGeometry(g));
 const example=await handoffExample();assert.equal(example.layerCount,3);assert.ok(example.moveCount>0);
});

test("checked-in handoff files match the runnable example and import successfully",async()=>{
 const example=await handoffExample();
 const read=name=>readFile(new URL(`../examples/handoff/${name}.json`,import.meta.url),"utf8");
 assert.deepEqual(JSON.parse(await read("manifest")),JSON.parse(example.manifestJson));
 assert.deepEqual(JSON.parse(await read("schedule")),example.schedule);
 const full=await read("full-geometry");assert.deepEqual(JSON.parse(full),JSON.parse(example.fullJson));
 assert.equal((await importFullGeometry(full)).ok,true);
});

test("custom deposition, margins and fractional layers survive import without defaults replacing them",async()=>{
 const original=await generateGeometry({geometry:{baseProfile:"cylinder",modifier:"none",seed:5,heightMm:3.2,radiusMm:8},
  sampling:{layerHeightMm:.5},printing:{beadWidthMm:1.5,feedrateMmMin:750},
  validation:{safetyMarginMm:8,maxLayerDisplacementMm:.4}});
 const result=await importFullGeometry(serializeFullGeometry(original));assert.ok(result.ok);
 assert.deepEqual(result.geometry,original);assert.equal(result.geometry.contours.length,7);
});
