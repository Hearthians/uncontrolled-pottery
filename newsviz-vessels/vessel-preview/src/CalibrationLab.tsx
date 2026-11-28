import {useEffect, useMemo, useState} from 'react';
import SupportLab from './SupportLab.tsx';
import PhysicalCalibration from './PhysicalCalibration.tsx';
import {LAB_SETTINGS, LAB_EXPERIMENTS, ILLUSTRATIVE_PROFILE, experimentCommands} from './material/calibrationProfiles.ts';
import {validateSettings, validateProfile} from './material/calibrationTypes.ts';
import type {LabSettings, MaterialProfile} from './material/calibrationTypes.ts';
import {simulateResponse, responseStep} from './material/extrusionResponse.ts';
import {beadDeposition} from './material/beadDeposition.ts';
import {depositionDiagnostics} from './material/depositionDiagnostics.ts';
import {validateRecord, fitResponse, compareMeasurements} from './material/measurements.ts';
import type {CalibrationRecord} from './material/measurements.ts';
import './styles.css';
import './calibration.css';

const fields: [keyof LabSettings, string, number, number][] = [
  ['lengthMm', 'Path length (mm)', 25, 200], ['speedMmS', 'Travel speed (mm/s)', 1, 100], ['feedMm3S', 'Requested feed (mm³/s)', 0, 500],
  ['nozzleDiameterMm', 'Nozzle inner diameter (mm; unknown if blank)', 0.1, 20], ['clearanceMm', 'Nozzle clearance (mm)', 0.1, 10],
  ['widthMm', 'Target bead width (mm)', 0.1, 20], ['heightMm', 'Target layer height (mm)', 0.1, 10], ['densityGPerCm3', 'Measured density (g/cm³; blank if unknown)', 0.1, 10],
];
const responseFields: [keyof MaterialProfile, string][] = [['startupSeconds', 'Startup response (s)'], ['shutdownSeconds', 'Shutdown response (s)'], ['delaySeconds', 'Transport delay (s)'], ['thresholdMm3S', 'Gap detection threshold (mm³/s)']];
const fmt = (n: number | null, digits = 2) => n === null ? 'unmeasured / unavailable' : n.toFixed(digits);
const base = import.meta.env.BASE_URL;

export default function CalibrationLab() {
  const [id, setId] = useState('gap-10'), [settings, setSettings] = useState<LabSettings>(LAB_SETTINGS), [profile, setProfile] = useState<MaterialProfile>(ILLUSTRATIVE_PROFILE);
  const [error, setError] = useState(''), [record, setRecord] = useState<CalibrationRecord | null>(null);
  const [elapsed, setElapsed] = useState(0), [playing, setPlaying] = useState(false);
  const result = useMemo(() => {
    const commands = experimentCommands(id, settings), response = simulateResponse(commands, profile);
    const material = beadDeposition(response, settings), diagnostics = depositionDiagnostics(commands, material, profile);
    return {commands, response, material, diagnostics};
  }, [id, settings, profile]);
  const {commands, response, material, diagnostics} = result, duration = response.durationS;
  useEffect(() => {setPlaying(false); setElapsed(duration);}, [result, duration]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {const delta = Math.min(0.1, (now - previous) / 1000); previous = now; setElapsed(t => Math.min(duration, t + delta)); frame = requestAnimationFrame(tick);};
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  useEffect(() => {if (elapsed >= duration) setPlaying(false);}, [elapsed, duration]);
  const current = response.bins.find(b => b.endTimeS > elapsed) ?? response.bins.at(-1)!;
  const fraction = Math.max(0, Math.min(1, (elapsed - current.startTimeS) / (current.endTimeS - current.startTimeS)));
  const nozzle = current.start.map((v, k) => v + (current.end[k] - v) * fraction);
  const currentFlow = responseStep(current.flowStartMm3S, current.delayedMm3S, (current.endTimeS - current.startTimeS) * fraction, current.delayedMm3S > current.flowStartMm3S ? profile.startupSeconds : profile.shutdownSeconds).flow;
  const x = (mm: number) => 45 + mm / settings.lengthMm * 710;
  const sy = Math.min(130 / Math.max(5, settings.heightMm * 3 + settings.clearanceMm, ...material.segments.map(s => s.baseZMm + s.heightMm)), 70 / Math.max(2, ...material.segments.map(s => s.widthMm)));
  const maxFlow = Math.max(1, ...response.bins.map(b => Math.max(b.requestedMm3S, b.flowEndMm3S)));
  const tx = (t: number) => 45 + t / duration * 710, fy = (q: number) => 185 - q / maxFlow * 145;
  const flowPath = response.bins.map(b => `M${tx(b.startTimeS)},${fy(b.flowStartMm3S)} L${tx(b.endTimeS)},${fy(b.flowEndMm3S)}`).join(' ');
  const requestPath = response.bins.map(b => `M${tx(b.startTimeS)},${fy(b.requestedMm3S)} H${tx(b.endTimeS)}`).join(' ');
  const gap = diagnostics.gaps[0];
  const stable = material.segments.filter(s => s.deposited && s.command.layerId === 1 && s.start[0] >= settings.lengthMm * 0.8);
  const stableLength = stable.reduce((sum, s) => sum + s.lengthMm, 0);
  const mean = (key: 'widthMm' | 'heightMm') => stable.reduce((sum, s) => sum + s[key] * s.lengthMm, 0) / (stableLength || 1);
  const actualFeed = settings.feedMm3S * LAB_EXPERIMENTS.find(e => e.id === id)!.ratio;
  const matched = record && record.pathLengthMm === settings.lengthMm && record.commandedFlowMm3S === actualFeed && record.clearanceMm === settings.clearanceMm && record.targetBeadWidthMm === settings.widthMm && record.nozzleDiameterMm === settings.nozzleDiameterMm && record.densityGPerCm3 === settings.densityGPerCm3 && record.experimentId === id && record.travelSpeedMmS === settings.speedMmS && record.nominalLayerHeightMm === settings.heightMm && record.commandedGapMm === (gap?.commandedGapMm ?? 0);
  const residuals = matched ? compareMeasurements(record, {gapMm: gap?.thresholdGapMm ?? null, widthMm: mean('widthMm'), heightMm: mean('heightMm'), massG: material.ledger.depositedMassG}) : null;
  const fit = record ? fitResponse(record) : null;
  const exportRecord = () => {
    const template: CalibrationRecord = {schemaVersion: '1.0', units: 'mm,s,mm3/s,g,g/cm3', experimentId: id, materialBatch: 'unmeasured', machineProfile: 'unconfigured', nozzleDiameterMm: settings.nozzleDiameterMm,
      pathLengthMm: settings.lengthMm, commandedFlowMm3S: actualFeed, clearanceMm: settings.clearanceMm, targetBeadWidthMm: settings.widthMm, densityGPerCm3: settings.densityGPerCm3,
      travelSpeedMmS: settings.speedMmS, nominalLayerHeightMm: settings.heightMm, commandedGapMm: gap?.commandedGapMm ?? 0,
      measuredGapMm: null, measuredBeadWidthMm: null, measuredBeadHeightMm: null, measuredMassG: null, status: 'simulation-only', response: null};
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], {type: 'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = `${id}-measurement.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="memory-experience calibration">
    <header className="mx-header"><a href={base} className="mx-brand">GRAMMAR OF FAILURE</a><span>RESEARCH / MATERIAL CALIBRATION</span><a href={base}>Return to vessel</a></header>
    <main><section className="mx-intro"><div><span className="mx-eyebrow">MILESTONES 2B + 2C / INDEPENDENT LAB</span><h1>Flow, <em>then form.</em></h1><p>Commanded feed → delayed response → delivered volume → approximate bead. Illustrative simulation; no physical calibration. Support and sagging experiments follow below.</p></div></section>
    <div className="lab-layout"><aside className="lab-card"><h2>Controlled experiment</h2>
      <label htmlFor="lab-case">Experiment</label><select id="lab-case" value={id} onChange={e => setId(e.target.value)}>{LAB_EXPERIMENTS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
      <form onSubmit={e => {e.preventDefault(); try {
        const data = new FormData(e.currentTarget), next = {...settings}, nextProfile = {...profile, status: 'illustrative' as const, evidenceIds: []};
        for (const [key] of fields) {const value = String(data.get(key)); (next as unknown as Record<string, number | null>)[key] = value === '' ? null : Number(value);}
        nextProfile.id = String(data.get('profileId'));
        for (const [key] of responseFields) (nextProfile as unknown as Record<string, unknown>)[key] = Number(data.get(key));
        validateSettings(next); validateProfile(nextProfile); simulateResponse(experimentCommands(id, next), nextProfile);
        setSettings(next); setProfile(nextProfile); setError('');
      } catch (e) {setError(String(e));}}}>
        {fields.map(([key, label, min, max]) => <label key={key}>{label}<input name={key} type="number" step="any" min={min} max={max} required={!['nozzleDiameterMm', 'densityGPerCm3'].includes(key)} defaultValue={settings[key] ?? ''}/></label>)}
        <h3>Illustrative response profile</h3><label>Material profile ID<input name="profileId" defaultValue={profile.id} required/></label>
        {responseFields.map(([key, label]) => <label key={key}>{label}<input name={key} type="number" step="any" min="0" max={key === 'thresholdMm3S' ? 1000000 : 10} required defaultValue={Number(profile[key])}/></label>)}
        <button className="mx-button mx-primary" type="submit">Apply settings</button>
      </form><p className="mx-muted">Ellipse target area: {(Math.PI * settings.widthMm * settings.heightMm / 4).toFixed(3)} mm². Nominal Q = A × v. Diameter is not bead width; clearance is recorded, with no squeeze model.</p>
    </aside><section className="lab-results">
      {error && <p role="alert" className="lab-card">{error}</p>}
      <div className="lab-card"><div className="lab-status" data-testid="lab-status" data-time={elapsed} data-nozzle={JSON.stringify(nozzle)} data-flow={currentFlow} data-command={current.requestedMm3S}>
        <span>{elapsed.toFixed(2)} / {duration.toFixed(2)} s</span><span>Command: {current.requestedMm3S > 0 ? 'ON' : 'OFF'} · {current.requestedMm3S.toFixed(2)} mm³/s</span><span>Predicted: {currentFlow.toFixed(2)} mm³/s</span>
      </div>
      <div className="lab-plot" tabIndex={0} aria-label="Scrollable bead views"><svg viewBox="0 0 800 330" role="img" aria-label="Deposited bead side and plan views with moving nozzle">
        <text x="45" y="20">SIDE ELEVATION · bead envelope (mm)</text><path d="M45 185H755" stroke="#73766d"/>
        {material.segments.filter(s => s.deposited && s.startTimeS < elapsed && s.volumeMm3 > 0).map((s, i) => {
          const f = Math.min(1, (elapsed - s.startTimeS) / (s.endTimeS - s.startTimeS)), width = (x(s.end[0]) - x(s.start[0])) * f;
          return <g key={i}><rect shapeRendering="crispEdges" x={x(s.start[0])} y={185 - (s.baseZMm + s.heightMm) * sy} width={Math.max(0, width)} height={s.heightMm * sy} fill={s.command.layerId % 2 ? '#a94f35' : '#c87e57'}/>
            <rect shapeRendering="crispEdges" x={x(s.start[0])} y={250 - s.widthMm * sy / 2} width={Math.max(0, width)} height={s.widthMm * sy} fill="#a94f35"/></g>;
        })}
        {commands.filter(m => m.kind === 'deposit' && m.feedMm3S === 0).map((m, i) => <g key={i}><path d={`M${x(m.start[0])} 35V195 M${x(m.end[0])} 35V195`} stroke="#9d5140" strokeDasharray="3 4"/><text x={x(m.start[0])} y="32">stop</text><text x={x(m.end[0])} y="48">restart</text><path d={`M${x(m.start[0])} 305H${x(m.end[0])}`} stroke="#555" strokeWidth="4"/></g>)}
        {material.segments.filter(s => s.deposited && s.belowThreshold).map((s, i) => <path key={i} d={`M${x(s.start[0])} 315H${x(s.end[0])}`} stroke="#b87436" strokeWidth="4"/>)}
        <path d={`M${x(nozzle[0]) - 5} ${185 - nozzle[2] * sy - 18}h10v13l-5 5l-5 -5Z`} fill="#33372f"/>
        <text x="45" y="215">PLAN VIEW · width estimate</text><text x="45" y="295">Gap markers: grey commanded / amber below detection threshold</text>
        <text x="45" y="326">0 mm</text><text x="705" y="326">{settings.lengthMm} mm</text>
      </svg></div>
      <div className="lab-controls"><button className="mx-button mx-primary" onClick={() => {if (elapsed >= duration) setElapsed(0); setPlaying(!playing);}}>{playing ? 'Pause lab' : 'Play lab'}</button><button onClick={() => {setPlaying(false); setElapsed(0);}}>Reset lab</button><input aria-label="Lab time" type="range" min="0" max={duration} step="0.001" value={elapsed} onChange={e => {setPlaying(false); setElapsed(Number(e.target.value));}}/></div>
      <p className="mx-muted">Scroll plots horizontally on narrow screens. All delivered material is retained in the ledger, including traces below the gap threshold. Travel/terminal ooze is recorded separately; the bead views show intended-path deposition. Section estimates use the bin-average volume and a fixed ellipse aspect ratio.</p>
      </div>
      <div className="lab-card"><h2>Commanded and predicted flow</h2><div className="lab-plot" tabIndex={0} aria-label="Scrollable flow graph"><svg viewBox="0 0 800 220" role="img" aria-label="Commanded versus predicted flow over time">
        <path d="M45 30V185H755" fill="none" stroke="#aaa"/><path d={requestPath} stroke="#73766d" strokeWidth="2" fill="none"/><path d={flowPath} stroke="#a94f35" strokeWidth="2" fill="none"/>
        <path d={`M${tx(elapsed)} 30V185`} stroke="#333" strokeDasharray="3 4"/><text x="45" y="20">mm³/s · grey commanded / clay predicted</text><text x="5" y="45">{maxFlow.toFixed(1)}</text><text x="20" y="185">0</text><text x="45" y="210">0 s</text><text x="700" y="210">{duration.toFixed(2)} s</text>
      </svg></div></div>
      <div className="lab-card"><h2>Flow and volume ledger</h2><p className="mx-muted">Complete-experiment totals, including the observed terminal ooze.</p><dl className="mx-specs">
        <div><dt>Requested feed volume</dt><dd>{fmt(material.ledger.requestedMm3)} <small>mm³</small></dd></div><div><dt>Predicted nozzle-delivered</dt><dd>{fmt(material.ledger.deliveredMm3)} <small>mm³</small></dd></div>
        <div><dt>Intended-path deposited</dt><dd data-testid="lab-deposited">{fmt(material.ledger.depositedMm3)} <small>mm³</small></dd></div><div><dt>Travel / terminal ooze</dt><dd>{fmt(material.ledger.oozeMm3)} <small>mm³</small></dd></div>
        <div><dt>Ledger discrepancy</dt><dd data-testid="ledger-error">{material.ledger.discrepancyMm3.toExponential(2)} <small>mm³</small></dd></div><div><dt>Future tail beyond observation</dt><dd>{fmt(material.ledger.futureTailMm3, 5)} <small>mm³</small></dd></div>
        <div><dt>Steady-region width / height</dt><dd>{fmt(mean('widthMm'))} / {fmt(mean('heightMm'))} <small>mm</small></dd></div><div><dt>Mean volume / path length</dt><dd>{fmt(material.ledger.depositedMm3 / (settings.lengthMm * LAB_EXPERIMENTS.find(e => e.id === id)!.layers), 3)} <small>mm³/mm</small></dd></div>
      </dl><p className="mx-muted">Profile {profile.id}: {profile.status}. Requested − delivered = {fmt(material.ledger.requestedMinusDeliveredMm3)} mm³; requests are not a conserved physical supply. No pressure reservoir is modeled. Predicted deposited mass: {fmt(material.ledger.depositedMassG)} g.</p></div>
      <div className="lab-card"><h2>Gap and contact diagnostics</h2>{gap ? <dl className="mx-specs">
        <div><dt>Commanded interruption</dt><dd>{fmt(gap.commandedGapMm)} <small>mm</small></dd></div><div><dt>Predicted threshold-defined gap</dt><dd data-testid="realized-gap">{fmt(gap.thresholdGapMm)} <small>mm</small></dd></div>
        <div><dt>Delivery during commanded stop</dt><dd>{fmt(gap.residualAfterStopMm3)} <small>mm³</small></dd></div><div><dt>Restart delivery deficit</dt><dd>{fmt(gap.restartDeficitMm3)} <small>mm³</small></dd></div>
        <div><dt>Restart to above threshold</dt><dd>{fmt(gap.restartDelayMm)} <small>mm</small></dd></div><div><dt>Restart to 95% flow</dt><dd>{fmt(gap.transitionMm)} <small>mm</small></dd></div>
      </dl> : <p>No internal commanded interruption in this experiment.</p>}
      <p className="mx-muted">An exponential tail is not an exact zero-flow gap. Detection threshold: {profile.thresholdMm3S} mm³/s; short interruptions may produce no detectable gap. Width/height diagnostics average the final 20% of layer 1.</p>
      {diagnostics.contact.map(c => <p key={c.layerId} className="mx-muted">Layer {c.layerId}: projected overlap {(c.overlapFraction * 100).toFixed(1)}%; nominal contact {(c.contactFraction * 100).toFixed(1)}% (vertical separation ≤0.01 mm). Geometry only, not adhesion. Ellipse sections may geometrically intersect; no compression or material redistribution is solved.</p>)}
      </div>
      <div className="lab-card"><h2>Physical measurement interface</h2><p className="mx-muted">No physical observations supplied. Export a blank record or import a version 1.0 JSON record. Step-response fitting requires measured steady flow and startup/shutdown samples; a gap length alone cannot identify the model.</p>
        <button className="mx-button mx-outline" onClick={exportRecord}>Export blank measurement JSON</button>
        <label>Import measurement JSON<input type="file" accept=".json,application/json" onChange={async e => {const file = e.target.files?.[0]; if (!file) return; try {if (file.size > 1000000) throw new Error('Measurement file exceeds 1 MB'); setRecord(validateRecord(JSON.parse(await file.text()))); setError('');} catch (e) {setError(String(e));}}}/></label>
        {record && <><p data-testid="measurement-status">Record {record.experimentId}: {record.status}</p><p>{matched ? 'Residuals = predicted − measured.' : 'Match the recorded experiment and all test conditions before comparing outcomes.'}</p>{residuals && <pre>{JSON.stringify(residuals, null, 2)}</pre>}<p>{fit?.reason}</p>{fit?.profile && <pre>{JSON.stringify(fit, null, 2)}</pre>}</>}
      </div>
    </section></div><SupportLab/><PhysicalCalibration/><p className="mx-method">SIMULATION ONLY · Illustrative response times · No machine-specific instructions · Fixed vessel and concern policy unchanged</p></main>
  </div>;
}
