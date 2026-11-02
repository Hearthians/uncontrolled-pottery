import { useEffect, useMemo, useRef, useState } from "react";
import { DepositionLab as Experiment, LAB_CASES, LAB_DT, labMetrics } from "./depositionLab";
import type { LabCase, LabSnapshot } from "./depositionLab";
import { LabSurface } from "./LabSurface";
import "./depositionLab.css";

export default function DepositionLab() {
  const [kind, setKind] = useState<LabCase>("single");
  const [clearance, setClearance] = useState(2);
  const [flow, setFlow] = useState(120);
  const [running, setRunning] = useState(false);
  const engine = useRef(new Experiment("single"));
  const [snapshot, setSnapshot] = useState<LabSnapshot>(() => engine.current.snapshot());
  const metrics = useMemo(() => labMetrics(snapshot), [snapshot]);
  const [hover, setHover] = useState<number | null>(null);

  function reset(nextKind = kind, nextClearance = clearance, nextFlow = flow) {
    setRunning(false); setKind(nextKind); setClearance(nextClearance); setFlow(nextFlow);
    engine.current = new Experiment(nextKind, { clearanceMm: nextClearance, feedMm3S: nextFlow });
    setSnapshot(engine.current.snapshot());
  }
  useEffect(() => {
    if (!running) return;
    let frame = 0, previous = performance.now(), budget = 0;
    const tick = (now: number) => {
      budget += Math.min(0.08, (now - previous) / 1000); previous = now;
      const steps = Math.min(16, Math.floor(budget / LAB_DT));
      if (steps) {
        engine.current.advanceTo(engine.current.tick + steps);
        budget -= steps * LAB_DT;
        setSnapshot(engine.current.snapshot());
      }
      if (engine.current.complete) setRunning(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  function download() {
    const data = {
      format: "clay-deposition-lab-1", model: "uncalibrated-2.5D-shallow-bingham", ...snapshot,
      height: Array.from(snapshot.height), layers: snapshot.layers.map((layer) => Array.from(layer)),
      metrics,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `clay-lab-${kind}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const maxHeight = Math.max(10, Math.ceil(metrics.peakMm / 5) * 5);
  const px = (z: number) => 44 + (z + 12) / 24 * 510;
  const py = (h: number) => 200 - h / maxHeight * 170;
  const path = metrics.profile.map((p, i) => `${i ? "L" : "M"}${px(p.zMm)},${py(p.heightMm)}`).join(" ");
  const selected = hover === null ? null : metrics.profile[hover];

  return <main className="clay-lab">
    <header className="lab-header"><a href={location.pathname}>← Print studio</a><span>LOCAL PHYSICS EXPERIMENT</span></header>
    <h1>Deposition, up close.</h1>
    <p className="lab-intro">Three small samples before a full vessel. No texture tricks, no independent tube meshes.</p>
    <div className="lab-cases" role="group" aria-label="Deposition experiment">
      {(Object.keys(LAB_CASES) as LabCase[]).map((id) => <button key={id} aria-pressed={kind === id} onClick={() => reset(id)}>{LAB_CASES[id].title}</button>)}
    </div>
    <div className="lab-layout">
      <section className="lab-view">
        <LabSurface snapshot={snapshot} />
        <div className="lab-caption"><span>{LAB_CASES[kind].description}</span><span>Drag to orbit · Scroll to zoom</span></div>
      </section>
      <aside className="lab-settings">
        <h2>Same material. Different deposition.</h2>
        <label>Nozzle clearance<select aria-label="Nozzle clearance" value={clearance} onChange={(e) => reset(kind, Number(e.target.value))}>
          {[1.5, 2, 3].map((n) => <option key={n} value={n}>{n} mm per pass</option>)}
        </select></label>
        <label>Supply<select aria-label="Supply" value={flow} onChange={(e) => reset(kind, clearance, Number(e.target.value))}>
          {[90, 120, 180].map((n) => <option key={n} value={n}>{n} mm³/s</option>)}
        </select></label>
        <p>6 mm nozzle · 10 mm/s travel<br />0.5 mm grid · 5 ms fixed step</p>
        <div className="lab-actions">
          <button className="lab-primary" onClick={() => {
            if (engine.current.complete) reset();
            setRunning(!running);
          }}>{running ? "Pause sample" : engine.current.complete ? "Replay sample" : "Run sample"}</button>
          <button onClick={() => { setRunning(false); engine.current.advanceTo(engine.current.endTick); setSnapshot(engine.current.snapshot()); }}>Complete sample</button>
          <button onClick={() => reset()}>Reset</button>
        </div>
        <p role="status">{(snapshot.tick * LAB_DT).toFixed(2)} / {(snapshot.endTick * LAB_DT).toFixed(2)} s · {engine.current.complete ? "Complete" : running ? "Depositing" : "Paused"}</p>
        <h3>What is being solved?</h3>
        <p>Conservative lateral volume transfer driven by gravity and a nozzle-pressure penalty, resisted by a Bingham yield threshold. Material remains in one supported height field.</p>
        <p><strong>Not CFD validation.</strong> No overhangs, internal cavities, elastic recovery or calibrated clay rheology. Contact continuity is assumed by this representation, not independently proven.</p>
      </aside>
    </div>
    <section className="lab-results">
      <div className="lab-section-heading"><div><h2>Center cross-section</h2><p>Blue line in the 3D view · at x = 0 mm · direct cell heights, unsmoothed</p></div><button onClick={download}>Download numerical record ↓</button></div>
      <div className="lab-results-grid">
        <div className="lab-plot">
          <svg viewBox="0 0 580 245" role="img" aria-label="Material height across the center section" tabIndex={0}
            onPointerMove={(e) => { const box = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - box.left) / box.width * 580; setHover(Math.max(0, Math.min(metrics.profile.length - 1, Math.round((x - 44) / 510 * (metrics.profile.length - 1))))); }}
            onPointerLeave={() => setHover(null)} onFocus={() => setHover(24)}
            onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setHover(Math.max(0, Math.min(metrics.profile.length - 1, (hover ?? 24) + (e.key === "ArrowRight" ? 1 : -1)))); } }}>
            {Array.from({ length: 6 }, (_, i) => i * maxHeight / 5).map((h) => <g key={h}><line x1="44" x2="554" y1={py(h)} y2={py(h)} className="lab-grid" /><text x="36" y={py(h) + 4} textAnchor="end">{h}</text></g>)}
            {[-12, -6, 0, 6, 12].map((z) => <text key={z} x={px(z)} y="220" textAnchor="middle">{z}</text>)}
            <text x="44" y="18">Height (mm)</text><text x="300" y="240" textAnchor="middle">Across the bead (mm)</text>
            <path d={`${path} L${px(metrics.profile.at(-1)!.zMm)},200 L${px(metrics.profile[0].zMm)},200 Z`} className="lab-area" />
            <path d={path} className="lab-profile" />
            {selected && <g><line x1={px(selected.zMm)} x2={px(selected.zMm)} y1="30" y2="200" className="lab-crosshair" /><circle cx={px(selected.zMm)} cy={py(selected.heightMm)} r="4" className="lab-point" /></g>}
          </svg>
          <p className="lab-readout">{selected ? `z ${selected.zMm.toFixed(2)} mm · height ${selected.heightMm.toFixed(3)} mm` : "Hover or use arrow keys to inspect the cross-section."}</p>
        </div>
        <dl className="lab-measures">
          <div><dt>Deposited volume</dt><dd>{metrics.volumeMm3.toFixed(1)} <small>mm³</small></dd></div>
          <div><dt>Volume balance error</dt><dd data-testid="volume-error">{Math.abs(metrics.massErrorPercent).toExponential(2)} <small>%</small></dd></div>
          <div><dt>Center bead width</dt><dd>{metrics.widthMm.toFixed(2)} <small>mm</small></dd></div>
          <div><dt>Peak height</dt><dd>{metrics.peakMm.toFixed(2)} <small>mm</small></dd></div>
        </dl>
      </div>
      <details><summary>Cross-section data table</summary><div className="lab-table-scroll"><table><thead><tr><th>z (mm)</th><th>Total height (mm)</th>{snapshot.layers.map((_, i) => <th key={i}>Pass {i + 1} amount (mm)</th>)}</tr></thead><tbody>
        {metrics.profile.map((point) => <tr key={point.zMm}><td>{point.zMm.toFixed(2)}</td><td>{point.heightMm.toFixed(4)}</td>{point.layersMm.map((h, i) => <td key={i}>{h.toFixed(4)}</td>)}</tr>)}
      </tbody></table></div></details>
    </section>
    <footer className="lab-notes"><h2>Acceptance is still open</h2><p>Mass conservation and visible differences are implementation checks, not proof of wet-clay realism. Compare measured strand width, compressed layer interfaces and restart profiles before moving this model into the studio.</p>
      <p><a href="https://keep-art.co.uk/guide-to-clay-3d-printing" target="_blank" rel="noreferrer">Clay-printing practice ↗</a> · <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11902750/" target="_blank" rel="noreferrer">Free-surface deposition study (not clay) ↗</a></p>
    </footer>
  </main>;
}
