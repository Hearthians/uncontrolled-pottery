import {finite} from './calibrationTypes.ts';
import type {MaterialProfile} from './calibrationTypes.ts';
export type CalibrationRecord = {
  schemaVersion: '1.0'; units: 'mm,s,mm3/s,g,g/cm3'; experimentId: string; materialBatch: string; machineProfile: string;
  pathLengthMm: number; commandedFlowMm3S: number; clearanceMm: number; targetBeadWidthMm: number; densityGPerCm3: number | null;
  nozzleDiameterMm: number | null; travelSpeedMmS: number; nominalLayerHeightMm: number; commandedGapMm: number;
  measuredGapMm: number | null; measuredBeadWidthMm: number | null; measuredBeadHeightMm: number | null; measuredMassG: number | null;
  status: 'simulation-only' | 'measured';
  response: null | {steadyFlowMm3S: number; samples: {phase: 'startup' | 'shutdown'; secondsAfterCommand: number; measuredFlowMm3S: number}[]};
};
export function validateRecord(input: unknown): CalibrationRecord {
  if (!input || typeof input !== 'object') throw new Error('Expected calibration record');
  const r = input as CalibrationRecord;
  if (r.schemaVersion !== '1.0' || r.units !== 'mm,s,mm3/s,g,g/cm3' || !['simulation-only', 'measured'].includes(r.status)) throw new Error('Unsupported schema, status or units');
  for (const key of ['experimentId', 'materialBatch', 'machineProfile'] as const) if (typeof r[key] !== 'string' || !r[key].trim()) throw new Error(`Missing ${key}`);
  for (const key of ['nozzleDiameterMm', 'densityGPerCm3', 'measuredGapMm', 'measuredBeadWidthMm', 'measuredBeadHeightMm', 'measuredMassG'] as const) if (r[key] !== null) finite(r[key], key);
  if (r.nozzleDiameterMm !== null) finite(r.nozzleDiameterMm, 'Nozzle diameter mm', 0.001);
  if (r.densityGPerCm3 !== null) finite(r.densityGPerCm3, 'Density g/cm³', 0.001);
  for (const key of ['pathLengthMm', 'clearanceMm', 'targetBeadWidthMm'] as const) finite(r[key], key, 0.001);
  finite(r.commandedFlowMm3S, 'Commanded flow mm³/s');
  finite(r.travelSpeedMmS, 'Travel speed mm/s', 0.001); finite(r.nominalLayerHeightMm, 'Layer height mm', 0.001); finite(r.commandedGapMm, 'Commanded gap mm');
  if (r.response !== null) {
    if (!r.response || !Array.isArray(r.response.samples) || r.response.samples.length > 10000) throw new Error('Invalid response observations');
    finite(r.response.steadyFlowMm3S, 'Measured steady flow mm³/s', 0.001);
    const seen = new Set<string>();
    for (const s of r.response.samples) {
      if (!s || !['startup', 'shutdown'].includes(s.phase)) throw new Error('Invalid response phase');
      finite(s.secondsAfterCommand, 'Observation time s'); finite(s.measuredFlowMm3S, 'Measured flow mm³/s');
      const key = `${s.phase}:${s.secondsAfterCommand}`; if (seen.has(key)) throw new Error('Duplicate observation time'); seen.add(key);
    }
  }
  const measured = [r.measuredGapMm, r.measuredBeadWidthMm, r.measuredBeadHeightMm, r.measuredMassG].some(v => v !== null) || !!r.response?.samples.length;
  if ((r.status === 'simulation-only' && measured) || (r.status === 'measured' && !measured)) throw new Error('Measurement status conflicts with observations');
  return structuredClone(r);
}
export function fitResponse(record: CalibrationRecord) {
  const r = validateRecord(record), data = r.response;
  const unavailable = (reason: string) => ({profile: null, rmseMm3S: null, reason});
  if (!data) return unavailable('Gap, width or mass alone cannot identify rise time, fall time and transport delay. Provide measured step-response flow samples and a measured steady plateau.');
  const fits = (['startup', 'shutdown'] as const).map(phase => {
    const points = data.samples.filter(s => s.phase === phase).map(s => ({x: s.secondsAfterCommand, fraction: s.measuredFlowMm3S / data.steadyFlowMm3S})).filter(p => p.fraction > 0.05 && p.fraction < 0.95);
    if (points.length < 3 || Math.max(...points.map(p => p.fraction)) - Math.min(...points.map(p => p.fraction)) < 0.2) return null;
    const ys = points.map(p => Math.log(phase === 'startup' ? 1 - p.fraction : p.fraction));
    const mx = points.reduce((sum, p) => sum + p.x, 0) / points.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const xx = points.reduce((sum, p) => sum + (p.x - mx) ** 2, 0);
    if (xx === 0) return null;
    const slope = points.reduce((sum, p, i) => sum + (p.x - mx) * (ys[i] - my), 0) / xx, intercept = my - slope * mx;
    const error = points.reduce((sum, p, i) => sum + (ys[i] - slope * p.x - intercept) ** 2, 0);
    const variance = ys.reduce((sum, y) => sum + (y - my) ** 2, 0);
    if (slope >= 0 || variance === 0 || 1 - error / variance < 0.98) return null;
    return {tau: -1 / slope, delay: -intercept / slope};
  });
  if (fits.some(f => !f)) return unavailable('Insufficient transient coverage or poor exponential fit: need ≥3 distinct samples per phase spanning ≥20% of steady flow, with log-fit R² ≥0.98.');
  const [up, down] = fits as {tau: number; delay: number}[];
  if (Math.min(up.delay, down.delay) < -0.001 || Math.max(up.tau, down.tau, up.delay, down.delay) > 10 || Math.abs(up.delay - down.delay) > 0.05) return unavailable('Independent phase delays disagree or inferred parameters exceed the model bounds; a common transport delay is not justified.');
  const delaySeconds = Math.max(0, (up.delay + down.delay) / 2);
  const profile: MaterialProfile = {id: `fit-${r.experimentId}`, status: 'fitted-unvalidated', evidenceIds: [r.experimentId], startupSeconds: up.tau, shutdownSeconds: down.tau, delaySeconds, thresholdMm3S: 0.05};
  const squared = data.samples.map(s => {
    const t = Math.max(0, s.secondsAfterCommand - delaySeconds);
    const expected = data.steadyFlowMm3S * (s.phase === 'startup' ? 1 - Math.exp(-t / up.tau) : Math.exp(-t / down.tau));
    return (s.measuredFlowMm3S - expected) ** 2;
  });
  const rmseMm3S = Math.sqrt(squared.reduce((a, b) => a + b, 0) / squared.length);
  if (rmseMm3S > 0.05 * data.steadyFlowMm3S) return unavailable('Full-series residual exceeds 5% of measured steady flow; the low-order model does not explain these measurements.');
  return {profile, rmseMm3S, reason: 'Candidate fit only. Assumes isolated 0→steady and steady→0 steps, known command times and measured steady flow. Validate on held-out trials; threshold is not fitted.'};
}
export function compareMeasurements(r: CalibrationRecord, predicted: {gapMm: number | null; widthMm: number; heightMm: number; massG: number | null}) {
  return {gapErrorMm: r.measuredGapMm === null || predicted.gapMm === null ? null : predicted.gapMm - r.measuredGapMm,
    widthErrorMm: r.measuredBeadWidthMm === null ? null : predicted.widthMm - r.measuredBeadWidthMm,
    heightErrorMm: r.measuredBeadHeightMm === null ? null : predicted.heightMm - r.measuredBeadHeightMm,
    massErrorG: r.measuredMassG === null || predicted.massG === null ? null : predicted.massG - r.measuredMassG};
}
