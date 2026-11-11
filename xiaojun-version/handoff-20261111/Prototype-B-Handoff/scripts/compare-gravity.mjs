// Controlled WebGL renders of the production buffer/material functions, without UI-only overrides.
import {chromium} from "@playwright/test";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import ts from "typescript";
import {generateGeometry} from "../src/geometry.ts";
import {createGeometryManifest} from "../src/serialization.ts";
import {scheduleFromHeightIntervals} from "../src/failureSchedule.ts";
import {applyGaps,gapResultToToolpath} from "../src/gaps.ts";
import {createResiduePlan} from "../src/clayResidue.ts";
import {analyzeSupport} from "../src/support.ts";
import {beadBuffers} from "../src/claySurface.ts";
import {accountMaterial} from "../src/materialAccounting.ts";
import {Playback} from "../src/playback.ts";
import {gravityContactExample} from "../examples/gravity-contact.ts";
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const baselineFile="artifacts/support-gravity-before.json";
async function scenario(intensity){
 const g=await generateGeometry({geometry:{baseProfile:"cylinder",modifier:"none",heightMm:20,radiusMm:15,seed:123},
  sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
 const schedule=scheduleFromHeightIntervals(createGeometryManifest(g),[{start:0,end:1,failureType:"gaps",intensity}]);
 const result=await applyGaps(g,schedule,51),path=gapResultToToolpath(result),residue=createResiduePlan(path,51);
 return {g,schedule,result,path,residue};
}
if(process.argv.includes("--capture-baseline")){
 const cases=[];
 for(const intensity of [.5,1]){
  const {g,schedule,result,path,residue}=await scenario(intensity);
  const support=analyzeSupport(path,residue,g.geometryId,result.derivedId);
  assert.equal(support.calibration.version,"1.1.0","Capture the original calibration before editing it.");
  cases.push({intensity,schedule,commandHash:hash(result),support,materialHash:hash(beadBuffers(path,residue,support.segments))});
 }
 await mkdir("artifacts",{recursive:true});
 await writeFile(baselineFile,JSON.stringify({source:await readFile("src/support.ts","utf8"),cases}));
 console.log("Captured untouched support 1.1.0, exact commands, material hashes and source for controlled comparisons.");
 process.exit(0);
}
const baseline=JSON.parse(await readFile(baselineFile,"utf8"));
const executablePath=[process.env.BROWSER_PATH,chromium.executablePath(),"C:/Program Files/Google/Chrome/Application/chrome.exe"].find(p=>p&&existsSync(p));
const browser=await chromium.launch({executablePath,headless:true,args:["--enable-webgl","--enable-unsafe-swiftshader"]});
await mkdir("artifacts",{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.route("http://127.0.0.1:5192/**",async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==="/")return route.fulfill({contentType:"text/html",body:'<style>body{margin:0}</style><script type="importmap">{"imports":{"three":"/three.module.js"}}</script>'});
  const body=path==="/material.js"?ts.transpileModule(await readFile("src/clayAppearance.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText:
    await readFile(`node_modules/three/build/${path.slice(1)}`,"utf8");
  await route.fulfill({contentType:"text/javascript",body});
 });
 await page.goto("http://127.0.0.1:5192/");
 await page.evaluate(async()=>{
  const THREE=await import("three"),{createClayMaterial}=await import("/material.js");
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1000,800);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;document.body.append(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color("#eee7dd");
  scene.add(new THREE.HemisphereLight("#fff7ed","#c6b6a2",2.5));
  for(const [color,power,pos] of [["#fff4e7",1.6,[-40,70,50]],["#edf0f2",1.2,[30,40,-40]]]){
   const light=new THREE.DirectionalLight(color,power);light.position.set(...pos);scene.add(light);
  }
  const camera=new THREE.OrthographicCamera(-25,25,20,-20,.1,500);camera.up.set(0,0,1);
  const mesh=new THREE.Mesh(new THREE.BufferGeometry(),createClayMaterial());scene.add(mesh);
  window.draw=({positions,normals,indices,close,target})=>{
   mesh.geometry.dispose();mesh.geometry=new THREE.BufferGeometry();
   mesh.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
   mesh.geometry.setAttribute("normal",new THREE.Float32BufferAttribute(normals,3));mesh.geometry.setIndex(indices);
   if(close){camera.position.set(target[0]*4,target[1]*4,target[2]+22);camera.lookAt(...target);camera.zoom=4;}
   else{camera.position.set(60,-80,55);camera.lookAt(0,0,10);camera.zoom=1;}
   camera.updateProjectionMatrix();renderer.render(scene,camera);
  };
 });
 const results=[];
 for(const saved of baseline.cases){
  const {intensity}=saved,{g,result,path,residue,schedule}=await scenario(intensity);
  assert.equal(hash(result),saved.commandHash,"Exact gap commands/events/metrics must remain unchanged.");
  assert.deepEqual(schedule,saved.schedule);
  const previous=saved.support;
  const playback=new Playback(path);playback.play();playback.advance(path.durationS);
  assert.equal(playback.elapsedS,path.durationS);assert.equal(playback.playing,false);
  assert.equal(hash(beadBuffers(path,residue,previous.segments)),saved.materialHash,"Legacy material must match its captured baseline.");
  const on=analyzeSupport(path,residue,g.geometryId,result.derivedId),off=analyzeSupport(path,residue,g.geometryId,result.derivedId,false);
  const regions=previous.regions.filter(r=>r.classification==="long").sort((a,b)=>b.lengthMm-a.lengthMm);
  // Prefer a former bridge with surviving ends so the close-up shows the new break clearly.
  const region=regions.find(r=>!on.segments[r.firstMove]?.omitted&&!on.segments[r.lastMove]?.omitted&&
    on.segments.slice(r.firstMove,r.lastMove+1).some(s=>s?.omitted))??regions[0];
  assert.ok(region,"Comparison must include an old long unsupported bridge.");

  const target=region?path.moves[Math.floor((region.firstMove+region.lastMove)/2)].start:[0,-15,10];
  for(const [mode,support] of [["off",off],["previous",previous],["revised",on]]){
   let sum=0,length=0;
   path.moves.forEach((m,i)=>{const s=support.segments[i];if(s&&!s.omitted){sum+=m.lengthMm*(s.startDropMm+s.endDropMm)/2;length+=m.lengthMm;}});
   results.push({intensity,mode,completed:true,commandHash:saved.commandHash,closeUpRegion:region,
    layerAccounting:accountMaterial(path,support.segments,beadBuffers(path,residue,support.segments)),calibration:support.calibration,gaps:result.metrics,support:{...support.metrics,
     continuityChangedSegments:support.metrics.continuityChangedSegments??0,averageDisplacementMm:length?sum/length:0}});
   const data=beadBuffers(path,residue,support.segments);
   for(const close of [false,true]){
    await page.evaluate(v=>window.draw(v),{positions:Array.from(data.positions),normals:Array.from(data.normals),indices:Array.from(data.indices),close,target});
    await page.locator("canvas").screenshot({path:`artifacts/support-gravity-${intensity}-${mode}-${close?"close":"full"}.png`});
   }
  }
 }
 if(errors.length)throw Error(errors.join("\n"));
 const controlled=await gravityContactExample(),sim=controlled.simulation;
 const contacting=sim.support.segments.find(s=>s?.layerId===2&&s.contacts.some(c=>c.layerId===0)&&s.materialState==="contacted");
 assert.ok(contacting);
 const contact=contacting.contacts.find(c=>c.layerId===0);
 for(const mode of ["off","corrected"]){
  const path=gapResultToToolpath(sim.gaps),data=mode==="off"?beadBuffers(path,sim.residue):sim.material;
  // Show only the first three deposited layers to expose the actual attachment beneath later material.
  const cutoff=path.moves.findIndex(m=>m.layerId===3);
  await page.evaluate(v=>window.draw(v),{positions:Array.from(data.positions),normals:Array.from(data.normals),indices:Array.from(data.indices.slice(0,data.indexBefore[cutoff])),close:true,target:contact.point});
  await page.locator("canvas").screenshot({path:`artifacts/gravity-contact-${mode}-close.png`});
 }
 await writeFile("artifacts/gravity-contact-example.json",JSON.stringify({metrics:sim.support.metrics,layerAccounting:sim.support.layerAccounting,contacting},null,2));
 await writeFile("artifacts/support-gravity-metrics.json",JSON.stringify(results,null,2));
 console.log("PASS: 12 completed material screenshots, off/previous/revised, intensities .5/1, matched cameras, seed 51, unchanged commands.");
}finally{await browser.close();}


