import {chromium} from "@playwright/test";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
import {saggingFixture} from "./fixtures/sagging.mjs";
import {beadBuffers} from "../src/claySurface.ts";
import {simulateSagging} from "../src/sagging.ts";
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
  window.draw=({positions,normals,indices,target,dual})=>{
   mesh.geometry.dispose();mesh.geometry=new THREE.BufferGeometry();
   mesh.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
   mesh.geometry.setAttribute("normal",new THREE.Float32BufferAttribute(normals,3));mesh.geometry.setIndex(indices);
   camera.position.set(dual?-75:60,dual?-55:-80,55);
   camera.lookAt(0,0,10);
   camera.zoom=1.4;
   if(target){
    const [x,y,z]=target;
    camera.position.set(x*4,y*4,z+10);
    camera.lookAt(x,y,z);
    camera.zoom=5.5;
   }
   camera.updateProjectionMatrix();renderer.render(scene,camera);
  };
 });

 const metrics=[],gallery=[];
 const gravity=process.argv.includes("--gravity");
 const comparisonName=process.argv.includes("--before")?"gravity-before":"gravity";
 const dual=process.argv.includes("--dual");
 const activation=process.argv.includes("--activation");
 for(const [name,intensity] of gravity?[["tapered",1],["rounded",1]]:dual?[["cylinder",1],["overhang",1],["mixed",1]]:activation?[["gentle",1]]:[["cylinder",1],["twist",.4],["fold",1],["overhang",1]]){
  const geometry=await saggingFixture(name);
  for(const value of gravity?[.5,1]:dual?(name==="cylinder"?[0,.5,1,"executed"]:[intensity]):activation?[0,.5,1,"executed"]:[0,intensity]){
   const executed=value==="executed";
   const mode=gravity?"expressive":dual?(name==="cylinder"?"expressive":name==="overhang"?"reactive":"combined"):true;
   const r=await simulateSagging(geometry,executed?1:value,activation?45:42,mode);
   const b=executed?beadBuffers(r.path):r.material;
   await page.evaluate(v=>window.draw(v),{positions:Array.from(b.positions),normals:Array.from(b.normals),indices:Array.from(b.indices),dual:dual||gravity});
   const file=`artifacts/sagging-${gravity?comparisonName+"-":dual?"dual-":activation?"activation-":""}${name}-${value}.png`;
   await page.locator("canvas").screenshot({path:file});
   gallery.push(`<figure><figcaption>${executed?"Executed path at intensity 1, before settling":`${name} / ${r.mode} / intensity ${value}`}</figcaption><img src="data:image/png;base64,${(await readFile(file)).toString("base64")}"></figure>`);
   if(activation&&(value===1||executed)){
    let peak=0,target;
    for(const [index,segment] of r.segments.entries()){
     const move=r.path.moves[index];
     if(!segment||move.kind!=="deposition")continue;
     if(segment.startDropMm>peak){peak=segment.startDropMm;target=move.start;}
     if(segment.endDropMm>peak){peak=segment.endDropMm;target=move.end;}
    }
    assert.ok(target);
    await page.evaluate(v=>window.draw(v),{positions:Array.from(b.positions),normals:Array.from(b.normals),indices:Array.from(b.indices),target});
    await page.locator("canvas").screenshot({path:`artifacts/sagging-activation-close-${executed?"executed":"settled"}.png`});
   }
   if(!executed)metrics.push({name,intensity:value,mode:r.mode,...r.metrics,expressiveEvents:r.expressiveEvents,regionDetails:r.regions,instability:r.instability,diagnostics:r.diagnostics});
  }
 }
 const panel=await browser.newPage({viewport:{width:1000,height:400}});
 await panel.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(2,1fr);background:#eee7dd;font:18px Arial;color:#433b32}figure{margin:0}figcaption{padding:10px}img{width:100%;display:block}</style>${gallery.join("")}`);
 await panel.screenshot({path:gravity?`artifacts/sagging-${comparisonName}-comparison.png`:dual?"artifacts/sagging-dual-comparison.png":activation?"artifacts/sagging-activation-comparison.png":"artifacts/sagging-comparison.png",fullPage:true});
 await writeFile(gravity?`artifacts/sagging-${comparisonName}-metrics.json`:dual?"artifacts/sagging-dual-metrics.json":activation?"artifacts/sagging-activation-metrics.json":"artifacts/sagging-metrics.json",JSON.stringify(metrics,null,2));
 assert.deepEqual(errors,[]);
 console.log(gravity?"PASS: matched tapered and bulbous renders.":dual?"PASS: six fixed-camera dual-mode renders.":activation?"PASS: matched stable, medium, high and executed-path renders.":"PASS: eight matched WebGL renders across four fixtures.");
}finally{await browser.close();}
