import {chromium} from "@playwright/test";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
import {generateGeometry,geometryToToolpath} from "../src/geometry.ts";
import {simulateBulges,bulgeTiming} from "../src/bulges.ts";
import {buildSwelling as previousSwelling} from "./fixtures/swelling-3b2.ts";
import {beadBuffers,SIDES} from "../src/claySurface.ts";
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
  const camera=new THREE.OrthographicCamera(-30,30,24,-24,.1,500);camera.up.set(0,0,1);
  const mesh=new THREE.Mesh(new THREE.BufferGeometry(),createClayMaterial());scene.add(mesh);
  window.draw=({positions,normals,indices,view,target})=>{
   mesh.geometry.dispose();mesh.geometry=new THREE.BufferGeometry();
   mesh.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
   mesh.geometry.setAttribute("normal",new THREE.Float32BufferAttribute(normals,3));mesh.geometry.setIndex(indices);
   if(view==="exterior-close"){camera.position.set(target[0]*4,target[1]*4,target[2]+15);camera.lookAt(...target);camera.zoom=4;}
   else if(view==="interior-close"){camera.position.set(0,0,55);camera.lookAt(...target);camera.zoom=4;}
   else if(view==="interior"){camera.position.set(-target[0]*2,-target[1]*2,90);camera.lookAt(0,0,17.5);camera.zoom=1;}
   else{camera.position.set(target[0]*5,target[1]*5,65);camera.lookAt(0,0,17.5);camera.zoom=1;}
   camera.updateProjectionMatrix();renderer.render(scene,camera);
  };
 });
 const g=await generateGeometry({geometry:{baseProfile:"cylinder",modifier:"none",heightMm:35,radiusMm:15,seed:123},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
 const path=geometryToToolpath(g),base=beadBuffers(path),results=[],gallery=[];
 const imageTag=async(file,label)=>`<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${(await readFile(file)).toString("base64")}"></figure>`;
 for(const intensity of [0,.25,.5,.75,1]){
  const r=await simulateBulges(g,intensity,42),old=previousSwelling(path,r.events),playback=new Playback(path,bulgeTiming(path,r));
  playback.play();playback.advance(r.durationS);assert.equal(playback.elapsedS,r.durationS);
  const relativeError=r.patches.reduce((max,p,i)=>Math.max(max,Math.abs(p.extraVolumeMm3-r.events[i].extraVolumeMm3)/r.events[i].extraVolumeMm3),0);
  results.push({geometryId:g.geometryId,intensity,seed:42,...r.metrics,maximumRelativeVolumeError:relativeError});
  if(![.5,1].includes(intensity))continue;
  const eventIndex=r.events.length-1,target=r.events[eventIndex].position;
  for(const view of intensity===.5?["exterior","interior","exterior-close","interior-close"]:["exterior","interior"]){
   for(const [name,b] of [["Original",base],["3B.2-outward",old.material],["3B.2b-bidirectional",r.material]]){
    await page.evaluate(v=>window.draw(v),{positions:Array.from(b.positions),normals:Array.from(b.normals),indices:Array.from(b.indices),view,target});
    const file=`artifacts/bidirectional-${name}-${intensity}-${view}.png`;await page.locator("canvas").screenshot({path:file});
    if(intensity===.5)gallery.push(await imageTag(file,`${name} / ${view}`));
   }
  }
  if(intensity===.5){
   const patch=r.patches[eventIndex],m=patch.moves.reduce((best,m)=>m.start>best.start?m:best),centre=path.moves[m.moveIndex].start;
   const rings=[base,old.material,r.material].map(b=>Array.from({length:SIDES},(_,j)=>[(b.positions[m.offset+j*3]-centre[0])*m.startNormal[0]+(b.positions[m.offset+j*3+1]-centre[1])*m.startNormal[1],b.positions[m.offset+j*3+2]-centre[2]]));
   const section=await browser.newPage({viewport:{width:1200,height:400}});
   await section.setContent('<style>body{margin:0;background:#eee7dd}</style><canvas width="1200" height="400"></canvas>');
   await section.evaluate(rings=>{
    const c=document.querySelector("canvas").getContext("2d");c.fillStyle="#eee7dd";c.fillRect(0,0,1200,400);
    const draw=(points,x,fill)=>{c.beginPath();points.forEach(([r,z],i)=>{const px=x+r*75,py=190-z*75;i?c.lineTo(px,py):c.moveTo(px,py)});c.closePath();if(fill){c.fillStyle=fill;c.fill()}else{c.strokeStyle="#544a3e";c.lineWidth=2;c.stroke()}};
    rings.forEach((ring,i)=>{const x=180+i*400;c.strokeStyle="#c5baa9";c.beginPath();c.moveTo(x-160,190);c.lineTo(x+200,190);c.stroke();draw(ring,x,"#b47854");draw(rings[0],x,"#c5b9aa");draw(rings[0],x);c.fillStyle="#433b32";c.font="19px Arial";c.fillText(["Original","3B.2: outward only","3B.2b: both sides"][i],25+i*400,40);c.font="15px Arial";c.fillText("Interior  <  centreline  >  Exterior",25+i*400,310)});
    c.fillText("Actual shared cross-section / identical event and plane / equal mm scale / intensity 0.5, seed 42",25,365);
   },rings);
   await section.screenshot({path:"artifacts/bidirectional-cross-section.png"});await section.close();
  }
 }
 const galleryPage=await browser.newPage({viewport:{width:1200,height:400}});
 await galleryPage.setContent(`<style>body{margin:0;background:#eee7dd;display:grid;grid-template-columns:repeat(3,1fr);font:16px Arial;color:#433b32}figure{margin:0}figcaption{padding:10px}img{width:100%;display:block}</style>${gallery.join("")}`);
 await galleryPage.screenshot({path:"artifacts/bidirectional-comparison.png",fullPage:true});
 await writeFile("artifacts/bidirectional-metrics.json",JSON.stringify(results,null,2));assert.deepEqual(errors,[]);
 console.log("PASS: original/outward/bidirectional, matching exterior/interior/close views, actual section; five intensity metrics; no browser errors.");
}finally{await browser.close();}
