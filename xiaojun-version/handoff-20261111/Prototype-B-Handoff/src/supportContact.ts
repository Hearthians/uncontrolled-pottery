/** Vertical contact against actual bead triangles; independent of Three.js and contour angles. */
import {SIDES} from "./claySurface.ts";
type Point=readonly [number,number,number,number]; // XYZ and endpoint interpolation weight
type Triangle={p:Point[];den:number;minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number;move:number;layerId:number};
export type ContactLimit=Readonly<{t:number;clearanceMm:number;move:number;layerId:number;x:number;y:number;z:number}>;
function triangle(p:Point[],move:number,layerId:number):Triangle{
 const [a,b,c]=p,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
 return {p,den,move,layerId,minX:Math.min(...p.map(v=>v[0])),maxX:Math.max(...p.map(v=>v[0])),
  minY:Math.min(...p.map(v=>v[1])),maxY:Math.max(...p.map(v=>v[1])),minZ:Math.min(...p.map(v=>v[2])),maxZ:Math.max(...p.map(v=>v[2]))};
}
function weights(t:Triangle,x:number,y:number){
 const [a,b,c]=t.p,u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/t.den,
  v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/t.den;
 return [u,v,1-u-v];
}
function value(t:Triangle,w:number[],axis:number){return w.reduce((s,v,i)=>s+v*t.p[i][axis],0);}
function surfaces(positions:Float32Array,top:boolean,move=-1,layerId=-1){
 const out:Triangle[]=[];
 for(let j=top?0:SIDES/2;j<(top?SIDES/2:SIDES);j++)for(const ids of [[j,(j+1)%SIDES,j+SIDES],[(j+1)%SIDES,(j+1)%SIDES+SIDES,j+SIDES]]){
  const t=triangle(ids.map(k=>[positions[k*3],positions[k*3+1],positions[k*3+2],k>=SIDES?1:0] as Point),move,layerId);
  if(Math.abs(t.den)>1e-10)out.push(t);
 }
 return out;
}
/** Clip projected triangles. Linear clearance reaches its minimum at an overlap vertex. */
function overlap(a:Triangle,b:Triangle){
 let polygon=a.p.map(p=>[p[0],p[1]]);
 for(let edge=0;edge<3&&polygon.length;edge++){
  const u=b.p[edge],v=b.p[(edge+1)%3],sign=Math.sign(b.den);
  const distance=(p:number[])=>sign*((v[0]-u[0])*(p[1]-u[1])-(v[1]-u[1])*(p[0]-u[0]));
  const output:number[][]=[];
  for(let i=0;i<polygon.length;i++){
   const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=distance(p),dq=distance(q);
   if(dp>=0)output.push(p);
   if((dp>=0)!==(dq>=0)){const f=dp/(dp-dq);output.push([p[0]+f*(q[0]-p[0]),p[1]+f*(q[1]-p[1])]);}
  }
  polygon=output;
 }
 return polygon;
}
export class DepositedSurface {
 private grid=new Map<string,Triangle[]>();
 queries=0;
 private cell:number;private budget:number;
 constructor(cell:number,budget:number){this.cell=cell;this.budget=budget;}
 private count(){if(++this.queries>this.budget)throw new Error("Support contact-query budget exceeded; reduce model complexity.");}
 add(positions:Float32Array,move:number,layerId:number){
  for(const t of surfaces(positions,true,move,layerId))for(let x=Math.floor(t.minX/this.cell);x<=Math.floor(t.maxX/this.cell);x++)
   for(let y=Math.floor(t.minY/this.cell);y<=Math.floor(t.maxY/this.cell);y++){
    const key=`${x},${y}`,list=this.grid.get(key);if(list)list.push(t);else this.grid.set(key,[t]);
   }
 }
 /** Highest earlier material below the query, with the build surface as an explicit fallback. */
 below(x:number,y:number,bottom:number,reach:number){
  let hit={z:0,move:-1,layerId:-1};
  for(const t of this.grid.get(`${Math.floor(x/this.cell)},${Math.floor(y/this.cell)}`)??[]){
   if(t.maxZ<bottom-reach||t.minZ>bottom+1e-5||x<t.minX||x>t.maxX||y<t.minY||y>t.maxY)continue;this.count();
   const w=weights(t,x,y);if(w.some(v=>v< -1e-7))continue;
   const z=value(t,w,2);if(z<=bottom+1e-5&&z>=hit.z)hit={z,move:t.move,layerId:t.layerId};
  }
  return hit;
 }
 limits(positions:Float32Array,reach:number):ContactLimit[]{
  const limits:ContactLimit[]=[];
  for(const upper of surfaces(positions,false)){
   for(const p of upper.p)limits.push({t:p[3],clearanceMm:Math.max(0,p[2]),move:-1,layerId:-1,x:p[0],y:p[1],z:0});
   const candidates=new Set<Triangle>();
   for(let x=Math.floor(upper.minX/this.cell);x<=Math.floor(upper.maxX/this.cell);x++)
    for(let y=Math.floor(upper.minY/this.cell);y<=Math.floor(upper.maxY/this.cell);y++)
     for(const lower of this.grid.get(`${x},${y}`)??[])candidates.add(lower);
   for(const lower of candidates){
    if(lower.maxZ<upper.minZ-reach||lower.minZ>upper.maxZ+1e-5||lower.maxX<upper.minX||lower.minX>upper.maxX||lower.maxY<upper.minY||lower.minY>upper.maxY)continue;this.count();
    for(const [x,y] of overlap(upper,lower)){
     const w=weights(upper,x,y),z=value(lower,weights(lower,x,y),2);
     limits.push({t:Math.max(0,Math.min(1,value(upper,w,3))),clearanceMm:Math.max(0,value(upper,w,2)-z),move:lower.move,layerId:lower.layerId,x,y,z});
    }
   }
  }
  return limits;
 }
}

