import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { TopographyScene } from "./TopographyScene";
import { compileTopography, loadTopography, TOPOGRAPHY, type TopographyData, type TopographyBand } from "./memoryTopography";
import type { FormMetrics } from "./topographyForm";
import type { TopographyFrame } from "./topographyAnimation";
import "./memoryTopography.css";

const COLORS = ["#a77c55", "#b15f45", "#879381", "#9a8e80"];
const percentage = (share: number) => `${(share * 100).toFixed(1)}%`;
const label = (band: TopographyBand) => `R${band.id.split("-").at(-1)!.padStart(2, "0")}`;
function excerpt(text: string) {
  const limit = 145;
  if (text.length <= limit) return text;
  const part = text.slice(0, limit);
  const lastSpace = part.lastIndexOf(" ");
  return `${part.slice(0, lastSpace > limit / 2 ? lastSpace : limit).trimEnd()}…`;
}

function Artwork({ data, texts }: { data: TopographyData; texts: string[] }) {
  const plan = useMemo(() => compileTopography(data), [data]);
  const [render, setRender] = useState<{ image: string; metrics: FormMetrics } | null>(null);
  const [failed, setFailed] = useState(false);
  const [initiallyComplete] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing, setPlaying] = useState(!initiallyComplete);
  const [replayKey, setReplayKey] = useState(0);
  const [resetViewKey, setResetViewKey] = useState(0);
  const [manualView, setManualView] = useState(false);
  const [frame, setFrame] = useState<TopographyFrame>({ phase: initiallyComplete ? "complete" : "printing",
    progress: initiallyComplete ? 1 : 0, layer: initiallyComplete ? TOPOGRAPHY.totalLayers : 0, rotation: 0 });
  const onReady = useCallback((image: string, metrics: FormMetrics) => setRender({ image, metrics }), []);
  const onFrame = useCallback((value: TopographyFrame) => setFrame(value), []);
  const onViewChange = useCallback((manual: boolean) => setManualView(manual), []);
  const onError = useCallback(() => { setFailed(true); setPlaying(false); }, []);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => { if (preference.matches) setPlaying(false); };
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);
  const togglePlayback = () => {
    if (!playing && initiallyComplete && replayKey === 0) setReplayKey(value => value + 1);
    setPlaying(value => !value);
  };
  const replay = () => { setReplayKey(value => value + 1); setPlaying(true); };
  const strongest = plan.bands.reduce((a, b) => a.diversity > b.diversity ? a : b);
  return <>
    <header className="topography-header"><a href={location.pathname}>UNCONTROLLED STUDIO</a>
      <a href={`${location.pathname}?lab=memory-comparison`}>Mapping studies ↗</a></header>
    <section className="topography-title">
      <div><p className="topography-kicker">GRAMMAR OF FAILURE · MEMORY STRATIGRAPHY</p><h1>Memory Topography</h1><p>Every memory, one collective vessel.</p></div>
      <div className="topography-edition"><strong>{data.count.toLocaleString("en-US")}</strong><span>memories / {data.regions.length} groups / 1 work</span></div>
    </section>
    <section className="topography-artwork" aria-label="One vessel with a static legend arranged by height">
      <figure className="topography-object" data-ready={render ? "true" : "false"} data-decoder={TOPOGRAPHY.decoder}
        data-phase={frame.phase} data-layer={frame.layer} data-progress={frame.progress.toFixed(6)}
        data-rotation={frame.rotation.toFixed(6)} data-playing={playing ? "true" : "false"}>
        <div className="topography-image">
          {!failed && <TopographyScene plan={plan} playing={playing} replayKey={replayKey} resetViewKey={resetViewKey} initiallyComplete={initiallyComplete}
            onReady={onReady} onFrame={onFrame} onViewChange={onViewChange} onError={onError} />}
          {failed && render && <img src={render.image} width="1000" height="1160" alt="A clay vessel made from rounded, gently compressed strands with local sagging and small gaps" />}
          {failed ? <p className="topography-rendering" role="alert">The animation could not be generated. Please reload the page.</p>
            : !render && <p className="topography-rendering" role="status">Preparing the formation sequence…</p>}
        </div>
        <figcaption><span>01 / COLLECTIVE VESSEL</span><span>{TOPOGRAPHY.totalLayers} turns · Continuous helix</span></figcaption>
        <div className="topography-playback">
          <div className="topography-playback-row">
            <span>{!render ? "Preparing" : !playing ? "Paused" : frame.phase === "printing" ? `Extruding · ${Math.max(1, frame.layer)} / ${TOPOGRAPHY.totalLayers} turns`
              : frame.phase === "settling" ? "Clay settling" : manualView ? "Complete · Explore the form" : "Complete · Slowly rotating"}</span>
            <div><button type="button" onClick={togglePlayback} disabled={!render || failed}>{playing ? "Pause animation" : "Play animation"}</button>
              <button type="button" onClick={replay} disabled={!render || failed}>Replay animation</button>
              <button type="button" onClick={() => setResetViewKey(value => value + 1)} disabled={!render || failed}>Reset view</button></div>
          </div>
          <div className="topography-progress" role="progressbar" aria-label="Deposition progress" aria-valuemin={0}
            aria-valuemax={TOPOGRAPHY.totalLayers} aria-valuenow={frame.layer}><span style={{ width: `${frame.progress * 100}%` }} /></div>
          <p className="topography-view-hint">Drag to rotate · Scroll or pinch to zoom</p>
        </div>
      </figure>
      <aside className="topography-reading" aria-label="Memory regions, from top to bottom">
        <div className="topography-reading-heading"><h2>Reading the vessel</h2><p>Layer allocation shows quantity; deformation shows diversity.</p></div>
        <div className="topography-legend-layout">
          <div className="topography-height-key" aria-label="Proportional layer allocation before deformation">
            <span className="topography-ruler-end">TOP</span>
            <div className="topography-height-stack">{[...plan.bands].reverse().map(band => {
              const index = plan.bands.indexOf(band);
              return <div key={band.id} style={{ flexGrow: band.layers, background: COLORS[index] }} title={`${label(band)}: ${band.layers} layers`}><span>{label(band)}</span></div>;
            })}</div>
            <span className="topography-ruler-end">BASE</span>
          </div>
          <div className="topography-legends">{[...plan.bands].reverse().map(band => {
            const index = plan.bands.indexOf(band);
            return <article className="topography-legend" key={band.id} data-region={band.id}
              style={{ "--band-color": COLORS[index] } as CSSProperties}>
              <header><h3>{label(band)}</h3><span>{band.indices.length} memories · {percentage(band.share)}</span></header>
              <div className="topography-legend-metrics"><span>Layers {band.startLayer + 1}–{band.endLayer} / {band.layers} layers</span>
                <span>Diversity {band.diversity.toFixed(3)}{band.id === strongest.id ? " · highest" : ""}</span></div>
              <blockquote>{excerpt(texts[band.representatives[0]])}</blockquote>
              <p className="topography-source">Representative memory #{band.representatives[0] + 1}{texts[band.representatives[0]].length > 145 ? " · excerpt" : ""}</p>
            </article>;
          })}</div>
        </div>
        <p className="topography-reading-note">The scale preserves layer proportions before deformation. Two layers at the base and two at the rim provide structure. The middle 60 layers encode quantity, with rounding error below one layer per group.</p>
      </aside>
    </section>
    <section className="topography-caption" aria-label="How the artwork encodes the data">
      <div><span>01 / QUANTITY → LAYERS</span><p>Every memory counts toward its group. Larger groups receive more printing layers.</p></div>
      <div><span>02 / DIVERSITY → DEFORMATION</span><p>Diversity is the mean cosine distance between the original text vectors within a group. All four groups share one scale: greater diversity produces deeper sagging, stronger layer offsets and more accumulation.</p></div>
      <div><span>03 / SIMILARITY → PROXIMITY</span><p>Memories are grouped in the full {data.embedding.dimensions.toLocaleString("en-US")}-dimensional space. Groups with similar semantic centers are placed next to each other. Vertical order does not indicate time or emotional intensity.</p></div>
    </section>
    <footer className="topography-footer">
      <p>Deformation visually amplifies within-group diversity across the shared range {plan.diversityRange[0].toFixed(3)}–{plan.diversityRange[1].toFixed(3)}. This is a generated geometry preview; physical printing has not been validated.</p>
      <div><a href={`${import.meta.env.BASE_URL}memory-topography.json`} download>Group data ↓</a>
        {render && <a href={render.image} download="memory-topography.png">Artwork image ↓</a>}</div>
      {render && <output className="topography-render-metrics" data-drop={render.metrics.maxDropMm.toFixed(3)} data-layers={render.metrics.layerCount}
        data-count={plan.count} data-bands={JSON.stringify(render.metrics.bands)} aria-label="Generation record">Maximum local sag {render.metrics.maxDropMm.toFixed(1)} mm · Design height {TOPOGRAPHY.heightMm} mm</output>}
    </footer>
  </>;
}

export default function MemoryTopographyPage() {
  const [loaded, setLoaded] = useState<{ data: TopographyData; texts: string[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Memory Topography | Uncontrolled Studio";
    const controller = new AbortController();
    loadTopography(controller.signal).then(result => { if (!controller.signal.aborted) setLoaded(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Memory Topography could not be loaded."); });
    return () => { controller.abort(); document.title = previousTitle; };
  }, []);
  return <main className="memory-topography-page" lang="en">{loaded ? <Artwork {...loaded} />
    : <div className="topography-loading"><a href={location.pathname}>← Uncontrolled Studio</a><h1>Memory Topography</h1><p role={error ? "alert" : "status"}>{error || "Checking the memories and groups…"}</p></div>}</main>;
}
