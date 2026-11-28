import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {comparisonConfig,studyLabels} from './comparisonPresets.ts';
import type {Study} from './comparisonPresets.ts';
import {ClayScene} from './ClayScene.tsx';
import {FLOATS_PER_MOVE, SIDES, writeBead} from './beadGeometry.ts';
import {FORM} from './config.ts';
import {sampleToolpath} from './toolpath.ts';
import {mapAnnualVase,readDataset} from './annualMapping.ts';
import type {Behavior} from './annualMapping.ts';
import example from './annualExample.json';
import BehaviourControls from './BehaviourControls.tsx';
import SaggingInspector from './SaggingInspector.tsx';
import {defaultConfig,validateConfig,storageKey} from './behaviourConfig.ts';
import type {Failure, Mode} from './behaviourConfig.ts';
import './styles.css';
import './annual.css';

const base = import.meta.env.BASE_URL;
const legend: Record<Behavior, [string, string]> = {
  stable: ['Stable', '#728273'], gaps: ['Gaps', '#ad6745'], buldges: ['Bulging', '#aa8435'],
  misalignment: ['Misalignment', '#4e7795'], sagging: ['Sagging', '#8b6583'],
};
const pad = (value: number) => String(value).padStart(2, '0');
type Plan = ReturnType<typeof mapAnnualVase>;

function LayerInspector({plan, layerId, select,noDrop,setNoDrop}: {plan: Plan; layerId: number; select: (id: number) => void; noDrop:boolean;setNoDrop:(value:boolean)=>void}) {
  const layer = plan.layers[layerId - 1], band = layer.band;
  const outside = 1 - layer.events.reduce((sum, event) => sum + event.end - event.start, 0) / layer.perimeter;
  const section = useMemo(()=>{
    if(layerId>FORM.bottomLayers+1)return '';
    const positions=new Float32Array(FLOATS_PER_MOVE), normals=new Float32Array(FLOATS_PER_MOVE);
    return layer.renderMoves.filter(m=>m.extrude && (m.kind==='infill' || m.kind==='deposition')).map(move=>{
      writeBead(move,1,positions,normals);
      // Project both lateral edges of the deposited bead into the layer view.
      const xy=(vertex:number)=>positions[3*vertex]+','+(-positions[3*vertex+1]);
      return 'M'+xy(0)+'L'+xy(SIDES)+'L'+xy(SIDES+SIDES/2)+'L'+xy(SIDES/2)+'Z';
    }).join(' ');
  },[layer,layerId]);
  return <section className="annual-inspector" aria-label="Layer debug visualization">
    <span className="annual-kicker">Unwrapped baseline / arc length</span>
    <h2>Layer map</h2><p>Each row shows the perimeter, cut at its seam. Color marks the active event arcs. Pale sections lie outside those arcs.</p>
    <div className="annual-axis"><span>SEAM · 0%</span><span>50%</span><span>100%</span></div>
    <svg className="annual-map" viewBox={`0 0 100 ${plan.layers.length}`} preserveAspectRatio="none" role="img" aria-label="Event locations by layer, rim at top and base at bottom" onClick={event => {
      const box = event.currentTarget.getBoundingClientRect(); select(Math.max(1, Math.min(plan.layers.length, plan.layers.length - Math.floor((event.clientY - box.top) / box.height * plan.layers.length))));
    }}>
      {plan.layers.map(row => <g key={row.layerId} transform={`translate(0 ${plan.layers.length - row.layerId})`}>
        {row.events.flatMap(event => (event.end <= row.perimeter ? [[event.start,event.end]] : [[event.start,row.perimeter],[0,event.end-row.perimeter]]).map(([start,end]) => <rect key={start} x={100*start/row.perimeter} width={100*(end-start)/row.perimeter} height="1" fill={legend[row.band.behavior][1]}/>))}
        {row.layerId === row.band.first && <path d="M0 1H100" stroke="#5c604c" strokeWidth="0.3"/>}
      </g>)}
      <rect x="0" y={plan.layers.length - layerId} width="100" height="1" fill="none" stroke="#23291f" strokeWidth="0.65"/>
    </svg>
    <label className="annual-seek">Inspect layer <b>{layerId} / {plan.layers.length}</b><input type="range" min="1" max={plan.layers.length} value={layerId} onChange={event => select(+event.target.value)}/></label>
    {layerId <= FORM.bottomLayers+1 && <figure style={{margin:0}}>
      <svg viewBox="-52 -52 104 104" height="145" role="img" aria-label={'Deposited section of layer '+layerId}>
        <path fill="#ad6745" d={section}/>
      </svg><figcaption>Layer {layerId} · {layerId<=FORM.bottomLayers?'Solid base':'Hollow wall'} · deposited section</figcaption>
    </figure>}
    <strong>{band.id} · {legend[band.behavior][0]}</strong>
    <p>{layer.events.length} of {plan.rings[layerId-1].cellCount} scaffold cells active on this course.</p>
    <dl className="annual-stats"><div><dt>Events on layer</dt><dd>{layer.events.length}</dd></div><div><dt>Amplitude</dt><dd>{band.amplitude.toFixed(2)}</dd></div><div><dt>Outside events</dt><dd>{(100 * outside).toFixed(0)}%</dd></div></dl>
    <small>{layer.events.length ? 'Event arcs: ' + layer.events.map(event => `${event.start.toFixed(1)}–${(event.end % layer.perimeter).toFixed(1)} mm`).join(' · ') : 'Continuous perimeter · no failure events.'}</small>
    {band.behavior==='sagging' && layer.events.length>0 && <SaggingInspector source={band.id} ring={plan.rings[layerId-1]} layerId={layerId} path={plan.path} noDrop={noDrop} setNoDrop={setNoDrop}/>}
  </section>;
}

export default function AnnualVase() {
  const [loaded]=useState(()=>{
    try {const saved=localStorage.getItem(storageKey);return {config:saved?validateConfig(JSON.parse(saved)):defaultConfig(),warning:''};}
    catch(reason){return {config:defaultConfig(),warning:'Saved configuration unavailable: '+(reason as Error).message};}
  });
  const [config,setConfig]=useState(loaded.config), [warning,setWarning]=useState(loaded.warning);
  const [noDrop,setNoDrop]=useState(false);
  const [study,setStudy]=useState<Study|''>('');
  const activeConfig=useMemo(()=>study?comparisonConfig(study):config,[study,config]);
  const {mode,behaviour:kind}=config.preview;
  const switchMode=(mode:Mode)=>setConfig(current=>({...current,preview:{...current.preview,mode}}));
  const setKind=(behaviour:Failure)=>setConfig(current=>current.preview.behaviour===behaviour?current:{...current,preview:{...current.preview,behaviour}});
  const [data,setData]=useState<unknown>(example);
  const [plan,setPlan]=useState(()=>mapAnnualVase(example,loaded.config,mode==='Manual'?kind:undefined)), last=useRef(plan);
  const [dataset, setDataset] = useState(JSON.stringify(example, null, 2));
  const [error, setError] = useState(''), [demo, setDemo] = useState(true), [debug, setDebug] = useState(false);
  const [layerId, setLayer] = useState<number>(()=>plan.bands.at(-1)?.behavior===kind ? FORM.layerCount : plan.bands.find(band=>band.behavior===kind)?.first??FORM.layerCount);
  const manual=!study && mode==='Manual'?kind:undefined;
  useLayoutEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      const next=mapAnnualVase(data,noDrop?{...activeConfig,simulationSettings:{...activeConfig.simulationSettings,maxDropMm:0}}:activeConfig,manual,last.current);last.current=next;setPlan(next);
    });
    return ()=>cancelAnimationFrame(frame);
  },[data,activeConfig,manual,noDrop]);
  useEffect(()=>{
    if(config===loaded.config)return;
    try{localStorage.setItem(storageKey,JSON.stringify(config));setWarning('');}
    catch{setWarning('Local save unavailable. Export the configuration to keep it.');}
  },[config,loaded]);
  function select(id:number){
    setLayer(id);const behavior=plan.layers[id-1].band.behavior;
    if(!study && behavior!=='stable')setKind(behavior);
  }
  function choose(value:Failure){
    setKind(value);
    if(plan.layers[layerId-1].band.behavior!==value){
      const band=plan.bands.find(item=>item.behavior===value);if(band)setLayer(Math.floor((band.first+band.last)/2));
    }
  }
  const sample = useMemo(() => sampleToolpath(plan.path, plan.path.durationS), [plan.path]);
  const eventCount = plan.layers.reduce((sum, layer) => sum + layer.events.length, 0);
  const casts=plan.rings.flatMap(r=>r.replacements);
  const unanchored=casts.filter(c=>!c.anchors.every(Boolean)).length;
  const uncertainShifts=plan.rings.filter(r=>r.shiftUnverified).length;
  useEffect(() => {document.title = `${plan.data.country} ${plan.data.year} · Annual vase`;}, [plan.data]);
  function apply() {
    try {
      const input = JSON.parse(dataset);
      const next = readDataset(input, FORM.layerCount - FORM.bottomLayers);
      setData(next); setDemo(JSON.stringify(input) === JSON.stringify(example)); setError('');
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'Invalid JSON.');}
  }
  return <div className="memory-experience annual">
    <header className="mx-header"><a href={base} className="mx-brand"><span className="mx-mark">g<span>f</span></span><span>GRAMMAR<br/>OF FAILURE</span></a>
      <nav aria-label="Main navigation"><a href={base}>Vessel</a><a href={base + 'annual/'} aria-current="page">Annual vase</a><a href={base + 'calibration/'}>Calibration</a><a href={base + 'recruitment/'}>Recruitment</a></nav><span className="mx-edition">PROTOTYPE C / AI ANXIETY <i/></span></header>
    <main><section className="mx-intro"><div><span className="annual-kicker">Material atlas &nbsp; / &nbsp; Annual specimen</span>
      <h1>{plan.data.country} <em>/ {plan.data.year}</em></h1><p>One year of AI anxiety, read from base to rim.</p></div>
      <div className="annual-origin">{demo ? 'Synthetic example' : 'User-supplied scores'}<br/><span>Single-wall clay study</span></div></section>
      <div className="annual-workbench"><section className="annual-preview" aria-label="Annual vessel preview">
        <header className="annual-bar"><span className="annual-kicker">01 / Specimen</span><div className="annual-switch"><button aria-pressed={!debug} onClick={() => setDebug(false)}>Full vase</button><button aria-pressed={debug} onClick={() => setDebug(true)}>Layer debug</button></div></header>
        <div className="annual-stage"><div className="annual-scene" style={{visibility: debug ? 'hidden' : 'visible'}} aria-hidden={debug}>
          <ClayScene layers={plan.layers} path={plan.path} initialSample={sample} toolpathVisible={false} showNozzle={false}/>
          <div className="annual-scene-foot"><span>Double-click clay to identify its source</span><span>{noDrop?'Deposited clay · droop disabled':'Deposited clay only'}</span></div>
        </div>{debug && <LayerInspector plan={plan} layerId={layerId} select={select} noDrop={noDrop} setNoDrop={setNoDrop}/>}</div>
      </section><aside className="annual-ledger"><span className="annual-kicker">02 / Vertical assignment</span><h2>Band register</h2>
        <p>Layers 1–3 form the stable base. Highest score at the rim. Select an item to inspect its middle layer.</p>
        <div className="annual-axis"><span>RIM ↓ BASE</span><span>SCORE</span></div>
        <div className="annual-bands">{plan.bands.map((band, index) => <button key={band.id} className="annual-band" data-related={!study && band.behavior===kind} aria-pressed={debug && index === plan.layers[layerId - 1].bandIndex} onClick={() => {select(Math.floor((band.first + band.last) / 2)); setDebug(true);}}>
          <span className="annual-number">{pad(index + 1)}</span><span><strong>{band.id}</strong><small><i style={{background: legend[band.behavior][1]}}/>{legend[band.behavior][0]} · Layers {band.first}–{band.last}</small></span><b>{band.score}</b>
        </button>).reverse()}</div><dl className="annual-stats"><div><dt>Bands</dt><dd>{plan.bands.length}</dd></div><div><dt>Layers</dt><dd>{plan.layers.length}</dd></div><div><dt>Local events</dt><dd>{eventCount}</dd></div></dl>
        {casts.length>0 && <p>{casts.filter(c=>c.peakDropMm>=0.25).length} of {casts.length} sagging windows settle at least 0.25 mm. {unanchored>0 && `${unanchored} lack two supported anchors and remain unresolved.`}</p>}
        {uncertainShifts>0 && <p>{uncertainShifts} shifted courses have unresolved support.</p>}
        <label className="study-select">Comparison preset <select value={study} onChange={e=>{setStudy(e.target.value as Study|'');setNoDrop(false);}}>
          <option value="">Current controls</option>{Object.entries(studyLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}
        </select></label>
        {!study && <BehaviourControls {...{config,mode,kind,choose,switchMode,plan,layerId}} update={next=>{if(next.preview.behaviour!==kind){const band=plan.bands.find(item=>item.behavior===next.preview.behaviour);if(band)setLayer(Math.floor((band.first+band.last)/2));} setConfig(next);}}/>}
        {warning && <p role="alert">{warning}</p>}
      </aside></div>
      <details className="annual-input"><summary>03 / Edit annual dataset</summary><p>One country and year, 1–{FORM.layerCount - FORM.bottomLayers} unique items. At a cutoff the higher range starts (0.40 = bulging). Apply updates the preview locally.</p>
        <div><label>Annual dataset (JSON)<textarea value={dataset} onChange={event => setDataset(event.target.value)} spellCheck={false}/></label>
        </div>
        <button onClick={apply}>Apply to vase</button>{error && <p role="alert">{error} The previous vase is unchanged.</p>}
      </details><footer><span>GRAMMAR OF FAILURE / MATERIAL ATLAS</span><span>Simulated deposition · not a machine toolpath</span></footer>
    </main></div>;
}
