import {chromium} from "@playwright/test";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";
import {generateGeometry,geometryToToolpath} from "../src/geometry.ts";
import {simulateBulges,bulgeTiming} from "../src/bulges.ts";
import {bulgeMesh} from "./fixtures/bulges-3b1.mjs";
import {beadBuffers,SIDES,writeBead,FLOATS_PER_MOVE} from "../src/claySurface.ts";
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
  window.draw=({positions,normals,indices,close,target,angle})=>{
   mesh.geometry.dispose();mesh.geometry=new THREE.BufferGeometry();
   mesh.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
   mesh.geometry.setAttribute("normal",new THREE.Float32BufferAttribute(normals,3));mesh.geometry.setIndex(indices);
   if(close){camera.position.set(target[0]*4-(angle?target[1]*2:0),target[1]*4+(angle?target[0]*2:0),target[2]+22);camera.lookAt(...target);camera.zoom=4;}
   else{camera.position.set(60,-80,55);camera.lookAt(0,0,17.5);camera.zoom=1;}
   camera.updateProjectionMatrix();renderer.render(scene,camera);
  };
 });
 const g=await generateGeometry({geometry:{baseProfile:"cylinder",modifier:"none",heightMm:35,radiusMm:15,seed:123},sampling:{layerHeightMm:1},printing:{beadWidthMm:2,feedrateMmMin:600}});
 const path=geometryToToolpath(g),base=beadBuffers(path),results=[],gallery=[],closeGallery=[];
 const imageTag=async(file,label)=>`<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${(await readFile(file)).toString("base64")}"></figure>`;
 for(const intensity of [0,.25,.5,.75,1]){
  const r=await simulateBulges(g,intensity,42),oldMeshes=r.events.map(bulgeMesh),playback=new Playback(path,bulgeTiming(path,r));
  playback.play();playback.advance(r.durationS);assert.equal(playback.elapsedS,r.durationS);
  const old={positions:Array.from(base.positions),normals:Array.from(base.normals),indices:Array.from(base.indices)};
  let inverted=0,faces=0;
  oldMeshes.forEach((mesh,i)=>{const offset=old.positions.length/3,e=r.events[i];
   for(let k=0;k<mesh.positions.length;k+=3)old.positions.push(e.position[0]+mesh.positions[k],e.position[1]+mesh.positions[k+1],e.position[2]+mesh.positions[k+2]);
   old.normals.push(...mesh.normals);old.indices.push(...Array.from(mesh.indices,k=>k+offset));
   for(let k=0;k<mesh.indices.length;k+=3){const [a,b,c]=Array.from(mesh.indices.slice(k,k+3),x=>x*3),p=mesh.positions;
    const u=[0,1,2].map(j=>p[b+j]-p[a+j]),v=[0,1,2].map(j=>p[c+j]-p[a+j]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    if(Math.hypot(...n)<1e-8)continue;faces++;if(n.reduce((sum,x,j)=>sum+x*mesh.normals[a+j],0)<0)inverted++;
   }
  });
  const relativeError=r.patches.reduce((max,p,i)=>Math.max(max,Math.abs(p.extraVolumeMm3-r.events[i].extraVolumeMm3)/r.events[i].extraVolumeMm3),0);
  results.push({geometryId:g.geometryId,intensity,seed:42,...r.metrics,maximumRelativeVolumeError:relativeError,oldInvertedFaces:inverted,oldFaces:faces});
  for(const [name,b] of [["original",base],["3b1",old],["3b2",r.material]]){
   const data={positions:Array.from(b.positions),normals:Array.from(b.normals),indices:Array.from(b.indices)};
   await page.evaluate(v=>window.draw(v),{...data,close:false});
   const file=`artifacts/swelling-${name}-${intensity}.png`;await page.locator("canvas").screenshot({path:file});gallery.push(await imageTag(file,`${name} / intensity ${intensity}`));
   if(intensity)for(const angle of [false,true]){
    await page.evaluate(v=>window.draw(v),{...data,close:true,target:r.events[0].position,angle});
    const file=`artifacts/swelling-${name}-${intensity}-close${angle?"-side":""}.png`;await page.locator("canvas").screenshot({path:file});
    if(intensity===.5&&!angle)closeGallery.push(await imageTag(file,`${name} / intensity 0.5`));
   }
  }
  if(intensity===.5){
   const patch=r.patches[0],m=patch.moves.reduce((best,m)=>m.start>best.start?m:best),centre=path.moves[m.moveIndex].start,radial=[centre[0]/Math.hypot(...centre.slice(0,2)),centre[1]/Math.hypot(...centre.slice(0,2))];
   const ring=(p,o,c,rad)=>Array.from({length:SIDES},(_,j)=>[(p[o+j*3]-c[0])*rad[0]+(p[o+j*3+1]-c[1])*rad[1],p[o+j*3+2]-c[2]]);
   const e=r.events[0],oldMesh=oldMeshes[0],oldRad=[e.position[0]/15,e.position[1]/15],section=[];
   for(let i=0;i<oldMesh.indices.length;i+=3){
    const vertices=Array.from(oldMesh.indices.slice(i,i+3),id=>Array.from(oldMesh.positions.slice(id*3,id*3+3))),hits=[];
    for(let k=0;k<3;k++){const a=vertices[k],b=vertices[(k+1)%3],da=a[0]*e.tangent[0]+a[1]*e.tangent[1],db=b[0]*e.tangent[0]+b[1]*e.tangent[1];
     if(da*db<0){const f=da/(da-db),v=a.map((x,j)=>x+f*(b[j]-x));hits.push([v[0]*oldRad[0]+v[1]*oldRad[1],v[2]]);}
    }if(hits.length===2)section.push(hits);
   }
   const tmp=new Float32Array(FLOATS_PER_MOVE),norm=new Float32Array(FLOATS_PER_MOVE),move=path.moves[e.moveIndex],fraction=(e.pathTimeS-move.startTimeS)/(move.endTimeS-move.startTimeS);
   writeBead(move,fraction,tmp,norm);
   const crossPage=await browser.newPage({viewport:{width:1100,height:420}});
   await crossPage.setContent('<style>body{margin:0;background:#eee7dd;font:16px Arial}canvas{display:block}</style><canvas width="1100" height="420"></canvas>');
   await crossPage.evaluate(({original,corrected,oldBase,section})=>{
    const c=document.querySelector("canvas").getContext("2d");c.fillStyle="#eee7dd";c.fillRect(0,0,1100,420);
    const draw=(points,x,color,fill=false)=>{c.beginPath();points.forEach(([r,z],i)=>{const px=x+r*85,py=200-z*85;i?c.lineTo(px,py):c.moveTo(px,py)});if(fill){c.closePath();c.fillStyle=color;c.fill()}else{c.strokeStyle=color;c.lineWidth=3;c.stroke()}};
    for(const x of [190,740]){c.strokeStyle="#c0b5a5";c.beginPath();c.moveTo(x-130,200);c.lineTo(x+280,200);c.stroke();}
    draw(oldBase,190,"#c5b9aa",true);for(const line of section)draw(line,190,"#864e31");
    draw(corrected,740,"#b47854",true);draw(original,740,"#c5b9aa",true);draw([...original,original[0]],740,"#635b50");
    c.fillStyle="#433b32";c.font="19px Arial";c.fillText("3B.1: separate mesh intersects the bead",30,45);c.fillText("3B.2: integrated outward swelling",570,45);
    c.font="15px Arial";c.fillText("Section through the dwell point",30,78);c.fillText("Section through the swollen peak behind the dwell",570,78);
    c.fillText("Horizontal = outward radial distance; vertical = Z (equal mm scale)",30,355);
    c.fillText("Grey: original bead   Brown: added material / old mesh outline   Intensity 0.5, seed 42",30,385);
   },{original:ring(base.positions,m.offset,centre,radial),corrected:ring(r.material.positions,m.offset,centre,radial),oldBase:ring(tmp,SIDES*3,e.position,oldRad),section});
   await crossPage.screenshot({path:"artifacts/swelling-cross-section.png"});await crossPage.close();
  }
 }
 const galleryPage=await browser.newPage({viewport:{width:1200,height:400}});
 for(const [name,items] of [["comparison",gallery],["close-comparison",closeGallery]]){
  await galleryPage.setContent(`<style>body{margin:0;background:#eee7dd;display:grid;grid-template-columns:repeat(3,1fr);font:16px Arial;color:#433b32}figure{margin:0}figcaption{padding:10px}img{width:100%;display:block}</style>${items.join("")}`);
  await galleryPage.screenshot({path:`artifacts/swelling-${name}.png`,fullPage:true});
 }
 await writeFile("artifacts/swelling-metrics.json",JSON.stringify(results,null,2));assert.deepEqual(errors,[]);
 console.log("PASS: five intensities, original/3B.1/3B.2 full and two-angle close comparisons, actual mesh cross-sections; no browser errors.");
}finally{await browser.close();}
