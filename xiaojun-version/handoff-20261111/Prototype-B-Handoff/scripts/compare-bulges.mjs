import {chromium} from "@playwright/test";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
import {generateGeometry,geometryToToolpath} from "../src/geometry.ts";
import {simulateBulges,bulgeTiming} from "../src/bulges.ts";
import {Playback} from "../src/playback.ts";
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
 for(const [name,baseProfile,modifier] of [["cylinder","cylinder","none"],["bulbous","bulbous","none"],["twisted","bulbous","twisted"]]){
  const g=await generateGeometry({geometry:{baseProfile,modifier,heightMm:20,radiusMm:15,seed:123,parameters:{sculpturalIntensity:.7}},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
  for(const intensity of [0,.25,.5,.75,1]){
   const r=await simulateBulges(g,intensity,51),path=geometryToToolpath(g),playback=new Playback(path,bulgeTiming(path,r));
   playback.play();playback.advance(r.durationS);assert.equal(playback.elapsedS,r.durationS);
   results.push({name,intensity,...r.metrics});
   if(![0,.5,1].includes(intensity))continue;
   const b=r.material,positions=Array.from(b.positions),normals=Array.from(b.normals),indices=Array.from(b.indices);
   await page.evaluate(v=>window.draw(v),{positions,normals,indices,close:false});
   await page.locator("canvas").screenshot({path:`artifacts/bulges-${name}-${intensity}.png`});
   if(name==="cylinder"&&intensity===1){
    await page.evaluate(v=>window.draw(v),{positions,normals,indices,close:true,target:r.events[0].position});
    await page.locator("canvas").screenshot({path:"artifacts/bulges-dwell-close.png"});
   }
  }
 }
 assert.deepEqual(errors,[]);await writeFile("artifacts/bulges-metrics.json",JSON.stringify(results,null,2));
 console.log("PASS: 9 fixed-camera full prints and one dwell close-up; 15 calibration records.");
}finally{await browser.close();}
