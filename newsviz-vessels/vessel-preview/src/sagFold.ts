import {PRINT} from './config.ts';
import {Quaternion, Vector3} from 'three';
import type {BeadFrame,Move,XYZ} from './toolpath.ts';

type Vertex={command:XYZ; clay:XYZ; width:number};
export function foldFrames(points:XYZ[], progress:number[]):BeadFrame[] {
  const tangents=points.map((point,index)=> index===0 || index===points.length-1
    ? new Vector3(-point[1],point[0],0).normalize()
    : new Vector3(...points[index+1]).sub(new Vector3(...points[index-1])).normalize());
  const start=tangents[0], side=new Vector3(-start.y,start.x,0), rotation=new Quaternion();
  const sides=tangents.map((tangent,index)=>{
    if(index)side.applyQuaternion(rotation.setFromUnitVectors(tangents[index-1],tangent));
    return side.clone();
  });
  const end=tangents.at(-1)!, target=new Vector3(-end.y,end.x,0);
  const roll=Math.atan2(end.dot(side.clone().cross(target)),side.dot(target));
  return sides.map((normal,index)=>{
    normal.applyAxisAngle(tangents[index],roll*progress[index]);
    return {side:normal.toArray(),up:tangents[index].clone().cross(normal).toArray(),
      round:index===0 || index===points.length-1 ? 0 : Math.min(1,5*progress[index],5*(1-progress[index]))};
  });
}
const cells=new WeakMap<Move[],Map<number,Move[]>>();
const cellMm=4;
const cellKey=(col:number,row:number)=>col*4096+row;
export function supportCell(moves:Move[],point:XYZ) {
  let grid=cells.get(moves);
  if(!grid){
    grid=new Map();
    for(const move of moves){
      if(!move.extrude)continue;
      const a=move.beadStart,b=move.beadEnd;
      const pad=(Math.max(move.beadWidthMm,move.beadEndWidthMm??move.beadWidthMm)+PRINT.beadWidthMm)/2;
      for(let col=Math.floor((Math.min(a[0],b[0])-pad)/cellMm);col<=Math.floor((Math.max(a[0],b[0])+pad)/cellMm);col++)
        for(let row=Math.floor((Math.min(a[1],b[1])-pad)/cellMm);row<=Math.floor((Math.max(a[1],b[1])+pad)/cellMm);row++){
          const key=cellKey(col,row);
          if(!grid.has(key))grid.set(key,[]);
          grid.get(key)!.push(move);
        }
    }
    cells.set(moves,grid);
  }
  return grid.get(cellKey(Math.floor(point[0]/cellMm),Math.floor(point[1]/cellMm)))??[];
}
export function contactZ(point:XYZ,history:{moves:Move[];supportMoves?:Move[]}[],drop:number) {
  let floor=Math.max(PRINT.beadHeightMm/2,point[2]-drop);
  for(let layer=history.length-1;layer>=0 && floor<point[2];layer--){
    if((layer+1.5)*PRINT.beadHeightMm<=floor)break;
    for(const move of supportCell(history[layer].supportMoves??history[layer].moves,point)){
      const a=move.beadStart,b=move.beadEnd,dx=b[0]-a[0],dy=b[1]-a[1];
      const along=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
      const width=move.beadWidthMm+along*((move.beadEndWidthMm??move.beadWidthMm)-move.beadWidthMm);
      const separation=((point[0]-a[0]-along*dx)**2+(point[1]-a[1]-along*dy)**2)/((width+PRINT.beadWidthMm)/2)**2;
      if(separation<1)floor=Math.max(floor,a[2]+along*(b[2]-a[2])+PRINT.beadHeightMm*Math.sqrt(1-separation));
    }
  }
  return Math.min(point[2],floor);
}
const distance=(left:XYZ,right:XYZ)=>Math.hypot(left[0]-right[0],left[1]-right[1],left[2]-right[2]);
function length(points:XYZ[]) {
  return points.slice(1).reduce((sum,point,index)=>sum+distance(point,points[index]),0);
}
export function settleFold(vertices:Vertex[], progress:number[], history:{moves:Move[];supportMoves?:Move[]}[], strength:number,
  slack:number, maxDrop:number, anchors:readonly [boolean,boolean]=[true,true]) {
  const command=vertices.map(vertex=>vertex.command), nozzleLength=length(command);
  const span=distance(command[0], command.at(-1)!);
  const fall=Math.min(maxDrop,span*0.48)*strength;
  const clearance=command.map(p=>p[2]-contactZ(p,history,Math.max(1,span,maxDrop)));
  const unsupported=clearance.map(gap=>gap>0.25*PRINT.beadHeightMm);
  const active=anchors.every(Boolean) && unsupported.some(Boolean);
  const arc=[0];
  for(let i=1;i<command.length;i++)arc.push(arc[i-1]+distance(command[i],command[i-1]));
  const free=arc.map(a=>4*(a/nozzleLength)*(1-a/nozzleLength)*fall);
  // A tensioned strand hangs in a parabola between contacts. The lower convex hull
  // of the obstacle residual pins it to any intervening load-bearing strand.
  const residual=clearance.map((gap,i)=>Math.min(0,gap-free[i]));
  const hull:number[]=[];
  for(let i=0;i<arc.length;i++){
    while(hull.length>=2){
      const a=hull[hull.length-2], b=hull[hull.length-1];
      if((residual[b]-residual[a])*(arc[i]-arc[b])<(residual[i]-residual[b])*(arc[b]-arc[a]))break;
      hull.pop();
    }
    hull.push(i);
  }
  const drops=arc.map(()=>0);
  if(active)for(let k=1;k<hull.length;k++){
    const a=hull[k-1],b=hull[k];
    for(let i=a;i<=b;i++){
      const t=(arc[i]-arc[a])/(arc[b]-arc[a]);
      drops[i]=Math.max(0,Math.min(clearance[i],free[i]+residual[a]*(1-t)+residual[b]*t));
    }
  }
  // Request a finite surplus for a backed cast with free span, before predicting settlement.
  const weights=progress.map((u,i)=>4*u*(1-u)*Math.min(1,clearance[i]/PRINT.beadHeightMm));
  const dose=active?0.20*(-Math.expm1(-slack/0.20))*strength*Math.max(...weights):0;
  const budget=nozzleLength*(1+dose);
  let deposited=command;
  if(dose>0 && fall>0){
    const fallen=(scale:number)=>command.map(([x,y,z],i):XYZ=>[x,y,z-scale*drops[i]]);
    const settled=fallen(1);
    if(length(settled)<=budget)deposited=settled;
    else {
      let low=0,high=1;
      for(let i=0;i<10;i++){
        const mid=(low+high)/2, trial=fallen(mid);
        if(length(trial)<=budget){low=mid;deposited=trial;} else high=mid;
      }
    }
  }
  const actualLength=length(deposited);
  const weighted=deposited.slice(1).reduce((sum,point,i)=>sum+distance(point,deposited[i])*(weights[i]+weights[i+1])/2,0);
  const surplus=weighted>0?Math.max(0,(budget-actualLength)/weighted):0;
  vertices.forEach((vertex,i)=>{
    vertex.clay=deposited[i];
    vertex.width*=1+weights[i]*surplus;
  });
  return {nozzleLength,budget,actualLength,anchors,unsupported,peakDropMm:Math.max(...vertices.map(v=>v.command[2]-v.clay[2]))};
}
