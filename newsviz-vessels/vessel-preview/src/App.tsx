import {useEffect, useMemo, useRef, useState} from 'react';
import {ClayScene} from './ClayScene.tsx';
import type {SceneHandle} from './ClayScene.tsx';
import {generateGeometry} from './geometry.ts';
import {generateToolpath} from './toolpath.ts';
import {validateToolpath} from './validation.ts';
import {Playback} from './playback.ts';
import {FORM} from './config.ts';
import {concernExperiments} from './experiments.ts';
import {planConcernGaps} from './disturbance.ts';
import {supportDiagnostics} from './support.ts';
import './styles.css';

const base = import.meta.env.BASE_URL;
const baseline = generateToolpath(generateGeometry());
const bounds = validateToolpath(baseline);
const experiments = concernExperiments();
const PREVIEW_SPEED = 60;

export default function App() {
  const [experimentId, setExperimentId] = useState(experiments[0].data.datasetId);
  const experiment = useMemo(() => planConcernGaps(baseline, experiments.find(e => e.data.datasetId === experimentId)!.data), [experimentId]);
  const path = experiment.path;
  const diagnostics = useMemo(() => supportDiagnostics(path), [path]);
  const playback = useMemo(() => {const p = new Playback(path); p.seekLayer(FORM.layerCount); return p;}, [path]);
  const initialSample = useMemo(() => playback.sample(), [playback]);
  const [currentLayer, setCurrentLayer] = useState<number>(FORM.layerCount);
  const [extruding, setExtruding] = useState(false);
  const layerPlan = experiment.layers[currentLayer - 1], support = diagnostics[currentLayer - 1];
  const scene = useRef<SceneHandle>(null);
  const [playing, setPlaying] = useState(false), [layer, setLayer] = useState<number>(FORM.layerCount);
  const [toolpath, setToolpath] = useState(false);
  const sync = () => {scene.current?.update(playback.sample()); setLayer(playback.completedLayers()); setPlaying(playback.playing); const m = path.moves[playback.sample().moveIndex]; setCurrentLayer(m.layerId); setExtruding(m.extrude);};
  useEffect(() => {
    let frame = 0, previous = performance.now(), lastUpdate = 0;
    const tick = (now: number) => {
      const sample = playback.advance(Math.min((now - previous) / 1000, 0.1) * PREVIEW_SPEED); previous = now;
      scene.current?.update(sample);
      if (now - lastUpdate > 100) {setLayer(playback.completedLayers()); setPlaying(playback.playing); const m = path.moves[sample.moveIndex]; setCurrentLayer(m.layerId); setExtruding(m.extrude); lastUpdate = now;}
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playback]);
  return <div className="memory-experience">
    <header className="mx-header"><a href={base} className="mx-brand"><span className="mx-mark">g<span>f</span></span><span>GRAMMAR<br/>OF FAILURE</span></a>
      <nav aria-label="Main navigation"><a href={base} aria-current="page">Vessel</a><a href={base + 'annual/'}>Annual vase</a><a href={base + 'calibration/'}>Calibration</a><a href={base + 'recruitment/'}>Recruitment</a></nav><span className="mx-edition">PROTOTYPE C / AI CONCERN <i/></span></header>
    <main>
      <section className="mx-intro" id="create"><div><span className="mx-eyebrow">FIXED GEOMETRY</span><h1>Twisted <em>Vessel</em></h1><p>One fixed vessel. Concern changes commanded extrusion; the nozzle follows the same path.</p></div>
</section>
      <div className="mx-workbench" id="baseline">
        <aside className="mx-form-panel"><div className="mx-section-head"><span>01 / BASE GEOMETRY</span><span>□</span></div><h2>Geometry</h2>
          <div className="mx-seed"><span>FIXED VESSEL SEED</span><strong>{FORM.seed}</strong><small>Single wall · Twisted · Open top</small></div>
          <dl className="mx-specs"><div><dt>Geometry height</dt><dd>{FORM.heightMm} <small>mm</small></dd></div><div><dt>Outer diameter</dt><dd>{bounds.diameterMm.toFixed(1)} <small>mm</small></dd></div><div><dt>Layers</dt><dd>{FORM.layerCount}</dd></div><div><dt>Layer height</dt><dd>{FORM.layerHeightMm.toFixed(1)} <small>mm</small></dd></div><div><dt>Bead width</dt><dd>2 <small>mm</small></dd></div><div><dt>Twist</dt><dd>{Math.round(FORM.twistRadians * 180 / Math.PI)}<small>°</small></dd></div></dl>
          <div className="mx-envelope"><span>✓</span><span>Within Ø120 × H180 mm<br/><small>Envelope includes deposited width.</small></span></div>
          <div className="mx-bottom-note">FIXED FORM / REPEATABLE BASELINE<br/><span>Geometry is independent of concern data.</span></div>
        </aside>
        <section className="mx-canvas-panel" aria-label="Vessel preview">
          <div className="mx-canvas-caption"><span><i/>{playing ? 'Printing' : layer === FORM.layerCount ? 'Complete' : 'Paused'} · {extruding ? 'Extrusion on' : 'Extrusion off'}</span><span>LIVE 3D</span></div>
          <ClayScene ref={scene} path={path} initialSample={initialSample} toolpathVisible={toolpath}/>
          <div className="mx-canvas-foot"><span>Drag to orbit · Scroll to zoom</span><label><input type="checkbox" checked={toolpath} onChange={e => {setToolpath(e.target.checked); scene.current?.showToolpath(e.target.checked);}}/>Show toolpath</label></div>
        </section>
        <aside className="mx-data-panel"><div className="mx-section-head"><span>02 / CONCERN EXPERIMENT</span><span>≋</span></div><h2>Controlled interruptions</h2>
          <label htmlFor="experiment">Synthetic dataset</label>
          <select id="experiment" value={experimentId} onChange={e => {setExperimentId(e.target.value); setPlaying(false); setLayer(FORM.layerCount); setCurrentLayer(FORM.layerCount); setExtruding(false);}}>
            {experiments.map(e => <option key={e.data.datasetId} value={e.data.datasetId}>{e.label}</option>)}
          </select>
          <dl className="mx-specs">
            <div><dt>Current layer</dt><dd>{currentLayer}</dd></div><div><dt>Concern score</dt><dd>{layerPlan.concernScore.toFixed(2)}</dd></div>
            <div><dt>Planned gap events</dt><dd>{layerPlan.events.length}</dd></div><div><dt>Layer gap length</dt><dd>{layerPlan.gapLengthMm.toFixed(1)} <small>mm</small></dd></div>
            <div><dt>Layer interrupted</dt><dd>{(layerPlan.interruptedFraction * 100).toFixed(1)}<small>%</small></dd></div><div><dt>Overall path coverage</dt><dd data-testid="coverage">{(experiment.depositedCoverage * 100).toFixed(1)}<small>%</small></dd></div>
          </dl>
          <p className="mx-muted">Whole-plan totals · {(experiment.gapLengthMm / 1000).toFixed(2)} m commanded gaps. </p>
          <details className="mx-info"><summary>Support diagnostics</summary><p>Current layer: {(support.overlapCoverage * 100).toFixed(1)}% mean local overlap; {support.unsupportedLengthMm.toFixed(1)} mm unsupported ({support.unsupportedSpans.length} spans). Completed-plan estimate, sampled at ≤0.5 mm. Layer 1 assumes plate contact.</p></details>
          <div className="mx-bottom-note">IDEAL COMMANDED GAPS · SEED {experiment.policy.seed}<br/><span>Policy {experiment.policy.version}. Pressure and flow response are uncalibrated. Overlap is geometry, not support force.</span></div>
        </aside>
        <div className="mx-playback"><button className="mx-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => {playing ? playback.pause() : playback.play(); sync();}}>{playing ? 'Ⅱ' : '▶'}</button>
          <button className="mx-reset" aria-label="Reset" onClick={() => {playback.reset(); sync();}}>↻</button>
          <div className="mx-timeline"><div><label htmlFor="layer">Layer progress / nominal motion</label><output data-testid="layer-count">{layer} / {FORM.layerCount}</output></div><input id="layer" aria-label="Layer progress" type="range" min="0" max={FORM.layerCount} value={layer} onChange={e => {playback.seekLayer(Number(e.target.value)); sync();}}/></div>
          <span className="mx-playback-note">{PREVIEW_SPEED}× preview<br/>Nominal 1 mm layers</span>
        </div>
      </div>
      <p className="mx-method">Simulated deposition · 3 mm stable base · Open top · Physical calibration pending.</p>
    </main>
    <footer><span>GRAMMAR OF FAILURE / PROTOTYPE C</span><p>Commanded gaps, unchanged form.</p><span>MILESTONE 2A · CONCERN & DEPOSITION</span></footer>
  </div>;
}
