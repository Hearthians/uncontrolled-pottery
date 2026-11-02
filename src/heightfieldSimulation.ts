import { BASE_RADIUS, LAYER_HEIGHT, SEGMENTS, TOTAL_STEPS } from "./simulation.ts";
import type { Deposit, ProcessEvent, Settings } from "./simulation.ts";
import {
  BASE_TOP, MATERIAL_DT, MATERIAL_PROFILE, RUNOUT_STEPS, SETTLE_STEPS,
  plannedNozzle, validMaterialRecord,
} from "./materialSimulation.ts";
import type { NozzlePose, SupplyPulse } from "./materialSimulation.ts";
import { LAB_DEFAULTS, LAB_DT } from "./depositionLab.ts";

const SCALE = MATERIAL_PROFILE.millimetersPerUnit;
const DS = Math.PI * 2 * BASE_RADIUS / SEGMENTS;
const WIDTH = MATERIAL_PROFILE.nozzleMm * 0.55 / SCALE;
// Exactly the v3 supply volume, in scene units cubed (not the lab's feed setting).
const VOLUME = Math.PI * WIDTH * LAYER_HEIGHT / 2 * DS;
const SUBSTEPS = Math.ceil(MATERIAL_DT / LAB_DT);

export const HEIGHTFIELD_PROFILE = Object.freeze({
  ...MATERIAL_PROFILE,
  id: "clay-heightfield-experiment-1" as const,
  material: "wet-clay-uncalibrated-lab-defaults",
  model: "2.5D-shallow-Bingham-hydrostatic-nozzle-pressure-finite-volume",
  experimental: true,
  calibrated: false,
  cellMm: 2,
  nx: 64,
  nz: 64,
  extentMm: 128,
  substeps: SUBSTEPS,
  substepSeconds: MATERIAL_DT / SUBSTEPS,
  labReferenceDtSeconds: LAB_DT,
  yieldPa: LAB_DEFAULTS.yieldPa,
  viscosityPaS: LAB_DEFAULTS.viscosityPaS,
  squeezePaPerMm: LAB_DEFAULTS.squeezePaPerMm,
  densityKgM3: LAB_DEFAULTS.densityKgM3,
  gravityMS2: 9.81,
  nozzlePressurePaddingMm: 0.6,
  maxOutgoingFraction: 0.22,
  nominalFeedMm3S: VOLUME * SCALE ** 3 / MATERIAL_DT,
  boundary: "closed-square-no-flux; edge accumulation is artificial confinement",
  substrate: "flat plate at BASE_TOP over the whole square; no plate-edge fall",
  source: "normalized nozzle-disk volume added directly to the column below the planned nozzle",
  limitations: "no overhangs, buried voids, bridges, free fall, fracture or resolved layer grooves; tall steep walls violate the shallow-layer assumption",
});

export type HeightfieldRecord = {
  version: 4;
  profile: typeof HEIGHTFIELD_PROFILE.id;
  ticks: number;
  stopStep: number;
  pulses?: SupplyPulse[];
};

/** Cell-centered heights in mm; x/z = (i + .5) * cellMm - n * cellMm / 2.
 * Scene coordinates divide x/z by millimetersPerUnit; y = BASE_TOP + height / scale.
 * The object and buffer stay live across advanceTo calls. Treat them as read-only.
 */
export type HeightfieldSurface = {
  nx: number;
  nz: number;
  cellMm: number;
  height: Float64Array;
};

/** Structurally SceneDeposit-compatible, but ONLY for progress/nozzle diagnostics.
 * Zero cross-sections and disconnected samples deliberately encode no tube geometry.
 * The sole material geometry is surface.height, not these path samples.
 */
export type HeightfieldDeposit = Deposit & {
  halfHeight: number;
  breakBefore: boolean;
  volume: number;
  born: number;
};

const P = HEIGHTFIELD_PROFILE;
const DX = P.cellMm;
const AREA = DX * DX;
const NX = P.nx, NZ = P.nz, CELLS = NX * NZ;
const HALF_X = NX * DX / 2, HALF_Z = NZ * DX / 2;
const HYDRO_SLOPE = P.densityKgM3 * P.gravityMS2 / 1000;
const RESPONSE_DT = P.substepSeconds / AREA;
const SOURCE_RADIUS = P.nozzleMm / 2;
const PRESSURE_RADIUS = SOURCE_RADIUS + P.nozzlePressurePaddingMm;

// Copied from plasticSimulation.ts to freeze historical v3 supply/seed behavior.
function randomSequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** EXPERIMENTAL global Cartesian volume field, not a strand or cylindrical mesh.
 *
 * Numerical provenance: DepositionLab.inject/flow/transfer/step in depositionLab.ts.
 * This is its normalized disk source, hydrostatic + nozzle-penalty pressure,
 * Bingham face mobility, locally implicit pressure response and donor-volume cap.
 * The one-material case needs no tracer-layer fractions. We cache the same donor
 * limiter once per cell, but still transfer equal volume between internal faces.
 * No boundary faces, clipping, smoothing or shape constraints create/remove mass.
 *
 * Kept separate rather than extracting the lab kernel: the lab's tracer arithmetic
 * and historical results stay untouched. Only the grid, source trajectory and dt
 * change. Sixteen equal substeps span MATERIAL_DT exactly (dt <= LAB_DT); neither
 * frame batching nor supply/emotion events change the rheology or stepping policy.
 * Sources below a high nozzle assume instantaneous vertical arrival, so this is
 * not a credible tall-cylinder, airborne-clay or unsupported-bridge simulation.
 */
export class HeightfieldSimulation {
  readonly surface: HeightfieldSurface = {
    nx: NX, nz: NZ, cellMm: DX, height: new Float64Array(CELLS),
  };
  readonly deposits: HeightfieldDeposit[] = [];
  readonly pulses: SupplyPulse[] = [];
  tick = 0;
  stopStep = TOTAL_STEPS - RUNOUT_STEPS;
  flow = 1;
  pressure = 1;
  deliveredVolume = 0;
  depositedVolume = 0;
  tipVolume = 0;
  injectedMm3 = 0;
  // Applies only to appended diagnostics. The live surface may change anywhere.
  dirtyStart = 0;
  nozzle: NozzlePose = plannedNozzle(0);
  private readonly fieldPressure = new Float64Array(CELLS);
  private readonly pressureSlope = new Float64Array(CELLS);
  private readonly outgoing = new Float64Array(CELLS);
  private readonly delta = new Float64Array(CELLS);
  private readonly fluxX = new Float64Array(CELLS);
  private readonly fluxZ = new Float64Array(CELLS);
  private readonly sourceIndices = new Int32Array((Math.ceil(P.nozzleMm / DX) + 2) ** 2);
  private readonly sourceWeights = new Float64Array(this.sourceIndices.length);
  private eventIndex = 0;
  private pressureNoise = 0;
  private noiseUntil = 0;
  private pulseBudget: number;
  private pulseUntil = 0;
  private pulseIndex = 0;
  private readonly noiseRandom: () => number;
  private readonly pulseRandom: () => number;
  private readonly recordedPulses?: readonly SupplyPulse[];

  constructor(seed: number, record?: HeightfieldRecord) {
    this.noiseRandom = randomSequence(seed ^ 0x49c42a);
    this.pulseRandom = randomSequence(seed ^ 0xa31d75);
    this.pulseBudget = -Math.log(Math.max(1e-9, this.pulseRandom()));
    if (record) { this.stopStep = record.stopStep; this.recordedPulses = record.pulses; }
  }

  get pathEnd() { return Math.min(TOTAL_STEPS, this.stopStep + RUNOUT_STEPS); }
  get endTick() { return this.pathEnd + SETTLE_STEPS; }
  get complete() { return this.tick >= this.endTick; }
  stop() { this.stopStep = Math.min(this.stopStep, this.tick); }
  record(): HeightfieldRecord {
    return { version: 4, profile: P.id, ticks: this.tick, stopStep: this.stopStep,
      pulses: this.pulses.map((pulse) => ({ ...pulse })) };
  }

  /** Volume in the outermost cells; nonzero means the closed box can affect shape.
   * Not leaked/discarded mass: it is already included in the surface's volume.
   */
  get boundaryVolumeMm3() {
    const h = this.surface.height;
    let sum = 0;
    for (let i = 0; i < NX; i++) sum += h[i] + h[(NZ - 1) * NX + i];
    for (let j = 1; j < NZ - 1; j++) sum += h[j * NX] + h[j * NX + NX - 1];
    return sum * AREA;
  }

  advanceTo(target: number, events: readonly ProcessEvent[]) {
    this.dirtyStart = this.deposits.length;
    const end = Math.min(Math.floor(target), this.endTick);
    if (end <= this.tick) return;
    while (this.tick < end) {
      while (this.eventIndex + 1 < events.length && events[this.eventIndex + 1].step <= this.tick) this.eventIndex++;
      const travelling = this.tick < this.pathEnd;
      let volume = 0;
      if (travelling) {
        this.advanceFlow(events[this.eventIndex] ?? { fluctuation: 0, interruption: 0, sag: true });
        volume = this.flow < 0.085 ? 0 : this.tipVolume;
        if (volume) { this.tipVolume = 0; this.depositedVolume += volume; }
        this.injectedMm3 += volume * SCALE ** 3;
      }
      for (let substep = 0; substep < P.substeps; substep++) {
        // Fractional plannedNozzle ticks follow the same fixed 100 mm spiral,
        // rather than depositing a tick's entire volume at one coarse-grid point.
        const pose = travelling ? plannedNozzle(this.tick + substep / P.substeps) : undefined;
        const x = pose ? pose.x * SCALE : 0, z = pose ? pose.z * SCALE : 0;
        if (volume) this.inject(x, z, volume * SCALE ** 3 / P.substeps);
        this.stepField(x, z, pose ? (pose.y - BASE_TOP) * SCALE : 0, travelling);
      }
      if (travelling) {
        const pose = plannedNozzle(this.tick);
        this.deposits.push({ x: pose.x, z: pose.z, y: this.surfaceY(pose), radius: BASE_RADIUS,
          thickness: 0, halfHeight: 0, breakBefore: true, gap: volume === 0, volume, born: this.tick });
      }
      this.tick++;
    }
    this.nozzle = plannedNozzle(Math.max(0, Math.min(this.tick, this.pathEnd - 1)));
    this.nozzle.flow = this.tick < this.pathEnd ? this.flow : 0;
    this.nozzle.contactY = this.surfaceY(this.nozzle);
    if (this.tick >= this.pathEnd) this.nozzle.y += Math.min(1, (this.tick - this.pathEnd) / 80) * 0.28;
  }

  private surfaceY(pose: NozzlePose) {
    const x = Math.max(0, Math.min(NX - 1, (pose.x * SCALE + HALF_X) / DX - 0.5));
    const z = Math.max(0, Math.min(NZ - 1, (pose.z * SCALE + HALF_Z) / DX - 0.5));
    const i = Math.floor(x), j = Math.floor(z), tx = x - i, tz = z - j;
    const right = Math.min(i + 1, NX - 1), below = Math.min(j + 1, NZ - 1);
    const h = this.surface.height;
    const top = h[j * NX + i] * (1 - tx) + h[j * NX + right] * tx;
    const bottom = h[below * NX + i] * (1 - tx) + h[below * NX + right] * tx;
    return BASE_TOP + (top * (1 - tz) + bottom * tz) / SCALE;
  }

  private inject(x: number, z: number, amount: number) {
    const lo = Math.max(0, Math.floor((x - SOURCE_RADIUS + HALF_X) / DX));
    const hi = Math.min(NX - 1, Math.ceil((x + SOURCE_RADIUS + HALF_X) / DX));
    const zlo = Math.max(0, Math.floor((z - SOURCE_RADIUS + HALF_Z) / DX));
    const zhi = Math.min(NZ - 1, Math.ceil((z + SOURCE_RADIUS + HALF_Z) / DX));
    let count = 0, weights = 0;
    for (let j = zlo; j <= zhi; j++) for (let i = lo; i <= hi; i++) {
      const r2 = (((i + 0.5) * DX - HALF_X - x) ** 2 +
        ((j + 0.5) * DX - HALF_Z - z) ** 2) / (SOURCE_RADIUS * SOURCE_RADIUS);
      if (r2 >= 1) continue;
      const weight = (1 - r2) ** 2;
      this.sourceIndices[count] = j * NX + i;
      this.sourceWeights[count++] = weight;
      weights += weight;
    }
    for (let c = 0; c < count; c++)
      this.surface.height[this.sourceIndices[c]] += amount * this.sourceWeights[c] / weights / AREA;
  }

  private faceFlow(a: number, b: number) {
    const h = Math.max(this.surface.height[a], this.surface.height[b]);
    if (h < 1e-10) return 0;
    const difference = this.fieldPressure[a] - this.fieldPressure[b];
    const shear = h * Math.abs(difference / DX);
    if (shear <= P.yieldPa) return 0;
    const ratio = P.yieldPa / shear;
    const mobility = h ** 3 / (3 * P.viscosityPaS) * (1 - 1.5 * ratio + 0.5 * ratio ** 3);
    const response = mobility * RESPONSE_DT;
    return response * difference /
      (1 + 4 * response * Math.max(this.pressureSlope[a], this.pressureSlope[b]));
  }

  private transfer(a: number, b: number, raw: number) {
    const donor = raw >= 0 ? a : b, receiver = raw >= 0 ? b : a;
    const transfer = Math.abs(raw) * this.outgoing[donor];
    this.delta[donor] -= transfer;
    this.delta[receiver] += transfer;
  }

  private stepField(x: number, z: number, ceiling: number, travelling: boolean) {
    const h = this.surface.height;
    for (let a = 0; a < CELLS; a++) this.fieldPressure[a] = HYDRO_SLOPE * h[a];
    this.pressureSlope.fill(HYDRO_SLOPE);
    if (travelling) {
      const lo = Math.max(0, Math.floor((x - PRESSURE_RADIUS + HALF_X) / DX));
      const hi = Math.min(NX - 1, Math.ceil((x + PRESSURE_RADIUS + HALF_X) / DX));
      const zlo = Math.max(0, Math.floor((z - PRESSURE_RADIUS + HALF_Z) / DX));
      const zhi = Math.min(NZ - 1, Math.ceil((z + PRESSURE_RADIUS + HALF_Z) / DX));
      for (let j = zlo; j <= zhi; j++) for (let i = lo; i <= hi; i++) {
        const a = j * NX + i;
        if (((i + 0.5) * DX - HALF_X - x) ** 2 + ((j + 0.5) * DX - HALF_Z - z) ** 2 >= PRESSURE_RADIUS ** 2) continue;
        if (h[a] > ceiling) {
          this.fieldPressure[a] += P.squeezePaPerMm * (h[a] - ceiling);
          this.pressureSlope[a] += P.squeezePaPerMm;
        }
      }
    }
    this.outgoing.fill(0);
    this.delta.fill(0);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = j * NX + i;
      if (i + 1 < NX) {
        const flux = this.faceFlow(a, a + 1);
        this.fluxX[a] = flux;
        this.outgoing[flux >= 0 ? a : a + 1] += Math.abs(flux);
      }
      if (j + 1 < NZ) {
        const flux = this.faceFlow(a, a + NX);
        this.fluxZ[a] = flux;
        this.outgoing[flux >= 0 ? a : a + NX] += Math.abs(flux);
      }
    }
    // All four faces share one donor budget. No post-update height clamping:
    // nonnegativity comes from spending at most 22% of a donor per substep.
    for (let a = 0; a < CELLS; a++)
      this.outgoing[a] = this.outgoing[a] > 0 ? Math.min(1, h[a] * P.maxOutgoingFraction / this.outgoing[a]) : 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = j * NX + i;
      if (i + 1 < NX) this.transfer(a, a + 1, this.fluxX[a]);
      if (j + 1 < NZ) this.transfer(a, a + NX, this.fluxZ[a]);
    }
    for (let a = 0; a < CELLS; a++) h[a] += this.delta[a];
  }

  // Intentionally identical to v3 advanceFlow. Events affect supply only, never
  // yield stress, viscosity, pressure penalty, gravity or a cosmetic shape rule.
  private advanceFlow(settings: Settings) {
    if (this.tick >= this.noiseUntil) {
      this.pressureNoise = this.noiseRandom() * 2 - 1;
      this.noiseUntil = this.tick + Math.round((1.4 + this.noiseRandom() * 4) / MATERIAL_DT);
    }
    let interrupted = false;
    if (this.recordedPulses) {
      while (this.pulseIndex < this.recordedPulses.length && this.recordedPulses[this.pulseIndex].end <= this.tick) this.pulseIndex++;
      const pulse = this.recordedPulses[this.pulseIndex];
      interrupted = !!pulse && pulse.start <= this.tick;
      if (pulse?.start === this.tick) this.pulses.push({ ...pulse });
    } else {
      interrupted = this.tick < this.pulseUntil;
      if (!interrupted && this.tick < this.stopStep) {
        const value = settings.interruption / 100;
        this.pulseBudget -= (0.35 * value * value + 0.04 * value) * MATERIAL_DT;
        if (this.pulseBudget <= 0) {
          const duration = 0.7 + value * 4 + this.pulseRandom() * 2;
          this.pulseUntil = this.tick + Math.ceil(duration / MATERIAL_DT);
          this.pulses.push({ start: this.tick, end: this.pulseUntil });
          this.pulseBudget = -Math.log(Math.max(1e-9, this.pulseRandom()));
          interrupted = true;
        }
      }
    }
    const command = this.tick >= this.stopStep || interrupted ? 0 : Math.max(0, 1 + this.pressureNoise * settings.fluctuation / 100 * 1.3);
    this.pressure = command + (this.pressure - command) * Math.exp(-MATERIAL_DT / MATERIAL_PROFILE.pressureResponseSeconds);
    const equilibrium = Math.min(3.2, Math.pow(Math.max(0, (this.pressure - 0.16) / 0.84), 1.6));
    const before = this.flow;
    this.flow = equilibrium + (this.flow - equilibrium) * Math.exp(-MATERIAL_DT / MATERIAL_PROFILE.flowResponseSeconds);
    const delivered = (before + this.flow) / 2 * VOLUME;
    this.deliveredVolume += delivered;
    this.tipVolume += delivered;
  }
}

export function validHeightfieldRecord(value: unknown, steps: number): value is HeightfieldRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as HeightfieldRecord;
  return record.version === 4 && record.profile === P.id &&
    validMaterialRecord({ ...record, version: 2, profile: MATERIAL_PROFILE.id }, steps);
}
