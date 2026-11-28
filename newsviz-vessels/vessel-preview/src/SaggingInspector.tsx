import {useMemo,useState} from 'react';
import {isolatedSagMoves,saggingTrace} from './annualMapping.ts';
import {ClayScene} from './ClayScene.tsx';
import {sampleToolpath} from './toolpath.ts';
import type {Toolpath,XYZ} from './toolpath.ts';

const traces = {base:'Base path', command:'Replaced event path', deposited:'Final deposited path'} as const;
type Trace = keyof typeof traces;
const order:Trace[] = ['deposited','base','command'];
const colors = {base:'#615c50', command:'#754673', deposited:'#317568'};

export default function SaggingInspector({source,ring,layerId,path,noDrop,setNoDrop}:{source:string;ring:Parameters<typeof saggingTrace>[0];layerId:number;path:Toolpath;noDrop:boolean;setNoDrop:(value:boolean)=>void}) {
  const [selected,setSelected]=useState(0), [show,setShow]=useState({base:false,command:false,deposited:true});
  const [guide,setGuide]=useState(false);
  const index=Math.min(selected,ring.replacements.length-1), paths=saggingTrace(ring,layerId,index);
  const entry=paths.base[0], exit=paths.base.at(-1)!;
  const fold=ring.replacements[index];
  const rows=useMemo(()=>[{renderMoves:isolatedSagMoves(ring,index)}],[ring,index]);
  const sample=useMemo(()=>sampleToolpath(path,path.durationS),[path]);
  const dx=exit[0]-entry[0], dy=exit[1]-entry[1], length=Math.hypot(dx,dy);
  function plot(elevation:boolean) {
    const project=(point:XYZ)=>{
      const horizontal=point[0]-entry[0], vertical=point[1]-entry[1];
      return [(horizontal*dx+vertical*dy)/length,elevation ? entry[2]-point[2] : (dx*vertical-dy*horizontal)/length];
    };
    const points=Object.values(paths).flat().map(project);
    const xs=points.map(point=>point[0]), ys=points.map(point=>point[1]);
    const left=Math.min(...xs), right=Math.max(...xs), top=Math.min(...ys), bottom=Math.max(...ys);
    const scale=Math.min(290/(right-left),76/Math.max(0.001,bottom-top));
    const pixel=(point:XYZ)=>{
      const [along,height]=project(point);
      return [160+(along-(left+right)/2)*scale,54+(height-(top+bottom)/2)*scale];
    };
    const title=elevation?'Side view · nozzle and clay Z':'Plan view · XY';
    return <figure><figcaption>{title}</figcaption><svg viewBox="0 0 320 112" role="img" aria-label={title}>
      {elevation && paths.command.slice(1).map((p,i)=>{
        if(!fold.unsupported[i] && !fold.unsupported[i+1])return null;
        const [x1,y1]=pixel(paths.command[i]),[x2,y2]=pixel(p);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d18128" strokeWidth="8" opacity=".55"/>;
      })}
      {order.filter(key=>show[key]).map(key=><polyline key={key} data-trace={key} data-layer-id={layerId} data-event-id={index+1} data-source-type={key} fill="none" stroke={colors[key]}
        strokeWidth={key==='deposited'?4:1.7} strokeDasharray={key==='base'?'3 3':key==='command'?'7 3':undefined}
        points={paths[key].map(point=>pixel(point).join(',')).join(' ')}/>)}
      {([entry,exit] as const).map((point,idx)=>{
        const [x,y]=pixel(point), label=idx?'B':'A';
        return <g key={label}><circle cx={x} cy={y} r="3" fill="#252a24"/><text x={x} y={y+14} textAnchor="middle">{label}</text></g>;
      })}
    </svg></figure>;
  }
  return <section className="sag-inspector" aria-label="Sagging path inspection">
    <h3>Sagging replacement</h3><label>Inspect event <select aria-label="Inspect sagging event" value={index} onChange={event=>setSelected(+event.target.value)}>
      {ring.events.map((event,idx)=><option key={idx} value={idx}>{idx+1} / {ring.events.length} · {event.start.toFixed(1)}–{(event.end%ring.perimeter).toFixed(1)} mm</option>)}
    </select></label>
    <p>{source} · layer {layerId}, site {ring.events[index].site}, cell {ring.events[index].cell}. Extruding cast with {Math.round(100*(fold.budget/fold.nozzleLength-1))}% additional modeled feed. Level nozzle route: {fold.nozzleLength.toFixed(1)} mm. Filament budget: {fold.budget.toFixed(1)} mm. Settled centreline: {fold.actualLength.toFixed(1)} mm. {fold.anchors.every(Boolean)?'Both anchors have estimated contact.':'Unresolved anchor support. The level deposit is shown and settling is withheld.'}</p>
    <div className="isolated-sag"><ClayScene isolated layers={rows} path={path} initialSample={sample} toolpathVisible={guide} showNozzle={false}/></div>
    <label><input type="checkbox" checked={guide} onChange={event=>setGuide(event.target.checked)}/> Nozzle path (guide only)</label>{' '}
    <label><input type="checkbox" checked={noDrop} onChange={event=>setNoDrop(event.target.checked)}/> Disable droop (diagnostic, both previews)</label>
    <fieldset><legend>Debug traces</legend>{(Object.keys(traces) as Trace[]).map(key=><label key={key} style={{color:colors[key]}}>
      <input type="checkbox" checked={show[key]} onChange={event=>setShow({...show,[key]:event.target.checked})}/>{traces[key]}
    </label>)}</fieldset>
    <p>Amber on the side view marks estimated support clearance above 0.25 mm along the cast.</p>
    <div className="sag-plots">{plot(false)}{plot(true)}</div>
    <small>A = entry · B = exit. The base arc is a reference, not clay. Extrusion stays on; nozzle Z = {paths.command[0][2].toFixed(2)} mm. Estimated maximum drop = {(entry[2]-Math.min(...paths.deposited.map(point=>point[2]))).toFixed(2)} mm.</small>
  </section>;
}
