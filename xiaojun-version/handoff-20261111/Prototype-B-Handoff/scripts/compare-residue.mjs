// Controlled WebGL renders of the production buffer/material functions, without UI-only overrides.
import {chromium} from "@playwright/test";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import ts from "typescript";
import {generateGeometry} from "../src/geometry.ts";
import {createGeometryManifest} from "../src/serialization.ts";
import {scheduleFromHeightIntervals} from "../src/failureSchedule.ts";
import {applyGaps,gapResultToToolpath} from "../src/gaps.ts";
import {createResiduePlan} from "../src/clayResidue.ts";
import {beadBuffers} from "../src/claySurface.ts";
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
 const g=await generateGeometry({geometry:{baseProfile:"cylinder",modifier:"none",heightMm:20,radiusMm:15,seed:123},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
 const results=[];
 for(const intensity of [0,.25,.5,.75,1]){
  const result=await applyGaps(g,scheduleFromHeightIntervals(createGeometryManifest(g),[{start:0,end:1,failureType:"gaps",intensity}]),51);
  const p=gapResultToToolpath(result),plan=createResiduePlan(p,51);results.push({intensity,...result.metrics});
  // Same target for every close-up: a selected lifted end from the intensity-1 event set.
  if(intensity===0){const full=gapResultToToolpath(await applyGaps(g,scheduleFromHeightIntervals(createGeometryManifest(g),[{start:0,end:1,failureType:"gaps",intensity:1}]),51));
   const profiles=createResiduePlan(full,51),i=profiles.findIndex((e,j)=>e?.end?.liftMm>0&&e.toEndMm<=full.moves[j].lengthMm+1e-7&&full.moves[j].start[2]>8);
   globalThis.target=full.moves[i].end;}
  for(const refined of [false,true]){
   const data=beadBuffers(p,refined?plan:undefined);
   for(const close of [false,true]){
    await page.evaluate(v=>window.draw(v),{positions:Array.from(data.positions),normals:Array.from(data.normals),indices:Array.from(data.indices),close,target:globalThis.target});
    await page.locator("canvas").screenshot({path:`artifacts/residue-${intensity}-${refined?"after":"before"}-${close?"close":"full"}.png`});
   }
  }
 }
 if(errors.length)throw Error(errors.join("\n"));
 await writeFile("artifacts/residue-metrics.json",JSON.stringify(results,null,2));
 console.log("PASS: 20 controlled screenshots, 5 intensities, same source/camera/seed 51, production geometry and material.");
}finally{await browser.close();}
