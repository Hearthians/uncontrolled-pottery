import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Play, Pause, RotateCcw, Camera, Download, Expand } from "lucide-react";
import { ClayScene } from "./ClayScene";
import type { SceneHandle } from "./ClayScene";
import { DEFAULT_PARAMETERS, randomValidShape } from "./toolpath";
import { SHAPE_FAMILIES, SHAPE_LABELS, SCULPTURAL_MODIFIERS, MODIFIER_LABELS } from "./shapes";
import type { ShapeFamily, ShapeRequest, SculpturalModifier } from "./shapes";
import { MACHINE, requireBuildVolume } from "./machine";
import { generateBaseGeometry, geometryToToolpath } from "./geometry";
import type { GeometryResult } from "./geometry";
import { serializeGeometryManifest, serializeFullGeometry, importFullGeometry, MAX_GEOMETRY_JSON_BYTES } from "./serialization";
import type { CylinderParameters } from "./toolpath";
import { Playback } from "./playback";
import {gapResultToToolpath} from "./gaps";
import {simulateGaps} from "./gapsSimulation";
import type {GapsSimulationResult} from "./gapsSimulation";
import {createGeometryManifest} from "./serialization";
import {scheduleFromHeightIntervals} from "./failureSchedule";
import {RESIDUE_CALIBRATION} from "./clayResidue";
import "./contours.css";

function download(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
}

function randomShape(parameters = DEFAULT_PARAMETERS): ShapeRequest {
  return randomValidShape(parameters, crypto.getRandomValues(new Uint32Array(1))[0]);
}

async function generateBundle(parameters: CylinderParameters, shape: ShapeRequest, validation?: {safetyMarginMm:number;maxLayerDisplacementMm:number}) {
  const request = {validation,geometry: {heightMm:parameters.heightMm, radiusMm:parameters.radiusMm,
    baseProfile:shape.family, modifier:shape.modifier, seed:shape.seed, parameters:shape.parameters},
    sampling:{layerHeightMm:parameters.layerHeightMm},
    printing:{beadWidthMm:parameters.beadWidthMm,feedrateMmMin:parameters.feedrateMmMin}};
  const result=await generateBaseGeometry(request);
  if(!result.ok) throw new Error(result.errors.map(e=>e.message).join(" "));
  return {...await bundleFromGeometry(result.geometry),shape};
}
async function bundleFromGeometry(geometry: GeometryResult) {
  const g=geometry.geometry;
  const shape: ShapeRequest={family:g.baseProfile,modifier:geometry.descriptor.modifier ?? g.modifier,seed:g.seed,parameters:g.parameters};
  const base=await generateBaseGeometry({geometry:{...g,modifier:"none",
    parameters:{...g.parameters,foldAmplitude:0,sculpturalIntensity:0}},
    sampling:{layerHeightMm:geometry.sampling.layerHeightMm},
    printing:{beadWidthMm:geometry.printing.beadWidthMm,feedrateMmMin:geometry.printing.feedrateMmMin},
    validation:{safetyMarginMm:geometry.validation.buildVolume.safetyMarginMm,
      maxLayerDisplacementMm:geometry.descriptor.maxLayerDisplacementMm}});
  if(!base.ok) throw new Error(base.errors.map(e=>e.message).join(" "));
  return {path:geometryToToolpath(geometry),basePath:geometryToToolpath(base.geometry),shape,
    geometryId:geometry.geometryId,geometry};
}

type GeometryBundle = Awaited<ReturnType<typeof generateBundle>>;
export default function App() {
  const [initial,setInitial]=useState<GeometryBundle | null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    Promise.resolve().then(()=>generateBundle(DEFAULT_PARAMETERS,randomShape())).then(value=>{if(active)setInitial(value);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"Geometry generation failed.");});
    return ()=>{active=false;};
  },[]);
  return initial ? <Studio initial={initial}/> : <p role={error?"alert":"status"}>{error || "Preparing validated geometry…"}</p>;
}
function Studio({initial}:{initial:GeometryBundle}) {
  const [parameters, setParameters] = useState(DEFAULT_PARAMETERS);
  const [draft, setDraft] = useState(DEFAULT_PARAMETERS);
  const [shapeDraft, setShapeDraft] = useState<ShapeRequest>(initial.shape);
  const intensityKey = !shapeDraft.modifier || shapeDraft.modifier === "soft-organic-fold" ? "foldAmplitude" : "sculpturalIntensity";
  // Explicit family/seed edits resolve a new recipe instead of retaining imported overrides.
  const shapeIntensities = {foldAmplitude:shapeDraft.parameters?.foldAmplitude ?? 0,
    sculpturalIntensity:shapeDraft.parameters?.sculpturalIntensity ?? .6};
  const [bundle,setBundle]=useState(initial);
  const [simulation,setSimulation]=useState<GapsSimulationResult|null>(null);
  const derived=simulation?.gaps??null,support=simulation?.support;
  const [inputMode,setInputMode]=useState<"manual"|"schedule">("manual");
  const [scheduleText,setScheduleText]=useState("");
  const [gapEnabled,setGapEnabled]=useState(false);
  const [gapIntensity,setGapIntensity]=useState(.5);
  const [gapSeed,setGapSeed]=useState(42);
  const path=useMemo(()=>derived?gapResultToToolpath(derived):bundle.path,[derived,bundle]);
  const basePath=derived?bundle.path:bundle.basePath;
  const residue=simulation?.residue;
  const [generating,setGenerating]=useState(false);
  const generation=useRef(0);
  const [framing, setFraming] = useState<"vessel" | "plate">("plate");
  const [showBase, setShowBase] = useState(false);
  const playback = useMemo(() => new Playback(path), [path]);
  const [sample, setSample] = useState(() => playback.sample());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [planned, setPlanned] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [error, setError] = useState("");
  const [webglError, setWebglError] = useState(false);
  const scene = useRef<SceneHandle>(null);
  const bench = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    const next = playback.sample();
    scene.current?.update(next); setSample(next); setPlaying(playback.playing);
  };
  useEffect(() => { refresh(); }, [playback]);
  useEffect(() => {
    let previous = performance.now(), frame = 0;
    const tick = (now: number) => {
      const dt = (now - previous) / 1000;
      previous = now;
      if (playback.playing && !document.hidden) {
        const next = playback.advance(dt * speed);
        scene.current?.update(next); setSample(next); setPlaying(playback.playing);
      }
      frame = requestAnimationFrame(tick);
    };
    // Backgrounding pauses explicitly, so resuming cannot consume a hidden time interval.
    const visibility = () => { if (document.hidden) { playback.pause(); refresh(); } };
    document.addEventListener("visibilitychange", visibility);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", visibility); };
  }, [playback, speed]);

  const current = path.moves[sample.moveIndex] ?? path.moves[0];
  const complete = sample.elapsedS >= path.durationS;
  const progress = sample.elapsedS / path.durationS;
  const status = complete ? "Complete" : playing ? "Printing" : sample.elapsedS > 0 ? "Paused" : "Ready";
  const commit = async (dimensions: CylinderParameters, nextShape: ShapeRequest) => {
    const token=++generation.current;
    setGenerating(true);
    try {
      const next=await generateBundle(dimensions,nextShape,{safetyMarginMm:bundle.geometry.validation.buildVolume.safetyMarginMm,
        maxLayerDisplacementMm:bundle.geometry.descriptor.maxLayerDisplacementMm});
      if(token!==generation.current)return;
      playback.reset(); setPlaying(false); setSimulation(null); setBundle(next);
      setParameters({...dimensions}); setDraft({...dimensions}); setShapeDraft({...nextShape}); setError("");
    } catch(e) { if(token===generation.current)setError(e instanceof Error?e.message:"Invalid geometry"); }
    finally { if(token===generation.current)setGenerating(false); }
  };
  const apply = (event: React.FormEvent) => { event.preventDefault(); void commit(draft,shapeDraft); };
  const exportGeometry = (full: boolean) => {
    try {
      const text=full?serializeFullGeometry(bundle.geometry):serializeGeometryManifest(bundle.geometry);
      const url=URL.createObjectURL(new Blob([text],{type:"application/json"}));
      download(url,full?"geometry-full.json":"geometry-manifest.json");setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(e) {setError(e instanceof Error?e.message:"Geometry export failed.");}
  };
  const importGeometry = async (file: File) => {
    const token=++generation.current;setGenerating(true);
    try {
      if(file.size>MAX_GEOMETRY_JSON_BYTES)throw new Error("Geometry JSON exceeds 32 MiB.");
      const result=await importFullGeometry(await file.text());
      if(!result.ok)throw new Error(result.errors.map(e=>e.message).join(" "));
      const next=await bundleFromGeometry(result.geometry);
      if(token!==generation.current)return;
      playback.reset();setPlaying(false);setSimulation(null);setBundle(next);setParameters(next.path.parameters);setDraft(next.path.parameters);
      setShapeDraft(next.shape);setError("");
    } catch(e) {if(token===generation.current)setError(e instanceof Error?e.message:"Geometry import failed.");}
    finally {if(token===generation.current)setGenerating(false);}
  };
  const exportRecord = () => {
    try { requireBuildVolume(path.moves, path.buildVolume.safetyMarginMm); }
    catch (e) { setError(e instanceof Error ? e.message : "Build-volume validation failed."); return; }
    const blob = new Blob([JSON.stringify({ version: 1, units: "mm", upAxis: "Z", parameters,
      geometryId: bundle.geometryId, shapeDescriptor: path.shape, buildVolume: path.buildVolume, elapsedS: sample.elapsedS,
      failure:derived?{simulationId:simulation?.simulationId,schedule:simulation?.schedule,support,materialCalibration:RESIDUE_CALIBRATION,derivedId:derived.derivedId,settings:derived.settings,seed:derived.seed,appliedIntensities:derived.appliedIntensities,events:derived.events,metrics:derived.metrics,validation:derived.validation}:undefined }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); download(url, "contour-study.json");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const applyFailure=async(file?:File)=>{
    const token=++generation.current;setGenerating(true);
    try {
      if(file&&file.size>4*1024*1024)throw new Error("Schedule JSON exceeds 4 MiB.");
      const text=file?await file.text():scheduleText;
      const external=!!file||inputMode==="schedule";
      if(external&&!text)throw new Error("Import a Failure Schedule JSON file first.");
      const request=external?text:gapEnabled?scheduleFromHeightIntervals(createGeometryManifest(bundle.geometry),
        [{start:0,end:1,failureType:"gaps",intensity:gapIntensity}],gapSeed):null;
      const next=external||gapEnabled?await simulateGaps(bundle.geometry,request,gapSeed):null;
      if(token!==generation.current)return;
      if(external)setScheduleText(text);
      playback.reset();refresh();setSimulation(next);setShowBase(false);setError("");
    }catch(e){if(token===generation.current)setError(e instanceof Error?e.message:"Gap generation failed.");}
    finally{if(token===generation.current)setGenerating(false);}
  };
  return <div className="app-shell contour-app">
    <aside className="nav-rail"><div className="rail-links"><span className="rail-item selected"><Box size={22} /><span>Studio</span></span></div></aside>
    <div className="app-main">
      <header className="topbar"><div className="wordmark"><span>Grammar of Failure<span className="brand-dot">.</span></span></div><span>Grammar of Failure · B v1</span></header>
      <main className="studio-page">
        <div className="page-heading"><div className="page-title"><h1>Contour Printing</h1></div><span>Continuous Extrusion · Millimetres</span></div>
        <div className="workbench" ref={bench}>
          <section className="viewport">
            <ClayScene material={simulation?.material} support={support} residue={residue} framing={framing} ref={scene} path={path} basePath={basePath} showBase={showBase} planned={planned} autoRotate={autoRotate} onError={() => setWebglError(true)} />
            <div className="viewport-top"><div className="live-status"><span className={`status-dot ${playing ? "printing" : "paused"}`} /><span data-testid="status">{status}</span>{showBase && <span> · {derived?"Original geometry preview":"Neutral base preview"}</span>}</div>
              <button className="icon-button" aria-label="Fullscreen" onClick={() => {
                const action = document.fullscreenElement ? document.exitFullscreen() : bench.current?.requestFullscreen();
                action?.catch(() => setError("Fullscreen is unavailable in this browser."));
              }}><Expand size={18} /></button></div>
            {webglError && <div className="webgl-error" role="alert">Enable WebGL to view the 3D scene. Reload or try another browser.</div>}
            <div className="viewport-bottom">
              <select aria-label="View" onChange={e => scene.current?.setView(e.target.value as "perspective" | "front" | "top")}>
                <option value="perspective">Perspective</option><option value="front">Front</option><option value="top">Top</option>
              </select>
              <select aria-label="Camera framing" value={framing} onChange={e => setFraming(e.target.value as "vessel" | "plate")}>
                <option value="vessel">Fit Vessel</option><option value="plate">Fit Build Plate</option>
              </select>
              <div className="canvas-tools">
                <button aria-pressed={planned} onClick={() => setPlanned(!planned)}>Contours</button>
                <button aria-pressed={autoRotate} onClick={() => setAutoRotate(!autoRotate)}>Auto-rotate</button>
                <button aria-label="Save Image" onClick={() => { const url = scene.current?.capture(); if (url) download(url, "contour-print.png"); }}><Camera size={18} /></button>
              </div>
            </div>
          </section>
          <aside className="control-panel">
            <div className="panel-heading"><div><h2>Vessel Parameters</h2></div><span>MM / MIN</span></div>
            <p className="shape-note machine-info">{MACHINE.name}<br />
              Build Volume: Ø{MACHINE.diameterMm} × H{MACHINE.heightMm} mm<br />
              Build Plate: Ø{MACHINE.diameterMm} mm<br />
              Safety margin: {path.buildVolume.safetyMarginMm} mm at sides and top; bed contact allowed.</p>
            <p className="shape-note machine-info" data-testid="build-volume-status">Applied shape: within build volume and safety margin.</p>
            <form onSubmit={apply}>
              <fieldset disabled={playing || generating}>
                <label>Base Shape<select aria-label="Base Shape" value={shapeDraft.family} onChange={e => setShapeDraft({ ...shapeDraft, family: e.target.value as ShapeFamily, parameters:shapeIntensities })}>
                  {SHAPE_FAMILIES.map(family => <option key={family} value={family}>{SHAPE_LABELS[family]}</option>)}
                </select></label>
                <label>Sculptural Family<select aria-label="Sculptural Family" value={shapeDraft.modifier ?? "soft-organic-fold"}
                  onChange={e => setShapeDraft({ ...shapeDraft, modifier: e.target.value as SculpturalModifier, parameters:shapeIntensities })}>
                  {shapeDraft.modifier === "none" && <option value="none">None</option>}
                  {SCULPTURAL_MODIFIERS.map(modifier => <option key={modifier} value={modifier}>{MODIFIER_LABELS[modifier]}</option>)}
                </select></label>
                <label>Shape Seed<input aria-label="Shape Seed" type="number" min="0" max="4294967295" step="1" required value={shapeDraft.seed} onChange={e => setShapeDraft({ ...shapeDraft, seed: e.target.valueAsNumber, parameters:shapeIntensities })} /></label>
                <label>Sculptural Intensity (0–1)<input aria-label="Sculptural Intensity" type="number" min="0" max="1" step="0.05" required
                  value={shapeDraft.parameters?.[intensityKey] ?? .6} onChange={e => setShapeDraft({ ...shapeDraft,
                    parameters: { ...shapeDraft.parameters, [intensityKey]: e.target.valueAsNumber } })} /></label>
                <button type="button" className="text-button" onClick={() => {
                  try {
                    const next = randomValidShape(parameters, crypto.getRandomValues(new Uint32Array(1))[0], bundle.geometry.validation.buildVolume.safetyMarginMm, { family: shapeDraft.family, modifier: shapeDraft.modifier }); void commit(parameters,next);
                  } catch (e) { setError(e instanceof Error ? e.message : "Random shape rejected."); }
                }}>Randomize Shape</button>
                <label>Model Height (mm)<input aria-label="Model Height (mm)" type="number" min="1" max={MACHINE.heightMm} step="0.1" required value={draft.heightMm} onChange={e => setDraft({ ...draft, heightMm: e.target.valueAsNumber })} /></label>
                <label>Centreline radius (mm)<input aria-label="Centreline radius (mm)" type="number" min="2" max="100" step="0.1" required value={draft.radiusMm} onChange={e => setDraft({ ...draft, radiusMm: e.target.valueAsNumber })} /></label>
                <label>Feedrate (mm/min)<input aria-label="Feedrate (mm/min)" type="number" min="60" max="12000" step="10" required value={draft.feedrateMmMin} onChange={e => setDraft({ ...draft, feedrateMmMin: e.target.valueAsNumber })} /></label>
                <p>Layer height {parameters.layerHeightMm} mm · Bead width {parameters.beadWidthMm} mm</p>
                <button className="primary-button" type="submit">Apply and Reset</button>
              </fieldset>
            </form>
            <button type="button" className="text-button" aria-pressed={showBase} onClick={() => setShowBase(!showBase)}>
              {derived?(showBase?"Show Derived":"Show Original"):(showBase ? "Show Modified Form" : "Show Base")}
            </button>
            {showBase && <p className="shape-note">Full {derived?"original":"neutral base"} preview. Playback continues independently.</p>}
            <fieldset disabled={playing || generating}>
              <label>Input Mode<select aria-label="Input Mode" value={inputMode} onChange={e=>setInputMode(e.target.value as "manual"|"schedule")}><option value="manual">Manual Test</option><option value="schedule">Failure Schedule</option></select></label>
              {inputMode==="manual"?<><label><input type="checkbox" checked={gapEnabled} onChange={e=>setGapEnabled(e.target.checked)}/> Enable Gaps</label>
              <label>Failure Intensity (0–1)<input aria-label="Failure Intensity" type="number" min="0" max="1" step="0.05" value={gapIntensity} onChange={e=>setGapIntensity(e.target.valueAsNumber)}/></label></>:
              <label>Import and Apply Schedule<input aria-label="Failure Schedule JSON" type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void applyFailure(file);}}/></label>}
              <label>Failure Seed<input aria-label="Failure Seed" type="number" min="0" max="4294967295" step="1" value={gapSeed} onChange={e=>setGapSeed(e.target.valueAsNumber)}/></label>
              <button className="text-button" onClick={()=>void applyFailure()}>Apply Gaps / Regenerate</button>
            </fieldset>
            {inputMode==="schedule"&&<p className="shape-note" data-testid="schedule-status">{simulation?`Applied schedule validated · ${simulation.targetedLayerCount?"Gaps":"Stable"} · ${simulation.targetedLayerCount} targeted layers` : "No schedule applied to this geometry."}</p>}
            {derived && <p className="shape-note" data-testid="gap-metrics">{derived.metrics.eventCount} interruptions · {(derived.metrics.missingDepositionRatio*100).toFixed(1)}% commanded missing deposition.</p>}
            {derived&&support&&<p className="shape-note" data-testid="support-metrics">{support.metrics.unsupportedRegions} unsupported regions · {support.metrics.long} structurally uncertain spans · max {support.metrics.maximumDisplacementMm.toFixed(3)} mm predicted displacement. Heuristic, not verified stability.</p>}
            {error && <p role="alert">{error}</p>}
            {path.shape.warnings.length > 0 && <p role="status" className="shape-warning">
              {path.shape.warnings[0].message} {path.shape.warnings.length > 1 && `(${path.shape.warnings.length} layer warnings)`}
            </p>}
            <p className="shape-note">Geometric checks only; physical printability is not verified.</p>
            <dl className="path-stats">
              <dt>Shape envelope W × D × H (mm), including beads</dt>
              <dd data-testid="shape-dimensions">{path.buildVolume.deposited.max.map((v, i) =>
                (v - path.buildVolume.deposited.min[i]).toFixed(2)).join(" × ")}</dd>
              <dt>Horizontal contours</dt><dd data-testid="contours">{path.contours.length}</dd>
              <dt>Path length</dt><dd>{path.lengthMm.toFixed(1)} mm</dd>
              <dt>Position XYZ (mm)</dt><dd data-testid="position">{sample.position.map(v => v.toFixed(3)).join(", ")}</dd>
              <dt>Layer / Total</dt><dd>{current.layerId + 1} / {path.contours.length}</dd>
              <dt>Current move</dt><dd>{current.kind === "travel" ? "Travel · Extrusion off" : current.kind === "transition" ? "Layer transition · Extrusion on" : "Contour deposition"}</dd>
            </dl>
            <button className="text-button" onClick={exportRecord}><Download size={15} /> Export Parameters</button>
            <button className="text-button" onClick={()=>exportGeometry(false)}>Export Geometry Manifest</button>
            <button className="text-button" onClick={()=>exportGeometry(true)}>Export Full Geometry</button>
            <button className="text-button" disabled={playing || generating} onClick={()=>importInput.current?.click()}>Import Full Geometry</button>
            <input ref={importInput} type="file" accept=".json,application/json" aria-label="Import Full Geometry file" hidden
              onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void importGeometry(file);}} />
          </aside>
          <div className="contour-playback">
            <button className="primary-button" disabled={complete || webglError || generating} onClick={() => { playing ? playback.pause() : playback.play(); refresh(); }}>
              {playing ? <Pause size={16} /> : <Play size={16} />}{playing ? "Pause" : sample.elapsedS > 0 ? "Resume" : "Play"}
            </button>
            <button aria-label="Reset print" onClick={() => { playback.reset(); refresh(); }}><RotateCcw size={18} /> Reset</button>
            <div className="contour-progress"><progress aria-label="Print progress" value={progress} max="1" /><span data-testid="time">{sample.elapsedS.toFixed(2)} / {path.durationS.toFixed(2)} s</span></div>
            <label>Playback speed <select aria-label="Playback speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[1, 5, 20].map(v => <option key={v} value={v}>{v}×</option>)}</select></label>
          </div>
        </div>
      </main>
    </div>
  </div>;
}
