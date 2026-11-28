import {useMemo, useState} from 'react';
import {blankTrial, compareTrial, GROUPS, validateTrial} from './material/physicalTrials.ts';
import type {Group, PhysicalTrial} from './material/physicalTrials.ts';

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function PhysicalCalibration() {
  const [group, setGroup] = useState<Group>('stop-restart'), [trial, setTrial] = useState<PhysicalTrial | null>(null), [error, setError] = useState('');
  const comparison = useMemo(() => trial ? compareTrial(trial) : null, [trial]);
  return <section className="lab-card" data-testid="physical-calibration">
    <h2>4A · Physical material calibration preparation</h2>
    <p>Research plan only. No physical measurements are included. Export a planned trial, record actual observations with evidence, then import it here. Existing 2B records remain supported in the interface above.</p>
    <label>Physical experiment group<select value={group} onChange={e => setGroup(e.target.value as Group)}>{GROUPS.map(g => <option key={g}>{g}</option>)}</select></label>
    <p>80 mm horizontal line; stop/restart: one pass; span/time: two aligned passes with a centred lower interruption. Upper extrusion remains continuous. Template dimensions and feed are illustrative proposals pending machine review.</p>
    <button className="mx-button mx-outline" onClick={() => download(blankTrial(group), `${group}-planned.json`)}>Export 4A blank trial</button>
    <label>Import 4A trial JSON<input type="file" accept=".json,application/json" onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      try {if (file.size > 1000000) throw new Error('Trial exceeds 1 MB'); const next = validateTrial(JSON.parse(await file.text())); compareTrial(next); setTrial(next); setError('');}
      catch (err) {setTrial(null); setError(String(err));}
      e.target.value = '';
    }}/></label>
    {error && <p role="alert">{error}</p>}
    {trial && comparison && <><p data-testid="physical-status">Trial {trial.trialId}: {trial.status} · {trial.observations.length} physical observations</p>
      <p>Illustrative predictions recomputed from this trial’s conditions, independently of the 2B/2C controls. Residual = predicted − physical measurement. Uncertainty is measurement standard uncertainty, not model confidence. Unavailable means the method or sampled geometry cannot be compared.</p>
      <div className="lab-plot" tabIndex={0} aria-label="Physical comparison table"><table><thead><tr>{['Observation / metric', 'Physical (mm)', '± uncertainty (mm)', 'Time (s)', 'Predicted (mm)', 'Residual (mm)'].map(s => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>{comparison.rows.map(o => <tr key={o.id}><td>{o.id} / {o.metric}</td><td>{o.value}</td><td>{o.uncertaintyMm}</td><td>{o.timeS}</td><td>{o.predictedMm?.toFixed(4) ?? 'unavailable'}</td><td>{o.residualMm?.toFixed(4) ?? 'unavailable'}</td></tr>)}</tbody></table></div>
      <button className="mx-button mx-outline" onClick={() => download({trial, comparison}, '4A-comparison.json')}>Export raw trial and comparison</button>
      <details><summary>Raw record, conditions and source evidence</summary><pre>{JSON.stringify(trial, null, 2)}</pre></details>
    </>}
    <p className="mx-muted">Protocol and matrix: docs/MILESTONE_4A.md. Keep original JSON and media; imported records live only in this browser session. No automatic fitting or promotion to calibrated. No G-code export.</p>
  </section>;
}
