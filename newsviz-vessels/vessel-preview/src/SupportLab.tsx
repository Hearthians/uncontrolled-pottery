import {useEffect, useMemo, useState} from 'react';
import {SUPPORT_EXPERIMENTS, supportExperiment} from './material/supportExperiments.ts';
import {buildSupportHistory, materialAt} from './material/supportHistory.ts';
import {SAG_PARAMETERS} from './material/reactiveSagging.ts';

export default function SupportLab() {
  const [id, setId] = useState('bridge'), [time, setTime] = useState(20), [playing, setPlaying] = useState(false);
  const result = useMemo(() => {const experiment = supportExperiment(id); return {...experiment, history: buildSupportHistory(experiment.material, experiment.settings.clearanceMm)};}, [id]);
  useEffect(() => {setPlaying(false); setTime(result.durationS);}, [result]);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now(), initial = time;
    let frame = 0;
    const tick = () => {const next = Math.min(result.durationS, initial + (performance.now() - start) / 1000); setTime(next); if (next < result.durationS) frame = requestAnimationFrame(tick); else setPlaying(false);};
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
    // The clock only selects analytical history states; it never integrates deformation.
  }, [playing, result]);
  const visible = result.history.elements.filter(e => e.depositionTimeS <= time);
  const states = visible.map(e => materialAt(e, time));
  const length = visible.reduce((sum, e) => sum + e.source.lengthMm, 0);
  const coverage = visible.reduce((sum, e) => sum + e.coverage * e.source.lengthMm, 0) / (length || 1);
  const maxSag = Math.max(0, ...states.map(s => s.sagMm));
  return <section className="lab-card" data-testid="support-lab" data-sag={maxSag} data-time={time}>
    <h2>2C · Support and reactive sagging</h2>
    <p>Computational predictions under illustrative assumptions, not validated clay behavior. These fixed experiments are independent of the 2B controls above.</p>
    <label htmlFor="support-experiment">Support experiment</label><select id="support-experiment" value={id} onChange={e => setId(e.target.value)}>{SUPPORT_EXPERIMENTS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
    <p className="mx-muted">{id === 'residual' ? 'Default 2B response: 0.15 s startup, 0.25 s shutdown, 0.05 s delay. Residual beads remain material.' : 'Synthetic instantaneous delivery isolates support effects; this is not a measured response profile.'} 40 mm passes · 20 mm/s · 2 × 1 mm target section · {id === 'stable' ? 'continuous lower layer.' : id === 'overhang' ? 'lower interruption from 12 mm to the end.' : '16 mm lower interruption.'}</p>
    <div className="lab-plot" tabIndex={0} aria-label="Scrollable support comparison"><svg viewBox="0 0 800 480" role="img" aria-label="Ideal, initial predicted and support-aware deformed bead envelopes">
      {[0, 1, 2].map(row => <g key={row}>
        <text x="45" y={25 + row * 155}>{['IDEAL · requested deposition', 'INITIAL · predicted deposited material', 'DEFORMED · support history'][row]}</text>
        <path d={`M45 ${140 + row * 155}H755`} stroke="#777"/>
        {row === 0 ? result.commands.filter(c => c.kind === 'deposit' && c.feedMm3S > 0 && c.endTimeS <= time).map((c, i) => <rect key={i} x={45 + c.start[0] * 17.75} y={140 - c.layerId * 28} width={(c.end[0] - c.start[0]) * 17.75} height="28" fill="#b4b4a5"/>) : visible.map((e, i) => {
          const centre = row === 1 ? e.initialPosition[2] : states[i].position[2];
          return <rect key={i} x={45 + e.source.start[0] * 17.75} y={140 + row * 155 - (centre + e.heightMm / 2) * 28} width={e.source.lengthMm * 17.75} height={e.heightMm * 28} fill={row === 1 ? '#b18b70' : e.coverage >= SAG_PARAMETERS.supportedFraction ? '#708064' : '#b55a3f'}/>;
        })}
      </g>)}
    </svg></div>
    <p className="mx-muted">Side elevation, Z exaggerated relative to X. Green: supported at deposition; clay red: deficient support. Geometry is retained at all positive delivered volumes. Contact is not adhesion. Each element appears at its flow-bin end.</p>
    <div className="lab-controls"><button onClick={() => {if (time >= result.durationS) setTime(0); setPlaying(!playing);}}>{playing ? 'Pause support' : 'Play support'}</button><button onClick={() => {setPlaying(false); setTime(0);}}>Reset support</button><input aria-label="Support time" type="range" min="0" max={result.durationS} step="0.01" value={time} onChange={e => {setPlaying(false); setTime(Number(e.target.value));}}/></div>
    <dl className="mx-specs">
      <div><dt>Simulation time</dt><dd>{time.toFixed(2)} s</dd></div><div><dt>Support coverage at deposition</dt><dd>{(coverage * 100).toFixed(1)}%</dd></div>
      <div><dt>Maximum downward displacement</dt><dd>{maxSag.toFixed(3)} mm</dd></div><div><dt>Maximum unsupported span estimate</dt><dd>{Math.max(0, ...visible.map(e => e.spanMm)).toFixed(1)} mm</dd></div>
      <div><dt>Oldest material</dt><dd>{Math.max(0, ...states.map(s => s.ageS)).toFixed(2)} s</dd></div><div><dt>History changes support</dt><dd>{visible.filter(e => Math.abs(e.coverage - e.idealCoverage) > 1e-8).length} elements</dd></div>
    </dl>
    <p className="mx-muted">Deposited {result.material.ledger.depositedMm3.toFixed(3)} mm³ · separate ooze {result.material.ledger.oozeMm3.toFixed(3)} mm³ · ledger discrepancy {result.material.ledger.discrepancyMm3.toExponential(1)} mm³. Sagging translates sections without changing their volume.</p>
    <details><summary>Illustrative parameters and limits</summary><p>Compliance proxy {SAG_PARAMETERS.compliancePerMm} /mm; relaxation {SAG_PARAMETERS.relaxationS} s; maximum sag {SAG_PARAMETERS.maxSagMm} mm, also bounded by the substrate. No density, mass or force is inferred. Contact tolerance {SAG_PARAMETERS.contactToleranceMm} mm; supported fraction {SAG_PARAMETERS.supportedFraction}; 3 × 5 footprint samples; anchor search step {SAG_PARAMETERS.probeStepMm} mm, reach {SAG_PARAMETERS.searchMm} mm per side; spatial hash {SAG_PARAMETERS.cellMm} mm. Unfound anchors use the search limit, so isolated/overhang spans are capped estimates. Support targets are fixed at deposition; lower sections are evaluated at their current age for each later event. Bridge means two available lower anchors, not verified adhesion or a completed upper connection. No fracture, compression, changing stiffness, collision resolution or physical strength prediction.</p></details>
  </section>;
}
