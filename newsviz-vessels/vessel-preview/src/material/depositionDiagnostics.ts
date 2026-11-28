import type {MotionCommand, MaterialProfile} from './calibrationTypes.ts';
import type {beadDeposition} from './beadDeposition.ts';
export function depositionDiagnostics(commands: MotionCommand[], material: ReturnType<typeof beadDeposition>, profile: MaterialProfile) {
  const segments = material.segments;
  const gaps = commands.flatMap((m, i) => {
    if (m.kind !== 'deposit' || m.feedMm3S !== 0 || !commands[i - 1]?.feedMm3S || !commands[i + 1]?.feedMm3S) return [];
    const restart = commands[i + 1], speed = Math.hypot(...m.end.map((v, k) => v - m.start[k])) / (m.endTimeS - m.startTimeS);
    const region = segments.filter(s => s.startTimeS >= m.startTimeS - 1e-9 && s.endTimeS <= restart.endTimeS + 1e-9);
    const below = region.filter(s => s.belowThreshold);
    const stable = region.find(s => s.startTimeS >= restart.startTimeS && s.flowEndMm3S >= 0.95 * restart.feedMm3S);
    const first = region.find(s => s.startTimeS >= restart.startTimeS && !s.belowThreshold);
    return [{commandedGapMm: speed * (m.endTimeS - m.startTimeS),
      thresholdGapMm: below.reduce((sum, s) => sum + s.lengthMm, 0),
      residualAfterStopMm3: region.filter(s => s.endTimeS <= m.endTimeS + 1e-9).reduce((sum, s) => sum + s.volumeMm3, 0),
      restartDeficitMm3: region.filter(s => s.startTimeS >= restart.startTimeS - 1e-9).reduce((sum, s) => sum + Math.max(0, restart.feedMm3S * (s.endTimeS - s.startTimeS) - s.volumeMm3), 0),
      restartDelayMm: first ? Math.max(0, first.startTimeS - restart.startTimeS) * speed : null,
      transitionMm: stable ? (stable.endTimeS - restart.startTimeS) * speed : null,
      thresholdMm3S: profile.thresholdMm3S}];
  });
  const contact = [1, 2, 3].map(layerId => {
    const upper = segments.filter(s => s.deposited && s.command.layerId === layerId);
    const lower = segments.filter(s => s.deposited && s.command.layerId === layerId - 1);
    let contactMm = 0, lengthMm = 0, overlapMm = 0;
    for (const s of upper) {
      if (!s.volumeMm3) continue;
      const x = (s.start[0] + s.end[0]) / 2;
      const under = lower.find(l => x >= Math.min(l.start[0], l.end[0]) && x <= Math.max(l.start[0], l.end[0]));
      lengthMm += s.lengthMm;
      if (layerId === 1) {contactMm += s.lengthMm; overlapMm += s.lengthMm;}
      else if (under && under.volumeMm3 > 0) {
        overlapMm += s.lengthMm * Math.min(1, under.widthMm / s.widthMm);
        if (s.baseZMm - (under.baseZMm + under.heightMm) <= 0.01) contactMm += s.lengthMm;
      }
    }
    return {layerId, lengthMm, contactFraction: lengthMm ? contactMm / lengthMm : 0, overlapFraction: lengthMm ? overlapMm / lengthMm : 0};
  }).filter(c => c.lengthMm > 0);
  return {gaps, contact};
}
