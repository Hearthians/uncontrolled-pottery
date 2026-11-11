import test from "node:test";
import assert from "node:assert/strict";
import {generateToolpath, DEFAULT_PARAMETERS, randomValidShape} from "../src/toolpath.ts";
import {generateGeometry} from "../src/geometry.ts";
import {SHAPE_FAMILIES, SCULPTURAL_MODIFIERS, resolveShape, vesselPoint} from "../src/shapes.ts";
import {Playback} from "../src/playback.ts";
const dimensions = {...DEFAULT_PARAMETERS, heightMm:35};
const build = (family, modifier, seed=123, parameters={}) => generateToolpath(dimensions,{family,modifier,seed,parameters:{foldAmplitude:.7,sculpturalIntensity:.7,...parameters}});
for(const modifier of SCULPTURAL_MODIFIERS) test(`${modifier}: reproducible simple contours, neutral recovery and playback on all bases`, async()=>{
 for(const family of SHAPE_FAMILIES) {
  const path=build(family,modifier), baseline=build(family,"none");
  assert.deepEqual(path,build(family,modifier));
  assert.notDeepEqual(path.contours,baseline.contours);
  assert.deepEqual(build(family,modifier,123,{foldAmplitude:0,sculpturalIntensity:0}).contours,baseline.contours);
  assert.notDeepEqual(path.contours,build(family,modifier,999).contours);
  for(let seed=0;seed<12;seed++) for(const c of build(family,modifier,seed).contours) {
   assert.deepEqual(c.points[0],c.points.at(-1));
   for(let i=0;i<c.points.length-1;i++) {
    const a=c.points[i],b=c.points[i+1];
    assert.ok(a.every(Number.isFinite)); assert.equal(a[2],c.zMm);
    assert.ok(a[0]*b[1]-a[1]*b[0]>0); // Ordered positive-radius wedges are simple.
   }
  }
  const player=new Playback(path); player.play(); player.advance(path.durationS);
  assert.equal(player.playing,false); assert.deepEqual(player.sample().position,path.moves.at(-1).end);
  path.moves.forEach((m,i)=>{if(i) assert.deepEqual(m.start,path.moves[i-1].end); assert.equal(m.extrude,m.kind!=="travel");});
  const result=await generateGeometry({geometry:{baseProfile:family,modifier,seed:123,heightMm:35,radiusMm:15,parameters:{foldAmplitude:.7,sculpturalIntensity:.7}},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
  assert.deepEqual(result.toolpath.moves,path.moves); assert.equal(result.geometry.modifier,modifier);
  assert.ok(Object.isFrozen(result.contours[0].points)); assert.equal(result.validation.buildVolume.valid,true);
 }
});
test("helical phase moves actual lobes and direction reverses rotation",()=>{
 const p=resolveShape({family:"cylinder",seed:123,parameters:{twistPhase:0,twistAngle:Math.PI,twistVariation:0,lobeCount:3,sculpturalIntensity:1}});
 for(const direction of [-1,1]) {
  p.twistDirection=direction;
  for(const z of [5,15,25]) {
   const phase=direction*Math.PI*z/35;
   const peak=vesselPoint(phase,z,dimensions,p,"twisted"), trough=vesselPoint(phase+Math.PI/3,z,dimensions,p,"twisted");
   assert.ok(Math.hypot(...peak.slice(0,2))>Math.hypot(...trough.slice(0,2))+.5);
   const seam=vesselPoint(0,z,dimensions,p,"twisted"), other=vesselPoint(2*Math.PI,z,dimensions,p,"twisted");
   assert.ok(Math.hypot(...seam.map((v,i)=>v-other[i]))<1e-9);
  }
 }
});
test("maximum ribs are resolved and extreme inputs are bounded or rejected",()=>{
 const parameters={ribCount:24,ribSharpness:4,ribDepth:.15,sculpturalIntensity:1};
 const path=build("bulbous","ribbed",123,parameters);
 assert.ok(path.contours[0].points.length-1>=24*48);
 const p=resolveShape({family:"bulbous",modifier:"ribbed",seed:123,parameters});
 // Bound midpoint chord error against the analytic profile at the highest supported frequency.
 for(const c of [path.contours[0],path.contours[17],path.contours.at(-1)]) {
  const n=c.points.length-1;
  for(let i=0;i<n;i++) {
   const exact=vesselPoint((i+.5)/n*2*Math.PI,c.zMm,dimensions,p,"ribbed");
   const mid=c.points[i].map((v,j)=>(v+c.points[i+1][j])/2);
   assert.ok(Math.hypot(...exact.map((v,j)=>v-mid[j]))<.08);
  }
 }
 assert.throws(()=>build("cylinder","ribbed",1,{ribCount:25}),/out of range/);
 assert.throws(()=>build("cylinder","twisted",1,{twistDirection:0}),/direction/);
 assert.throws(()=>build("cylinder","twisted",1,{twistAngle:Infinity}),/out of range/);
 assert.throws(()=>generateToolpath({...dimensions,heightMm:200},{family:"cylinder",seed:1,modifier:"ribbed",parameters}),/200000/);
 for(const modifier of SCULPTURAL_MODIFIERS) {
  assert.throws(()=>generateToolpath({...dimensions,radiusMm:99},{family:"bulbous",seed:1,modifier,parameters:{foldAmplitude:1}}),/Build-volume/);
  const selection={family:"cylinder",modifier};
  const a=randomValidShape(dimensions,123,5,selection);
  assert.equal(a.modifier,modifier); assert.deepEqual(a,randomValidShape(dimensions,123,5,selection));
 }
 const extreme=build("cylinder","twisted",1,{twistAngle:2*Math.PI,twistVariation:.8,lobeCount:6,twistAmplitude:.18,sculpturalIntensity:1});
 assert.ok(extreme.buildVolume.valid);
});
