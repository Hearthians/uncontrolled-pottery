import test from "node:test";
import assert from "node:assert/strict";
import { generateToolpath, DEFAULT_PARAMETERS } from "../src/toolpath.ts";
import { resolveShape } from "../src/shapes.ts";
import { generateGeometry } from "../src/geometry.ts";
const dimensions = {...DEFAULT_PARAMETERS, heightMm:90, radiusMm:30};
const build = (seed=123, parameters={}) => generateToolpath(dimensions,
 {family:"bulbous",modifier:"ribbed",seed,parameters:{sculpturalIntensity:.7,...parameters}});
function relief(path, index) {
 const c=path.contours[index], radius=30*(1+.2*Math.sin(Math.PI*c.zMm/90)**2);
 const delta=c.points.slice(0,-1).map(p=>Math.hypot(p[0],p[1])-radius);
 return {min:Math.min(...delta),max:Math.max(...delta),peak:delta.indexOf(Math.max(...delta))};
}
test("seeded defaults produce rounded 8–12 rib fluting with limited height attenuation",()=>{
 for(let seed=0;seed<40;seed++) {
  const p=resolveShape({family:"bulbous",modifier:"ribbed",seed});
  assert.ok(p.ribCount>=8&&p.ribCount<=12);
  assert.ok(p.ribDepth>=.1&&p.ribDepth<=.12);
  assert.ok(p.ribSharpness>=1.1&&p.ribSharpness<=1.5);
  assert.ok(p.ribHeightVariation>=.05&&p.ribHeightVariation<=.15);
 }
 const path=build(), mid=relief(path,45), bottom=relief(path,0);
 assert.ok(mid.max>2&&mid.max<3.1); assert.ok(mid.min< -2);
 assert.ok(bottom.max/mid.max>.65);
 assert.equal(bottom.peak,mid.peak); // No helical drift along height.
 assert.equal(path.shape.parameters.ribCount,12);
 assert.deepEqual(path,build());
 const old=build(123,{ribCount:16,ribDepth:.10606567240320146,ribSharpness:2.91736724274233,
  ribPhase:.5713351364588618,ribHeightVariation:.6222316605737432});
 assert.ok(bottom.max>2*relief(old,0).max);
 assert.equal(path.shape.warnings.length,0);
 assert.ok(old.shape.warnings.some(w=>w.code==="tight-curvature"));
 assert.ok(build(123,{ribCount:24,ribDepth:.15,ribSharpness:4}).shape.warnings.some(w=>w.code==="tight-curvature"));
});
test("refined contours retain closure, sampling, neutral recovery and shared consumer compatibility",async()=>{
 const path=build();
 for(const c of path.contours) {
  assert.deepEqual(c.points[0],c.points.at(-1));
  assert.ok(c.points.every(p=>p.every(Number.isFinite)&&p[2]===c.zMm));
  assert.ok(c.points.length-1>=path.shape.parameters.ribCount*24);
 }
 assert.deepEqual(build(123,{sculpturalIntensity:0}).contours,
  generateToolpath(dimensions,{family:"bulbous",modifier:"none",seed:123}).contours);
 const g=await generateGeometry({geometry:{heightMm:90,radiusMm:30,baseProfile:"bulbous",modifier:"ribbed",seed:123,
  parameters:{sculpturalIntensity:.7}},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
 assert.equal(g.schemaVersion,"1.1.0"); assert.equal(g.generatorVersion,"1.1.1");
 assert.equal(g.geometry.modifier,"ribbed"); assert.deepEqual(g.toolpath.moves,path.moves);
 assert.ok(Object.isFrozen(g.contours[0].points)); assert.ok(g.validation.buildVolume.valid);
 assert.throws(()=>generateToolpath({...dimensions,radiusMm:90},{family:"bulbous",modifier:"ribbed",seed:123}),/Build-volume/);
});
