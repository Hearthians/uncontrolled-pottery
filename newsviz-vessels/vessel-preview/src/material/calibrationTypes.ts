import type {XYZ} from '../toolpath.ts';
export type MotionCommand = Readonly<{startTimeS: number; endTimeS: number; start: XYZ; end: XYZ; feedMm3S: number; kind: 'deposit' | 'travel'; layerId: number}>;
export type MaterialProfile = {id: string; status: 'illustrative' | 'fitted-unvalidated' | 'calibrated'; evidenceIds: string[]; startupSeconds: number; shutdownSeconds: number; delaySeconds: number; thresholdMm3S: number};
export type LabSettings = {lengthMm: number; speedMmS: number; feedMm3S: number; nozzleDiameterMm: number | null; clearanceMm: number; widthMm: number; heightMm: number; densityGPerCm3: number | null};
export type FlowBin = {startTimeS: number; endTimeS: number; start: XYZ; end: XYZ; command: MotionCommand; requestedMm3S: number; delayedMm3S: number; flowStartMm3S: number; flowEndMm3S: number; volumeMm3: number; belowThreshold: boolean};
export function finite(value: unknown, name: string, min = 0, max = 1e6): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be finite in [${min}, ${max}]`);
}
export function validateProfile(p: MaterialProfile) {
  if (!p || typeof p.id !== 'string' || !p.id.trim() || !['illustrative', 'fitted-unvalidated', 'calibrated'].includes(p.status) || !Array.isArray(p.evidenceIds) || p.evidenceIds.some(id => typeof id !== 'string' || !id.trim()) || (p.status !== 'illustrative' && !p.evidenceIds.length)) throw new Error('Invalid material profile or missing evidence');
  finite(p.startupSeconds, 'Startup seconds', 0, 10); finite(p.shutdownSeconds, 'Shutdown seconds', 0, 10);
  finite(p.delaySeconds, 'Transport delay seconds', 0, 10); finite(p.thresholdMm3S, 'Gap threshold mm³/s');
}
export function validateSettings(s: LabSettings) {
  finite(s.lengthMm, 'Length mm', 25, 200); finite(s.speedMmS, 'Speed mm/s', 1, 100);
  finite(s.feedMm3S, 'Feed mm³/s', 0, 500); finite(s.clearanceMm, 'Clearance mm', 0.1, 10);
  finite(s.widthMm, 'Target width mm', 0.1, 20); finite(s.heightMm, 'Target height mm', 0.1, 10);
  if (s.nozzleDiameterMm !== null) finite(s.nozzleDiameterMm, 'Nozzle diameter mm', 0.1, 20);
  if (s.densityGPerCm3 !== null) finite(s.densityGPerCm3, 'Density g/cm³', 0.1, 10);
}
