import test from "node:test";
import assert from "node:assert/strict";
import {generateBaseGeometry,generateGeometry,geometryToToolpath} from "../src/geometry.ts";
import {validateGeneratedContours} from "../src/geometryValidation.ts";
import {generateToolpath,DEFAULT_PARAMETERS,cylinderContours} from "../src/toolpath.ts";
import {generateShape,SHAPE_FAMILIES,SCULPTURAL_MODIFIERS} from "../src/shapes.ts";
import {MACHINE} from "../src/machine.ts";
import {Playback} from "../src/playback.ts";
const request=(baseProfile="bulbous",modifier="ribbed")=>({geometry:{baseProfile,modifier,seed:123,heightMm:35,radiusMm:15,
 parameters:{foldAmplitude:.7,sculpturalIntensity:.7}},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600},machine:MACHINE});
test("validated boundary supports all nine combinations, legacy IDs and playback",async()=>{
 for(const family of SHAPE_FAMILIES) for(const modifier of SCULPTURAL_MODIFIERS) {
  const r=request(family,modifier),a=await generateBaseGeometry(r),b=await generateBaseGeometry(r);
  assert.ok(a.ok); assert.deepEqual(a,b); assert.deepEqual(a.geometry,await generateGeometry(r));
  assert.ok(["valid","valid-with-warnings"].includes(a.geometry.validation.status));
  assert.ok(a.geometry.validation.buildVolume.valid); assert.equal(a.geometry.contours.length,35);
  a.geometry.contours.forEach((c,i)=>{assert.equal(c.layerId,i);assert.equal(c.zMm,i+.5);assert.equal(c.normalizedHeight,c.zMm/35);});
  const path=geometryToToolpath(a.geometry),player=new Playback(path);player.play();player.advance(path.durationS);
  assert.equal(player.playing,false);assert.deepEqual(player.sample().position,path.moves.at(-1).end);
  path.contours[0].points[0][0]=999;
  assert.notEqual(a.geometry.contours[0].points[0][0],999);
  assert.ok(Object.isFrozen(a.geometry.contours[0].points));
  const zero=await generateBaseGeometry({...r,geometry:{...r.geometry,parameters:{foldAmplitude:0,sculpturalIntensity:0}}});
  const base=await generateBaseGeometry({...r,geometry:{...r.geometry,modifier:"none"}});
  assert.ok(zero.ok&&base.ok);assert.deepEqual(zero.geometry.contours,base.geometry.contours);
 }
});
test("malformed and unsupported configurations never publish successful geometry",async()=>{
 const r=request();
 for(const bad of [null,{}, {...r,contours:[]}, {...r,validation:{valid:true}}, {...r,geometry:{...r.geometry,seed:NaN}},
  {...r,geometry:{...r.geometry,modifier:""}}, {...r,geometry:{...r.geometry,heightMm:0}},
  {...r,geometry:{...r.geometry,parameters:{ribCount:3.5}}},
  {...r,geometry:{...r.geometry,parameters:{unknown:1}}},
  {...r,sampling:{layerHeightMm:0}}, {...r,sampling:{layerHeightMm:1,minSegments:3}},
  {...r,validation:{safetyMarginMm:null}}, {...r,printing:{...r.printing,beadHeightMm:4}},
  {...r,machine:{...MACHINE,diameterMm:2000}},
  {...r,validation:{safetyMarginMm:0}}, // conflicts with explicit machine margin 5
 ]) {
  const result=await generateBaseGeometry(bad); assert.equal(result.ok,false);
  assert.equal("geometry" in result,false); assert.ok(result.errors[0].message); assert.ok(Object.isFrozen(result.errors));
 }
 const warning=await generateBaseGeometry({...r,validation:{maxLayerDisplacementMm:.00001}});
 assert.ok(warning.ok);assert.equal(warning.geometry.validation.status,"valid-with-warnings");
});
test("raw contours cannot bypass mandatory public envelope validation",async()=>{
 const dimensions={...DEFAULT_PARAMETERS,radiusMm:99};
 const raw=generateShape(dimensions,cylinderContours(dimensions),{family:"cylinder",seed:123});
 assert.ok(raw.contours.length);assert.equal(raw.descriptor.validation,undefined);
 const r=request("cylinder","none");r.geometry.radiusMm=99;
 const rejected=await generateBaseGeometry(r);
 assert.equal(rejected.ok,false);assert.equal(rejected.errors[0].code,"machine-envelope");
 assert.equal("geometry" in rejected,false);
 await assert.rejects(generateGeometry(r),/Build-volume/);
 r.geometry.radiusMm=15;r.geometry.heightMm=400;
 assert.equal((await generateBaseGeometry(r)).ok,false); // Includes the final lift.
});
test("topology gate rejects malformed generated contours and disconnected moves",()=>{
 const path=generateToolpath(DEFAULT_PARAMETERS);
 for(const mutate of [
  p=>p.contours[0].points[0][0]=NaN,
  p=>p.contours[0].points.pop(),
  p=>p.contours[0].points.reverse(),
  p=>p.contours[0].points[2]=[...p.contours[0].points[1]],
  p=>{const c=p.contours[0];[c.points[2],c.points[4]]=[c.points[4],c.points[2]];},
  p=>p.contours[1].layerId=0,
  p=>p.contours[1].zMm=0,
  p=>p.moves[2].start=[99,99,99],
  p=>p.moves[0].extrude=true,
  p=>p.moves[2].lengthMm=999,
  p=>p.moves[2].feedrateMmMin=1,
 ]) {const corrupt=structuredClone(path);mutate(corrupt);assert.throws(()=>validateGeneratedContours(corrupt),/Geometry validation/);}
 validateGeneratedContours(path);
});
