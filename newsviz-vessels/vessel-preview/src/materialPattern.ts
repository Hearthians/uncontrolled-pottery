import type {BeadFrame,XYZ} from './toolpath.ts';

export const DEFAULT_COHERENCE = 8;

// One site per repeat is active. All repeats advance to the next cell together.
export function staggeredCourse(layer:number,score:number,coverage:number,seed:number,coherence:number) {
  const within=score*5-Math.min(4,Math.floor(score*5));
  const severity=(score+within)/2;
  const cells=Math.min(2+Number(severity<0.7)+Number(severity<0.4),Math.floor(100/Math.max(1,coverage)));
  const hold=1+Math.round(2*severity);
  const period=Math.max(hold+2,Math.round(coherence*(1.22-0.52*severity)));
  const row=layer%period;
  const beat=Math.floor(layer/period)*(period-hold+1)+Math.max(0,row-hold+1);
  const firstLayer=row<hold?layer-row:layer;
  const lane=(beat+seed%cells)%cells;
  const drift=firstLayer*(0.016+0.045*severity)*DEFAULT_COHERENCE/coherence;
  return {cells,lane,hold,period,firstLayer,releases:row>=hold-1,within,centre:(lane+0.5+drift)/cells};
}

// Sites retain a slowly moving emphasis as their active cells change places.
export function siteStrength(site:number,count:number,layer:number,seed:number,coherence:number,variation:number) {
  const angle=2*Math.PI*site/count*Math.max(1,Math.round(count/4));
  const crest=(1+Math.cos(angle+(seed%65521)*0.619+0.72*layer/coherence))/2;
  return 1-variation*(1-crest);
}

// Turn the flat bead section along the offset path. Limit its rotation over one bead radius
// so the inside edge continues forward at a sharp shoulder, then match the nominal exit.
export function registrationFrames(points:XYZ[],width:number):BeadFrame[] {
  const limit=points.map(([x,y],i)=>i===0?0:
    Math.max(0,points[i-1][0]*y-points[i-1][1]*x)/(Math.hypot(x,y)*width));
  const angles=points.map(([x,y],i)=>{
    if(!i || i===points.length-1)return 0;
    const dx=points[i+1][0]-points[i-1][0],dy=points[i+1][1]-points[i-1][1];
    return Math.atan2(-x*dx-y*dy,x*dy-y*dx);
  });
  const bounded=(a:number,b:number,step:number)=>Math.max(b-step,Math.min(b+step,a));
  for(let i=1;i<angles.length;i++)angles[i]=bounded(angles[i],angles[i-1],limit[i]);
  angles[angles.length-1]=0;
  for(let i=angles.length-2;i>=0;i--)angles[i]=bounded(angles[i],angles[i+1],limit[i+1]);
  return points.map(([x,y],i)=>{
    const c=Math.cos(angles[i]),s=Math.sin(angles[i]),r=Math.hypot(x,y);
    return {side:[(-x*c+y*s)/r,(-x*s-y*c)/r,0],up:[0,0,1],round:0};
  });
}
