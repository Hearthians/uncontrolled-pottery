import {useRef, useState} from 'react';
import {defaultConfig, failures, FOLD_DEFAULTS, magnitude, names, UI_LIMITS, validateConfig} from './behaviourConfig.ts';
import type {Config, Failure, Mode, Params} from './behaviourConfig.ts';
import {DEFAULT_COHERENCE} from './materialPattern.ts';
import type {mapAnnualVase} from './annualMapping.ts';

type Props={config:Config; update:(next:Config)=>void; kind:Failure; choose:(kind:Failure)=>void; mode:Mode; switchMode:(mode:Mode)=>void;
  plan:ReturnType<typeof mapAnnualVase>; layerId:number};
function Control({label,unit,value,limits,disabled,onChange}:{label:string;unit:string;value:number;limits:readonly number[];disabled:boolean;onChange:(value:number)=>void}) {
  const [draft,setDraft]=useState<string|null>(null);
  const [min,max,step]=limits;
  const common={min,max,step,disabled};
  return <label className="behaviour-field"><span>{label} <small>{unit}</small></span>
    <input {...common} aria-label={label+' slider'} type="range" value={value} onChange={event=>onChange(event.target.valueAsNumber)}/>
    <input {...common} aria-label={label+' value'} type="number" value={draft??Number(value.toFixed(4))} onBlur={()=>setDraft(null)}
      onChange={event=>{setDraft(event.target.value);const num=event.target.valueAsNumber;
        if(Number.isFinite(num) && num>=min && num<=max && (step!==1||Number.isInteger(num))) onChange(num);}}/></label>;
}
export default function BehaviourControls({config,update,kind,choose,mode,switchMode,plan,layerId}:Props) {
  const [message,setMessage]=useState(''), file=useRef<HTMLInputElement>(null);
  const row=plan.layers[layerId-1], band=row.band, matching=plan.bands.some(item=>item.behavior===kind);
  const manual=mode==='Manual', preset=config.manualPresets[kind], range=config.mappingRanges[kind], pattern=config.patternSettings[kind];
  const params=manual?preset:band.behavior===kind?band:range.low;
  const locked=!manual, [label,unit]=magnitude[kind];
  function change(key:keyof Params,value:number) {
    setMessage('');update({...config,manualPresets:{...config.manualPresets,[kind]:{...preset,[key]:value}}});
  }
  function save(endpoint:'low'|'high') {
    try {
      const next=validateConfig({...config,mappingRanges:{...config.mappingRanges,[kind]:{...range,[endpoint]:{...preset}}}});
      update(next);setMessage('Saved '+names[kind]+' mapping '+endpoint+'.');
    } catch(reason){setMessage((reason as Error).message);}
  }
  function exportFile(){
    const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='annual-behaviour.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const fields=([{key:'eventCount',label:'Event count',unit:'events / loop',limits:UI_LIMITS.eventCount},
    {key:'coverage',label:'Coverage',unit:'%',limits:UI_LIMITS.coverage},{key:'amplitude',label,unit,limits:UI_LIMITS[kind]}] as const);
  return <details className="behaviour-controls" open><summary>Behaviour Controls</summary>
    <div className="annual-switch">{(['Manual','Data-driven'] as const).map(option=><button key={option} aria-pressed={mode===option} onClick={()=>{switchMode(option);setMessage('');}}>{option}</button>)}</div>
    <label>Behaviour <select aria-label="Behaviour" value={kind} onChange={event=>{choose(event.target.value as Failure);setMessage('');}}>{failures.map(item=><option key={item} value={item}>{names[item]}</option>)}</select></label>
    <strong>{manual?'Manual preview':'Data-driven preview'}</strong>
    <p>Selected layer {layerId} · {band.id} · score {band.score} · {band.behavior==='stable'?'Stable':names[band.behavior]}</p>
    {!matching && <p>No {names[kind]} bands in this dataset.</p>}
    {(!manual && band.behavior!==kind) && <p>{row.events.length} active events on the selected layer · {band.coverage.toFixed(1)}% coverage{band.behavior!=='stable' && ' · '+magnitude[band.behavior][0]+' '+Number(band.amplitude.toFixed(3))+' '+magnitude[band.behavior][1]}. Controls show the saved low endpoint for reference.</p>}
    {fields.map(field=><Control key={kind+mode+field.key} label={field.label} unit={field.unit} limits={field.limits} value={params[field.key]} disabled={locked} onChange={value=>change(field.key,value)}/>)}
    {kind==='buldges' && <p>Width follows the relative flow request. Outward spread is an uncalibrated material prediction.</p>}
    <small>Event count sets the repeating groups around a loop. One cell per group activates at a time. Coverage sets the working length inside those cells.</small>
    <p>Longest event here · {band.behavior===kind && row.events.length ? (Math.max(...row.events.map(e=>e.end-e.start)).toFixed(2)+' mm'):'— (inactive)'}</p>
    <details><summary>Advanced layout</summary>
      <Control label="Motif coherence" unit="layers · stagger timing" value={config.simulationSettings.coherenceLayers??DEFAULT_COHERENCE} limits={[4,16,1]} disabled={locked}
        onChange={coherenceLayers=>update({...config,simulationSettings:{...config.simulationSettings,coherenceLayers}})}/><Control label="Phase" unit="°" value={pattern.phase} limits={UI_LIMITS.phase} disabled={locked}
      onChange={phase=>update({...config,patternSettings:{...config.patternSettings,[kind]:{...pattern,phase}}})}/>
      {kind==='sagging' && (['slack','variation'] as const).map(key=><Control key={key}
        label={key==='slack'?'Extra filament at full strength':'Rhythm variation'} unit={key==='slack'?'input ratio · modeled feed saturates at +20%':'ratio'} limits={[0,key==='slack'?1.5:1,0.01]}
        value={config.patternSettings.sagging[key]??FOLD_DEFAULTS[key]} disabled={locked}
        onChange={value=>update({...config,patternSettings:{...config.patternSettings,sagging:{...config.patternSettings.sagging,[key]:value}}})}/>)}
      <small>Fixed across scores in both modes.</small></details>
    {kind==='sagging' && <details><summary>Material simulation</summary>
      <Control label="Maximum material drop" unit="mm" limits={[0,16,0.1]} value={config.simulationSettings.maxDropMm} disabled={locked}
        onChange={maxDropMm=>update({...config,simulationSettings:{...config.simulationSettings,maxDropMm}})}/>
      <small>Simulation-only. This global cap applies to every sagging score.</small></details>}
    <table><caption>Mapping endpoints</caption><thead><tr><th>Parameter</th><th>Low</th><th>High</th></tr></thead>
      <tbody>{fields.map(field=><tr key={field.key}><th>{field.label} ({field.unit})</th><td>{+range.low[field.key].toFixed(3)}</td><td>{+range.high[field.key].toFixed(3)}</td></tr>)}</tbody></table>
    <div className="behaviour-actions"><button disabled={locked} onClick={()=>{const defaults=defaultConfig();update({...config,manualPresets:{...config.manualPresets,[kind]:defaults.manualPresets[kind]},patternSettings:{...config.patternSettings,[kind]:defaults.patternSettings[kind]}});setMessage('Manual preset and phase reset. Saved endpoints unchanged.');}}>Reset behaviour</button>
      <button disabled={locked} onClick={()=>save('low')}>Save as mapping low</button><button disabled={locked} onClick={()=>save('high')}>Save as mapping high</button>
      <button onClick={exportFile}>Export configuration</button><button onClick={()=>file.current?.click()}>Import configuration</button></div>
    <input type="file" ref={file} hidden accept=".json,application/json" aria-label="Import configuration file" onChange={async event=>{
      const selected=event.target.files?.[0];event.target.value='';if(!selected)return;
      try {if(selected.size>65536) throw Error('Configuration exceeds 64 KiB.'); const next=validateConfig(JSON.parse(await selected.text()));update(next);setMessage('Configuration imported.');}
      catch(reason){setMessage('Import rejected: '+(reason as Error).message);}
    }}/>
    <p role="status">{message}</p><small>Visual-only settings, shared across countries and years. Sagging uses approximate support, not machine calibration.</small>
  </details>;
}
