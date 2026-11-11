// Historical 3B.1 mesh, retained only for controlled visual regression comparisons.
const BULGE_CALIBRATION={verticalHeightFraction:.45,tangentAspect:1.4};
/** Local, closed, flattened asymmetric lobe; its origin is inside the original bead. */
export function bulgeMesh(event){
 const rows=10,cols=20,positions=new Float32Array((rows+1)*(cols+1)*3),normals=new Float32Array(positions.length),list=[];
 const height=event.heightMm*BULGE_CALIBRATION.verticalHeightFraction;
 for(let j=0;j<=rows;j++)for(let k=0;k<=cols;k++){
  const theta=j/rows*Math.PI,phi=k/cols*Math.PI*2,x=Math.sin(theta)*Math.cos(phi),y=Math.sin(theta)*Math.sin(phi),z=Math.cos(theta),o=(j*(cols+1)+k)*3;
  positions.set([(x-.35)*BULGE_CALIBRATION.tangentAspect,(y*(1+.18*x)+.25),z*height+.05*event.heightMm],o);
 }
 for(let j=0;j<rows;j++)for(let k=0;k<cols;k++){const a=j*(cols+1)+k,b=a+cols+1;list.push(a,b,a+1,a+1,b,b+1);}
 const indices=Uint32Array.from(list);
 const volume=()=>{let v=0;for(let i=0;i<indices.length;i+=3){const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
  v+=positions[a]*(positions[b+1]*positions[c+2]-positions[b+2]*positions[c+1])+positions[a+1]*(positions[b+2]*positions[c]-positions[b]*positions[c+2])+positions[a+2]*(positions[b]*positions[c+1]-positions[b+1]*positions[c]);}return Math.abs(v/6);};
 const scale=Math.sqrt(event.extraVolumeMm3/volume()),t=event.tangent,n=[t[1],-t[0],0];let min=Infinity,max=-Infinity;
 for(let j=0;j<=rows;j++)for(let k=0;k<=cols;k++){
  const o=(j*(cols+1)+k)*3,x=positions[o]*scale,y=positions[o+1]*scale,z=positions[o+2];min=Math.min(min,y);max=Math.max(max,y);
  positions.set([t[0]*x+n[0]*y,t[1]*x+n[1]*y,z],o);
  const theta=j/rows*Math.PI,phi=k/cols*Math.PI*2,nx=Math.sin(theta)*Math.cos(phi)/(BULGE_CALIBRATION.tangentAspect*scale),ny=Math.sin(theta)*Math.sin(phi)/scale,nz=Math.cos(theta)/height,l=Math.hypot(nx,ny,nz);
  normals.set([(t[0]*nx+n[0]*ny)/l,(t[1]*nx+n[1]*ny)/l,nz/l],o);
 }
 return Object.freeze({positions,normals,indices,volumeMm3:volume(),maximumWidthMm:max-min,radialMinMm:min,radialMaxMm:max});
}

