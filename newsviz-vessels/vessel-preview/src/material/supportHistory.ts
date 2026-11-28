import type {beadDeposition} from './beadDeposition.ts';
import type {XYZ} from '../toolpath.ts';
import {finite} from './calibrationTypes.ts';
import {relaxSag, SAG_PARAMETERS, validateSagParameters} from './reactiveSagging.ts';
import type {SagParameters} from './reactiveSagging.ts';

type Segment = ReturnType<typeof beadDeposition>['segments'][number];
export type DepositedElement = {
  source: Segment; layerId: number; depositionTimeS: number; initialPosition: XYZ;
  footprint: {start: XYZ; end: XYZ; widthMm: number}; volumeMm3: number; widthMm: number; heightMm: number;
  coverage: number; idealCoverage: number; spanMm: number; proximityMm: number | null;
  support: 'substrate' | 'supported' | 'bridge' | 'overhang' | 'isolated'; targetSagMm: number;
};
export function materialAt(e: DepositedElement, timeS: number, p: SagParameters = SAG_PARAMETERS) {
  finite(timeS, 'Simulation time');
  const ageS = Math.max(0, timeS - e.depositionTimeS);
  const sagMm = relaxSag(0, e.targetSagMm, ageS, p.relaxationS);
  return {ageS, sagMm, position: [e.initialPosition[0], e.initialPosition[1], e.initialPosition[2] - sagMm] as XYZ};
}

// shortcut: fixed support-at-birth relaxation targets; upgrade to evolving stiffness/contact after physical trials.
export function buildSupportHistory(material: ReturnType<typeof beadDeposition>, clearanceMm: number, p: SagParameters = SAG_PARAMETERS) {
  validateSagParameters(p); finite(clearanceMm, 'Nozzle clearance', 0.001, 100);
  if (material.segments.length > 10000) throw new Error('Independent lab support budget exceeded');
  const elements: DepositedElement[] = [], grid = new Map<string, DepositedElement[]>();
  const key = (x: number, y: number) => `${Math.floor(x / p.cellMm)},${Math.floor(y / p.cellMm)}`;
  const inside = (e: DepositedElement, x: number, y: number) => {
    const [a, b] = [e.footprint.start, e.footprint.end], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy);
    return t >= -1e-8 && t <= 1 + 1e-8 && Math.abs((x - a[0]) * dy - (y - a[1]) * dx) / Math.hypot(dx, dy) <= e.widthMm / 2 + 1e-8;
  };
  for (const s of material.segments) {
    if (!s.deposited || s.volumeMm3 <= 0) continue;
    const dx = s.end[0] - s.start[0], dy = s.end[1] - s.start[1], length = Math.hypot(dx, dy);
    if (length < 1e-8 || Math.abs(s.end[2] - s.start[2]) > 1e-8) throw new Error('Support lab requires horizontal deposition');
    const base = s.start[2] - clearanceMm, time = s.endTimeS;
    if (base < -p.contactToleranceMm) throw new Error('Deposit below substrate');
    let proximity: number | null = null;
    const contact = (x: number, y: number, ideal = false) => {
      if (Math.abs(base) <= p.contactToleranceMm) return true;
      let supported = false;
      for (const lower of grid.get(key(x, y)) ?? []) {
        if (lower.layerId >= s.command.layerId || !inside(lower, x, y)) continue;
        const z = ideal ? lower.initialPosition[2] : materialAt(lower, time, p).position[2];
        const gap = base - (z + lower.heightMm / 2);
        proximity = Math.min(proximity ?? Infinity, Math.abs(gap));
        if (Math.abs(gap) <= p.contactToleranceMm) supported = true;
      }
      return supported;
    };
    const cx = (s.start[0] + s.end[0]) / 2, cy = (s.start[1] + s.end[1]) / 2;
    const coverageAt = (offset: number, ideal = false) => {
      let hits = 0;
      for (const along of [-1 / 3, 0, 1 / 3]) for (const across of [-0.4, -0.2, 0, 0.2, 0.4]) {
        const x = cx + dx * along + dx / length * offset - dy / length * s.widthMm * across;
        const y = cy + dy * along + dy / length * offset + dx / length * s.widthMm * across;
        if (contact(x, y, ideal)) hits++;
      }
      return hits / 15;
    };
    const coverage = coverageAt(0), localProximity = proximity, idealCoverage = coverageAt(0, true);
    const anchor = (direction: number) => {
      for (let d = p.probeStepMm; d <= p.searchMm; d += p.probeStepMm) if (coverageAt(direction * d) >= p.supportedFraction) return d;
      return null;
    };
    const substrate = Math.abs(base) <= p.contactToleranceMm;
    const left = coverage >= p.supportedFraction ? 0 : anchor(-1), right = coverage >= p.supportedFraction ? 0 : anchor(1);
    const spanMm = coverage >= p.supportedFraction ? 0 : (left ?? p.searchMm) + (right ?? p.searchMm);
    const support = substrate ? 'substrate' : coverage >= p.supportedFraction ? 'supported' : left !== null && right !== null ? 'bridge' : left !== null || right !== null ? 'overhang' : 'isolated';
    const lever = support === 'bridge' ? left! * right! : Math.min(left ?? p.searchMm, right ?? p.searchMm) ** 2;
    const targetSagMm = Math.min(Math.max(0, base), p.maxSagMm, p.compliancePerMm * lever * (1 - coverage));
    const e: DepositedElement = {source: s, layerId: s.command.layerId, depositionTimeS: time,
      initialPosition: [cx, cy, base + s.heightMm / 2], footprint: {start: s.start, end: s.end, widthMm: s.widthMm},
      volumeMm3: s.volumeMm3, widthMm: s.widthMm, heightMm: s.heightMm, coverage, idealCoverage, spanMm,
      proximityMm: localProximity, support, targetSagMm};
    elements.push(e);
    for (let x = Math.floor((Math.min(s.start[0], s.end[0]) - s.widthMm / 2) / p.cellMm); x <= Math.floor((Math.max(s.start[0], s.end[0]) + s.widthMm / 2) / p.cellMm); x++) {
      for (let y = Math.floor((Math.min(s.start[1], s.end[1]) - s.widthMm / 2) / p.cellMm); y <= Math.floor((Math.max(s.start[1], s.end[1]) + s.widthMm / 2) / p.cellMm); y++) {
        const k = `${x},${y}`, cell = grid.get(k) ?? []; cell.push(e); grid.set(k, cell);
      }
    }
  }
  return {elements, ledger: {...material.ledger}, parameters: {...p}};
}
