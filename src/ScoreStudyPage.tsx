import { useEffect, useRef, useState } from "react";
import { SCORE_STUDY, type ScoreShape, type ScoreStrategy } from "./scoreStudyCore.ts";
import { createScoreRenderer } from "./scoreStudyRenderer.ts";
import "./scoreStudy.css";

const STRATEGIES: { id: ScoreStrategy; letter: string; title: string; description: string }[] = [
  { id: "supply", letter: "A", title: "Supply & interruptions", description: "Vary feed along a fixed path; the strand model resolves deposition." },
  { id: "path", letter: "B", title: "Supply & toolpath", description: "Introduce gaps, buildup and path offsets, then check local support." },
  { id: "field", letter: "C", title: "Continuous deformation", description: "Let the same regions gradually bulge, shift and sag." },
];
const LEVELS = ["Stable", "Subtle", "Mild", "Moderate", "Strong", "Extreme"];
const keyOf = (strategy: ScoreStrategy, score: number) => `${strategy}-${score.toFixed(2)}`;
type Sample = { shape: ScoreShape; image: string; milliseconds: number };
type Pending = { resolve: (value: { shape: ScoreShape; milliseconds: number }) => void; reject: (reason: Error) => void };

function ShapeViewer({ shape, resetKey, backKey }: { shape?: ScoreShape; resetKey: number; backKey: number }) {
  const host = useRef<HTMLDivElement>(null), renderer = useRef<ReturnType<typeof createScoreRenderer> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!host.current) return;
    const container = host.current, canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "Clay specimen: drag to rotate"); container.appendChild(canvas);
    let view: ReturnType<typeof createScoreRenderer>;
    try { view = createScoreRenderer(canvas, true); renderer.current = view; }
    catch { canvas.remove(); setError("The 3D preview is unavailable. See the specimen images below."); return; }
    const resize = () => view.size(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    return () => { observer.disconnect(); renderer.current = null; view.dispose(); canvas.remove(); };
  }, []);
  useEffect(() => { if (shape) renderer.current?.show(shape); }, [shape]);
  useEffect(() => { renderer.current?.reset(); }, [resetKey]);
  useEffect(() => { if (backKey) renderer.current?.back(); }, [backKey]);
  return <div className="score-viewer" data-ready={shape ? "true" : "false"}>
    <div ref={host} className="score-viewer-host" />
    {error && <p role="alert">{error}</p>}
    {!shape && !error && <p role="status">Generating specimen…</p>}
  </div>;
}

export default function ScoreStudyPage() {
  const [samples, setSamples] = useState<Record<string, Sample>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [strategy, setStrategy] = useState<ScoreStrategy>("field");
  const [score, setScore] = useState(0.6), [selected, setSelected] = useState(keyOf("field", 0.6));
  const [resetKey, setResetKey] = useState(0), [backKey, setBackKey] = useState(0);
  const [busy, setBusy] = useState(false), [fatal, setFatal] = useState("");
  const request = useRef<((strategy: ScoreStrategy, score: number) => Promise<Sample>) | null>(null);
  const active = samples[selected], descriptor = STRATEGIES.find(item => item.id === strategy)!;

  useEffect(() => {
    let disposed = false, nextRequest = 0;
    const workers = new Map<ScoreStrategy, Worker>(), pending = new Map<number, Pending>();
    const promises = new Map<string, Promise<Sample>>();
    const snapshotCanvas = document.createElement("canvas");
    let snapshot: ReturnType<typeof createScoreRenderer>;
    try { snapshot = createScoreRenderer(snapshotCanvas); snapshot.size(360, 480); }
    catch { setFatal("Cannot create the 3D view. Enable WebGL in your browser and try again."); return; }
    for (const { id } of STRATEGIES) {
      const worker = new Worker(new URL("./scoreStudy.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ request: number; shape?: ScoreShape; milliseconds: number; error?: string }>) => {
        const item = pending.get(event.data.request); if (!item) return;
        pending.delete(event.data.request);
        if (event.data.error || !event.data.shape) item.reject(new Error(event.data.error ?? "Could not generate the specimen"));
        else item.resolve({ shape: event.data.shape, milliseconds: event.data.milliseconds });
      };
      worker.onerror = () => {
        // A crashed worker cannot answer queued requests; surface the failure.
        for (const item of pending.values()) item.reject(new Error("Specimen computation stopped. Refresh to try again."));
        pending.clear();
      };
      workers.set(id, worker);
    }
    const generate = (method: ScoreStrategy, value: number) => {
      const key = keyOf(method, value), cached = promises.get(key); if (cached) return cached;
      const number = nextRequest++;
      const promise = new Promise<{ shape: ScoreShape; milliseconds: number }>((resolve, reject) => {
        pending.set(number, { resolve, reject });
        workers.get(method)!.postMessage({ request: number, strategy: method, score: value, seed: SCORE_STUDY.seed });
      }).then(({ shape, milliseconds }) => {
        if (disposed) throw new Error("The specimen page has closed");
        snapshot.show(shape);
        const sample = { shape, milliseconds, image: snapshot.snapshot() };
        setSamples(previous => ({ ...previous, [key]: sample }));
        setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
        return sample;
      }).catch(error => {
        promises.delete(key);
        if (!disposed) setErrors(previous => ({ ...previous, [key]: error instanceof Error ? error.message : "Could not generate the specimen" }));
        throw error;
      });
      promises.set(key, promise); return promise;
    };
    request.current = generate;
    // Independent workers keep the fast geometric previews usable during A's material calculation.
    for (const { id } of STRATEGIES) void (async () => {
      const order = id === "field" ? [0.6, 0, 0.2, 0.4, 0.8, 1] : SCORE_STUDY.scores;
      for (const value of order) {
        if (disposed) return;
        try { await generate(id, value); } catch { if (disposed) return; }
      }
    })();
    return () => {
      disposed = true; request.current = null; workers.forEach(worker => worker.terminate());
      for (const item of pending.values()) item.reject(new Error("The specimen page has closed"));
      pending.clear(); snapshot.dispose();
    };
  }, []);

  const choose = (method: ScoreStrategy, value: number) => {
    setStrategy(method); setScore(value); setSelected(keyOf(method, value)); setResetKey(previous => previous + 1);
    if (!samples[keyOf(method, value)]) void request.current?.(method, value).catch(() => {});
  };
  const generate = async () => {
    if (!request.current) return;
    const key = keyOf(strategy, score); setBusy(true); setSelected(key);
    try { await request.current(strategy, score); } catch { /* Visible beside the controls. */ }
    finally { setBusy(false); }
  };
  const completed = STRATEGIES.reduce((sum, method) => sum + SCORE_STUDY.scores.filter(value => samples[keyOf(method.id, value)]).length, 0);
  const exportRecord = active ? `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({
    version: SCORE_STUDY.version, strategy: active.shape.strategy, score: active.shape.score, seed: active.shape.seed,
    conditions: SCORE_STUDY, controlWeights: active.shape.channels, metrics: active.shape.metrics, notes: active.shape.notes,
  }, null, 2))}` : "";

  return <main className="score-study-page" lang="en" data-completed={completed}>
    <header className="score-topline"><a href={location.pathname}>← Back to studio</a><span>FORM STUDY / 02</span><span>One score · Three approaches</span></header>
    <section className="score-intro">
      <div><p className="score-eyebrow">GRAMMAR OF FAILURE</p><h1>From stability to failure.</h1><p>One score from 0 to 1. Watch the same vessel change.</p></div>
      <div className="score-edition"><strong>03 × 06</strong><span>Same base / Same regions / Same view</span></div>
    </section>
    <section className="score-inspection" aria-label="Inspect a specimen">
      <div className="score-artwork"><ShapeViewer shape={active?.shape} resetKey={resetKey} backKey={backKey} />
        <div className="score-view-caption"><span>{active ? `${STRATEGIES.find(item => item.id === active.shape.strategy)!.letter} / ${active.shape.score.toFixed(2)}` : "Generating"}</span>
          <span>Drag to rotate · Scroll to zoom</span><div><button onClick={() => setBackKey(value => value + 1)}>Back view</button><button onClick={() => setResetKey(value => value + 1)}>Reset view</button></div></div>
      </div>
      <div className="score-control-panel">
        <p className="score-eyebrow">Choose an approach</p>
        <div className="score-methods" role="group" aria-label="Control approach">
          {STRATEGIES.map(method => <button key={method.id} aria-pressed={strategy === method.id} onClick={() => choose(method.id, score)}>
            <b>{method.letter}</b><span>{method.title}<small>{method.description}</small></span>
          </button>)}
        </div>
        <div className="score-input-heading"><label htmlFor="form-score">Instability score</label><output htmlFor="form-score">{score.toFixed(2)}</output></div>
        <input id="form-score" type="range" min="0" max="1" step="0.01" value={score} onChange={event => setScore(Number(event.target.value))} />
        <div className="score-range-labels"><span>0 / Stable</span><span>1 / Highly unstable</span></div>
        <button className="score-generate" onClick={() => void generate()} disabled={busy || !!fatal}>{busy ? "Generating…" : "Generate specimen"}<span>↗</span></button>
        {fatal && <p className="score-error" role="alert">{fatal}</p>}
        {errors[selected] && <p className="score-error" role="alert">{errors[selected]}</p>}
        {active && <dl className="score-measurements" data-metrics={JSON.stringify(active.shape.metrics)}>
          <div><dt>Omitted samples</dt><dd>{(active.shape.metrics.missingFraction * 100).toFixed(1)}<small>%</small></dd></div>
          <div><dt>Max. outward shift</dt><dd>{active.shape.metrics.maxOutwardMm.toFixed(1)}<small>mm</small></dd></div>
          <div><dt>Layer-to-layer shift</dt><dd>{active.shape.metrics.maxLayerShiftMm.toFixed(1)}<small>mm</small></dd></div>
          <div><dt>Max. downward shift</dt><dd>{active.shape.metrics.maxDropMm.toFixed(1)}<small>mm</small></dd></div>
          <div><dt>Width variation</dt><dd>{(active.shape.metrics.widthCv * 100).toFixed(1)}<small>%</small></dd></div>
          <div><dt>Continuous strands</dt><dd>{active.shape.metrics.depositedRuns}</dd></div>
        </dl>}
        <p className="score-model-note">{descriptor.id === "supply" ? "A uses the existing strand model. The base compresses and spreads before score-driven changes; support propagation also affects the final form." : descriptor.id === "field" ? "C grows bulges, layer shifts and sag together, linearly with the score. Clay gradually thins where openings form." : "B is a reproducible form preview. Local settling expresses support relationships, with bounded deformation for composition."}</p>
        {active && <div className="score-exports"><a href={active.image} download={`form-${active.shape.strategy}-${active.shape.score.toFixed(2)}.png`}>Download front view ↓</a><a href={exportRecord} download={`form-${active.shape.strategy}-${active.shape.score.toFixed(2)}.json`}>Score & measurements ↓</a></div>}
        {descriptor.id === "field" && <p className="score-model-note"><a href={`${import.meta.env.BASE_URL}media/grammar-of-failure-c-continuous-10s.mp4`} download="grammar-of-failure-c-continuous-10s.mp4">Download the 10-second C study ↓</a></p>}
      </div>
    </section>
    <section className="score-comparison" aria-labelledby="score-comparison-title">
      <div className="score-section-heading"><div><p className="score-eyebrow">SAME INPUT. DIFFERENT CONTROL.</p><h2 id="score-comparison-title">Three paths to failure</h2></div>
        <p role="status" aria-live="polite">{completed} / 18 specimens ready{completed < 18 ? " · Approach A takes longer to compute" : " · Select a specimen to inspect"}</p></div>
      <div className="score-stage-key">{LEVELS.map((level, i) => <div key={level}><span>{SCORE_STUDY.scores[i].toFixed(2)}</span><p>{level}</p></div>)}</div>
      {STRATEGIES.map(method => <article className="score-comparison-row" key={method.id} data-strategy={method.id}>
        <header><h3><span>{method.letter}</span>{method.title}</h3><p>{method.description}</p></header>
        <div className="score-samples">{SCORE_STUDY.scores.map(value => {
          const key = keyOf(method.id, value), sample = samples[key];
          return <button className="score-sample" key={key} data-key={key} data-ready={sample ? "true" : "false"}
            aria-label={`Inspect approach ${method.letter}, score ${value.toFixed(2)}`} aria-pressed={selected === key} onClick={() => choose(method.id, value)}>
            {sample ? <img src={sample.image} alt={`${method.title}: clay form at score ${value.toFixed(2)}`} width="360" height="480" />
              : <div className="score-sample-placeholder">{errors[key] ? "Computation failed" : "Generating…"}</div>}
            <span className="score-sample-score">{value.toFixed(2)}<span>{selected === key ? "Inspecting ↗" : "↗"}</span></span>
            {sample && <small>Omitted {(sample.shape.metrics.missingFraction * 100).toFixed(1)}% · Drop {sample.shape.metrics.maxDropMm.toFixed(1)} mm</small>}
          </button>;
        })}</div>
      </article>)}
    </section>
    <footer className="score-footer"><p>Shared input: a fixed nominal twisted vessel, one continuous 64-turn helix, seed 42. C strengthens the same deformation across the full score range; the columns sample a continuous progression.</p>
      <p>A compresses the base before score-driven changes. B and C use different form rules with bounded settling. Drop is measured from the nominal path; omitted samples are not hole area. None of these approaches is calibrated against physical clay.</p></footer>
  </main>;
}
