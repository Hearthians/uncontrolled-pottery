import {finite, validateProfile} from './calibrationTypes.ts';
import type {FlowBin, MaterialProfile, MotionCommand} from './calibrationTypes.ts';

export function responseStep(q: number, target: number, seconds: number, tau: number) {
  if (tau === 0) return {flow: target, volume: target * seconds};
  const oneMinusDecay = -Math.expm1(-seconds / tau);
  return {flow: q + (target - q) * oneMinusDecay, volume: target * seconds + (q - target) * tau * oneMinusDecay};
}
export function simulateResponse(input: readonly MotionCommand[], profile: MaterialProfile, dtS = 0.02) {
  validateProfile(profile); finite(dtS, 'Sample step seconds', 0.001, 0.2);
  if (!input.length || input.length > 100000) throw new Error('Invalid command count');
  input.forEach((m, i) => {
    finite(m.feedMm3S, 'Command feed mm³/s'); finite(m.startTimeS, 'Start seconds'); finite(m.endTimeS, 'End seconds');
    if (m.endTimeS <= m.startTimeS || m.startTimeS !== (i ? input[i - 1].endTimeS : 0) || !['deposit', 'travel'].includes(m.kind) || !Number.isInteger(m.layerId) || m.layerId < 1) throw new Error('Invalid ordered command timeline');
    for (const p of [m.start, m.end]) if (!Array.isArray(p) || p.length !== 3 || p.some(v => !Number.isFinite(v))) throw new Error('Invalid nozzle position');
    if (i && m.start.some((v, k) => Math.abs(v - input[i - 1].end[k]) > 1e-8)) throw new Error('Disconnected motion');
  });
  const last = input.at(-1)!, end = last.endTimeS;
  const durationS = end + profile.delaySeconds + Math.max(0.1, 8 * profile.shutdownSeconds);
  if (durationS / dtS + input.length * 4 > 250000) throw new Error('Simulation sample budget exceeded');
  const tail: MotionCommand = {startTimeS: end, endTimeS: durationS, start: last.end, end: last.end, layerId: last.layerId, kind: 'travel', feedMm3S: 0};
  const commands = [...input, tail];
  const at = (time: number) => {
    if (time < 0 || time >= durationS) return undefined;
    let lo = 0, hi = commands.length - 1;
    while (lo < hi) {const mid = (lo + hi) >>> 1; if (commands[mid].endTimeS <= time) lo = mid + 1; else hi = mid;}
    return commands[lo];
  };
  const boundaries = new Set([0, durationS, ...commands.flatMap(m => [m.startTimeS, m.endTimeS]), ...input.flatMap(m => [m.startTimeS + profile.delaySeconds, m.endTimeS + profile.delaySeconds])]);
  for (let t = dtS; t < durationS; t += dtS) boundaries.add(t);
  const times = [...boundaries].filter(t => t <= durationS).sort((a, b) => a - b);
  const bins: FlowBin[] = []; let q = 0;
  for (let i = 1; i < times.length; i++) {
    const start = times[i - 1], end = times[i]; if (end - start < 1e-10) continue;
    const m = at((start + end) / 2)!, target = at((start + end) / 2 - profile.delaySeconds)?.feedMm3S ?? 0;
    const tau = target > q ? profile.startupSeconds : profile.shutdownSeconds;
    const initial = tau === 0 ? target : q;
    const result = responseStep(initial, target, end - start, tau);
    const cuts = [start, end], threshold = profile.thresholdMm3S;
    if (tau > 0 && (initial - threshold) * (result.flow - threshold) < 0) cuts.splice(1, 0, start - tau * Math.log((threshold - target) / (initial - target)));
    const position = (t: number) => m.start.map((v, k) => v + (m.end[k] - v) * Math.max(0, Math.min(1, (t - m.startTimeS) / (m.endTimeS - m.startTimeS)))) as unknown as MotionCommand['start'];
    for (let j = 1; j < cuts.length; j++) {
      const a = cuts[j - 1], b = cuts[j], flowStart = responseStep(initial, target, a - start, tau).flow;
      const part = responseStep(flowStart, target, b - a, tau);
      bins.push({startTimeS: a, endTimeS: b, start: position(a), end: position(b), command: m,
        requestedMm3S: m.feedMm3S, delayedMm3S: target, flowStartMm3S: flowStart, flowEndMm3S: part.flow,
        volumeMm3: Math.max(0, part.volume), belowThreshold: responseStep(flowStart, target, (b - a) / 2, tau).flow <= threshold});
    }
    q = result.flow;
  }
  const deliveredMm3 = bins.reduce((sum, b) => sum + b.volumeMm3, 0);
  return {bins, durationS, requestedMm3: input.reduce((sum, m) => sum + m.feedMm3S * (m.endTimeS - m.startTimeS), 0), deliveredMm3,
    terminalFlowMm3S: q, futureTailMm3: q * profile.shutdownSeconds};
}
