import {chromium} from "@playwright/test";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
import {generateGeometry} from "../src/geometry.ts";
import {simulateOffsets} from "../src/offsets.ts";
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
  const camera=new THREE.OrthographicCamera(-37.5,37.5,30,-30,.1,500);camera.up.set(0,0,1);
  const mesh=new THREE.Mesh(new THREE.BufferGeometry(),createClayMaterial());scene.add(mesh);
  window.draw=({positions,normals,indices,heightMm})=>{
   mesh.geometry.dispose();mesh.geometry=new THREE.BufferGeometry();
   mesh.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
   mesh.geometry.setAttribute("normal",new THREE.Float32BufferAttribute(normals,3));mesh.geometry.setIndex(indices);
   camera.position.set(60,-80,55);
   camera.lookAt(0,0,heightMm/2);
   camera.zoom=heightMm===20?1.5:1;
   camera.updateProjectionMatrix();renderer.render(scene,camera);
  };
 });
 const results=[],gallery=[];
 const short=process.argv.includes("--short");
 for(const [name,baseProfile,modifier] of short?[["Cylinder","cylinder","none"]]:[["Cylinder","cylinder","none"],["Folded","bulbous","soft-organic-fold"],["Twisted","tapered","twisted"]]){
  const g=await generateGeometry({geometry:{baseProfile,modifier,heightMm:short?20:35,radiusMm:15,seed:123,parameters:{sculpturalIntensity:.7,foldAmplitude:.7}},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
  for(const mode of ["sudden","local","combined"])for(const intensity of short?[0,.7]:[0,.15,.5,1]){
   const r=await simulateOffsets(g,mode,intensity,42),playback=new Playback(r.path);playback.play();playback.advance(r.path.durationS);assert.equal(playback.elapsedS,r.path.durationS);
   results.push({name,mode,intensity,...r.metrics,events:r.events,buildVolume:r.path.buildVolume});
   if(intensity===0&&mode!=="sudden")continue;
   const b=r.material;await page.evaluate(v=>window.draw(v),{positions:Array.from(b.positions),normals:Array.from(b.normals),indices:Array.from(b.indices),heightMm:g.geometry.heightMm});
   const file=`artifacts/offsets${short?"-short":""}-${name}-${mode}-${intensity}.png`;await page.locator("canvas").screenshot({path:file});
   if(name==="Cylinder"&&(short||intensity))gallery.push(`<figure><figcaption>${intensity?mode:"stable"} / intensity ${intensity}</figcaption><img src="data:image/png;base64,${(await readFile(file)).toString("base64")}"></figure>`);
  }
 }
 const panel=await browser.newPage({viewport:{width:1200,height:400}});await panel.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(${short?4:3},1fr);background:#eee7dd;font:16px Arial;color:#433b32}figure{margin:0}figcaption{padding:10px}img{width:100%;display:block}</style>${gallery.join("")}`);
 await panel.screenshot({path:short?"artifacts/offsets-short-comparison.png":"artifacts/offsets-comparison.png",fullPage:true});
 assert.deepEqual(errors,[]);await writeFile(short?"artifacts/offsets-short-metrics.json":"artifacts/offsets-metrics.json",JSON.stringify(results,null,2));
 console.log(short?"PASS: matched Stable, Sudden, Local and Combined renders at 20 layers.":"PASS: 30 completed fixed-camera renders and 36 quantitative records.");
}finally{await browser.close();}
