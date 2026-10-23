import {
  BASE_RADIUS,
  LAYER_HEIGHT,
  SEGMENTS,
  TOTAL_STEPS,
} from "./simulation.ts";
import type { Deposit, ProcessEvent, Settings } from "./simulation.ts";

export const MATERIAL_PROFILE = Object.freeze({
  id: "pneumatic-clay-1" as const,
  machine: "pneumatic-direct-extrusion",
  material: "wet-clay-local-approximation",
  millimetersPerUnit: 50 / BASE_RADIUS,
  diameterMm: 100,
  nozzleMm: 6,
  layerHeightMm: LAYER_HEIGHT * 50 / BASE_RADIUS,
  speedMmPerSecond: 25,
  pressureResponseSeconds: 1.1,
  flowResponseSeconds: 0.55,
});

export const MATERIAL_DT = Math.PI * MATERIAL_PROFILE.diameterMm /
  MATERIAL_PROFILE.speedMmPerSecond / SEGMENTS;
export const RUNOUT_STEPS = 96;
export const SETTLE_STEPS = 240;
export const MATERIAL_TICKS = TOTAL_STEPS + SETTLE_STEPS;
export const BASE_TOP = 0.0325;
const PATH_DS = 2 * Math.PI * BASE_RADIUS / SEGMENTS;
const HALF_WIDTH = MATERIAL_PROFILE.nozzleMm * 0.55 /
  MATERIAL_PROFILE.millimetersPerUnit;
const BASE_AREA = Math.PI * HALF_WIDTH * LAYER_HEIGHT / 2;
const BASE_VOLUME = BASE_AREA * PATH_DS;
const MIN_FLOW = 0.085;
const RECENT_STEPS = SEGMENTS * 3;
const MAX_BRIDGE = 12;
const RELAXATION = 1 - Math.exp(-MATERIAL_DT / 2.6);
const CONTACT_RELAXATION = 1 - Math.exp(-MATERIAL_DT / 0.8);

export type SupplyPulse = { start: number; end: number };
export type MaterialRecord = {
  version: 2;
  profile: typeof MATERIAL_PROFILE.id;
  ticks: number;
  stopStep: number;
  pulses?: SupplyPulse[];
};

export type MaterialDeposit = Deposit & {
  halfHeight: number;
  restHalfHeight: number;
  volume: number;
  birthY: number;
  born: number;
  support: number;
  left: number;
  right: number;
  span: number;
  mobile: boolean;
  load: number;
};

export type NozzlePose = {
  x: number;
  y: number;
  z: number;
  flow: number;
  contactY: number;
};

function randomSequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function plannedNozzle(step: number): NozzlePose {
  const theta = step / SEGMENTS * Math.PI * 2;
  const rise = step < SEGMENTS ? 0 : step / SEGMENTS * LAYER_HEIGHT;
  return {
    x: Math.cos(theta) * BASE_RADIUS,
    y: BASE_TOP + LAYER_HEIGHT + rise,
    z: Math.sin(theta) * BASE_RADIUS,
    flow: 1,
    contactY: BASE_TOP + LAYER_HEIGHT / 2 + rise,
  };
}

/** A fixed-path, volume-tracked local material approximation, not a clay FEM solver. */
export class MaterialSimulation {
  readonly deposits: MaterialDeposit[] = [];
  readonly pulses: SupplyPulse[] = [];
  tick = 0;
  stopStep = TOTAL_STEPS - RUNOUT_STEPS;
  flow = 1;
  pressure = 1;
  deliveredVolume = 0;
  depositedVolume = 0;
  tipVolume = 0;
  dirtyStart = 0;
  nozzle = plannedNozzle(0);
  private eventIndex = 0;
  private pressureNoise = 0;
  private noiseUntil = 0;
  private pulseBudget: number;
  private pulseUntil = 0;
  private pulseIndex = 0;
  private readonly noiseRandom: () => number;
  private readonly pulseRandom: () => number;
  private readonly recordedPulses?: readonly SupplyPulse[];
  private readonly awake = new Set<number>();

  constructor(seed: number, record?: MaterialRecord) {
    this.noiseRandom = randomSequence(seed ^ 0x49c42a);
    this.pulseRandom = randomSequence(seed ^ 0xa31d75);
    this.pulseBudget = -Math.log(Math.max(1e-9, this.pulseRandom()));
    if (record) {
      this.stopStep = record.stopStep;
      this.recordedPulses = record.pulses;
    }
  }

  get pathEnd() {
    return Math.min(TOTAL_STEPS, this.stopStep + RUNOUT_STEPS);
  }

  get endTick() {
    return this.pathEnd + SETTLE_STEPS;
  }

  get complete() {
    return this.tick >= this.endTick;
  }

  stop() {
    this.stopStep = Math.min(this.stopStep, this.tick);
  }

  record(): MaterialRecord {
    return {
      version: 2,
      profile: MATERIAL_PROFILE.id,
      ticks: this.tick,
      stopStep: this.stopStep,
      pulses: this.pulses.map((pulse) => ({ ...pulse })),
    };
  }

  advanceTo(target: number, events: readonly ProcessEvent[]) {
    this.dirtyStart = this.deposits.length;
    const end = Math.min(Math.floor(target), this.endTick);
    while (this.tick < end) {
      while (this.eventIndex + 1 < events.length &&
        events[this.eventIndex + 1].step <= this.tick) this.eventIndex++;
      const settings = events[this.eventIndex];
      this.advanceFlow(settings);
      if (this.tick < this.pathEnd) this.deposit(settings);
      this.relax();
      this.tick++;
    }
    const step = Math.min(this.tick, this.pathEnd - 1);
    this.nozzle = plannedNozzle(Math.max(0, step));
    const last = this.deposits.at(-1);
    this.nozzle.flow = this.tick < this.pathEnd ? this.flow : 0;
    this.nozzle.contactY = last && !last.gap ? last.y : this.nozzle.y;
    if (this.tick >= this.pathEnd) {
      this.nozzle.y += Math.min(1, (this.tick - this.pathEnd) / 80) * 0.28;
    }
  }

  private advanceFlow(settings: Settings) {
    if (this.tick >= this.pathEnd) return;
    if (this.tick >= this.noiseUntil) {
      this.pressureNoise = this.noiseRandom() * 2 - 1;
      this.noiseUntil = this.tick + Math.round((1.4 + this.noiseRandom() * 4) / MATERIAL_DT);
    }
    let interrupted = false;
    if (this.recordedPulses) {
      while (this.pulseIndex < this.recordedPulses.length &&
        this.recordedPulses[this.pulseIndex].end <= this.tick) this.pulseIndex++;
      const pulse = this.recordedPulses[this.pulseIndex];
      interrupted = !!pulse && pulse.start <= this.tick;
      if (pulse && pulse.start === this.tick) this.pulses.push({ ...pulse });
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
    const command = this.tick >= this.stopStep || interrupted ? 0 :
      Math.max(0, 1 + this.pressureNoise * settings.fluctuation / 100 * 1.3);
    this.pressure = command + (this.pressure - command) *
      Math.exp(-MATERIAL_DT / MATERIAL_PROFILE.pressureResponseSeconds);
    const equilibrium = Math.min(3.2, Math.pow(Math.max(0, (this.pressure - 0.16) / 0.84), 1.6));
    const previousFlow = this.flow;
    this.flow = equilibrium + (this.flow - equilibrium) *
      Math.exp(-MATERIAL_DT / MATERIAL_PROFILE.flowResponseSeconds);
    const delivered = (previousFlow + this.flow) / 2 * BASE_VOLUME;
    this.deliveredVolume += delivered;
    this.tipVolume += delivered;
  }

  private supportAt(index: number, plannedY: number): number {
    for (let i = index - SEGMENTS; i >= 0; i -= SEGMENTS) {
      const point = this.deposits[i];
      if (point && !point.gap && point.y + point.halfHeight <= plannedY + LAYER_HEIGHT * 0.8)
        return i;
    }
    return -1;
  }

  private bridgeAnchor(index: number, direction: number, plannedY: number) {
    for (let distance = 1; distance <= MAX_BRIDGE; distance++) {
      const candidate = index - SEGMENTS + direction * distance;
      const point = this.deposits[candidate];
      if (candidate >= 0 && candidate < index - SEGMENTS / 2 && point && !point.gap &&
        Math.abs(point.y + point.halfHeight - plannedY) < LAYER_HEIGHT * 0.7)
        return { index: candidate, distance };
    }
    return { index: -1, distance: MAX_BRIDGE + 1 };
  }

  private deposit(settings: Settings) {
    const index = this.deposits.length;
    const pose = plannedNozzle(index);
    const gap = this.flow < MIN_FLOW;
    const volume = gap ? 0 : this.tipVolume;
    if (!gap) {
      this.tipVolume = 0;
      this.depositedVolume += volume;
    }
    const support = this.supportAt(index, pose.y);
    const top = support < 0 ? BASE_TOP :
      this.deposits[support].y + this.deposits[support].halfHeight;
    const area = volume / PATH_DS;
    const contact = pose.y - top <= LAYER_HEIGHT * (index < SEGMENTS * 2 ? 2.05 : 1.35);
    const halfHeight = contact ?
      Math.max(LAYER_HEIGHT * 0.27, (pose.y - top) / 2) : Math.sqrt(area / Math.PI);
    const left = !contact ? this.bridgeAnchor(index, -1, pose.y - LAYER_HEIGHT) : { index: -1, distance: 0 };
    const right = !contact ? this.bridgeAnchor(index, 1, pose.y - LAYER_HEIGHT) : { index: -1, distance: 0 };
    const point: MaterialDeposit = {
      x: pose.x,
      y: contact ? top + halfHeight : pose.contactY,
      z: pose.z,
      radius: BASE_RADIUS,
      thickness: halfHeight > 0 ? area / (Math.PI * halfHeight) : 0,
      halfHeight,
      restHalfHeight: halfHeight,
      volume,
      birthY: contact ? top + halfHeight : pose.contactY,
      born: this.tick,
      gap,
      support,
      left: left.index,
      right: right.index,
      span: (left.distance + right.distance) * PATH_DS,
      mobile: settings.sag,
      load: volume,
    };
    this.deposits.push(point);
    if (!gap) {
      for (let ancestor = support, depth = 0; ancestor >= 0 && depth < 64; depth++) {
        const lower = this.deposits[ancestor];
        lower.load += volume;
        if (lower.load > BASE_VOLUME * 75) this.awake.add(ancestor);
        ancestor = lower.support;
      }
      this.awake.add(index);
    }
    this.dirtyStart = Math.min(this.dirtyStart, index);
  }

  private relaxPoint(index: number) {
    const point = this.deposits[index];
    if (point.gap) return;
    const support = this.deposits[point.support];
    const surface = support && !support.gap ? support.y + support.halfHeight : BASE_TOP;
    const originalHalfHeight = point.restHalfHeight;
    const overload = point.mobile ? Math.max(0, point.load / BASE_VOLUME - 75) : 0;
    const compression = Math.min(0.25, overload * 0.0025);
    let halfHeight = originalHalfHeight * (1 - compression);
    let target = surface + halfHeight;
    const left = this.deposits[point.left];
    const right = this.deposits[point.right];
    if (left && right) {
      const anchors = Math.min(left.y + left.halfHeight, right.y + right.halfHeight);
      const bend = point.mobile ? Math.pow(point.span / (HALF_WIDTH * 4), 3) * LAYER_HEIGHT * 0.18 : 0;
      target = Math.max(target, anchors + halfHeight - bend);
    }
    const airborne = point.birthY - surface > LAYER_HEIGHT * 1.4;
    if (airborne && point.y - halfHeight > surface + LAYER_HEIGHT * 0.2) {
      halfHeight = Math.sqrt(point.volume / PATH_DS / Math.PI);
      target = Math.max(surface + halfHeight, target);
    }
    target = Math.min(point.birthY, target);
    const factor = point.mobile ? RELAXATION : CONTACT_RELAXATION;
    point.y += (target - point.y) * factor;
    point.halfHeight += (halfHeight - point.halfHeight) * factor;
    const previous = this.deposits[index - 1];
    const length = previous && !previous.gap ?
      Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) : PATH_DS;
    point.thickness = point.volume / Math.max(PATH_DS * 0.8, length) /
      (Math.PI * point.halfHeight);
    this.dirtyStart = Math.min(this.dirtyStart, index);
  }

  private relax() {
    const start = Math.max(0, this.deposits.length - RECENT_STEPS);
    for (let index = start; index < this.deposits.length; index++) this.relaxPoint(index);
    for (const index of this.awake) {
      if (index < start) this.relaxPoint(index);
      const point = this.deposits[index];
      if (this.tick - point.born > RECENT_STEPS && point.load <= BASE_VOLUME * 75)
        this.awake.delete(index);
    }
  }
}

export function validMaterialRecord(value: unknown, steps: number): value is MaterialRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as MaterialRecord;
  if (record.version !== 2 || record.profile !== MATERIAL_PROFILE.id ||
    !Number.isInteger(record.ticks) || !Number.isInteger(record.stopStep) ||
    record.stopStep < 0 || record.stopStep > TOTAL_STEPS - RUNOUT_STEPS) return false;
  const pathEnd = Math.min(TOTAL_STEPS, record.stopStep + RUNOUT_STEPS);
  if (record.ticks < 0 || record.ticks > pathEnd + SETTLE_STEPS ||
    steps !== Math.min(record.ticks, pathEnd)) return false;
  if (record.pulses !== undefined && (!Array.isArray(record.pulses) ||
    record.pulses.length > TOTAL_STEPS || !record.pulses.every((pulse, index) =>
      pulse && Number.isInteger(pulse.start) && Number.isInteger(pulse.end) &&
      pulse.start >= 0 && pulse.start < record.stopStep && pulse.end > pulse.start &&
      pulse.end <= TOTAL_STEPS + 200 &&
      (index === 0 || pulse.start >= record.pulses![index - 1].end)))) return false;
  return true;
}
