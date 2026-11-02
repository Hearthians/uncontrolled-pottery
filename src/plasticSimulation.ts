import { BASE_RADIUS, LAYER_HEIGHT, SEGMENTS, TOTAL_STEPS } from "./simulation.ts";
import type { Deposit, ProcessEvent, Settings } from "./simulation.ts";
import {
  BASE_TOP, MATERIAL_DT, MATERIAL_PROFILE, RUNOUT_STEPS, SETTLE_STEPS,
  plannedNozzle, validMaterialRecord,
} from "./materialSimulation.ts";
import type { NozzlePose, SupplyPulse } from "./materialSimulation.ts";

export const PLASTIC_PROFILE = Object.freeze({
  ...MATERIAL_PROFILE,
  id: "pneumatic-clay-plastic-1" as const,
  material: "viscoplastic-strand-prototype",
  substeps: 4,
  iterations: 3,
  densityKgM3: 1700,
  gravityMmS2: 9810,
  viscousDrag: 1800,
  stretchCompliance: 0.000006,
  bendCompliance: 0.00002,
  bendYieldMm: 0.45,
  plasticRate: 0.8,
  compressiveYieldPa: 12000,
  friction: 0.7,
  tensileYieldRatio: 1.12,
  breakStretchRatio: 2.8,
});

export type PlasticRecord = {
  version: 3;
  profile: typeof PLASTIC_PROFILE.id;
  ticks: number;
  stopStep: number;
  pulses?: SupplyPulse[];
};

const DS = Math.PI * 2 * BASE_RADIUS / SEGMENTS;
const SCALE = MATERIAL_PROFILE.millimetersPerUnit;
const WIDTH = MATERIAL_PROFILE.nozzleMm * 0.55 / SCALE;
const VOLUME = Math.PI * WIDTH * LAYER_HEIGHT / 2 * DS;
const DT = MATERIAL_DT / PLASTIC_PROFILE.substeps;
const CELL = 0.22;
const SKIN = 0.012;
const GRAVITY = PLASTIC_PROFILE.gravityMmS2 / SCALE;
const STRETCH_ALPHA = PLASTIC_PROFILE.stretchCompliance / (DT * DT);
const BEND_ALPHA = PLASTIC_PROFILE.bendCompliance / (DT * DT);
const YIELD = PLASTIC_PROFILE.bendYieldMm / SCALE;
const BEND_AXES = [
  ["x", "bendX", "bendLambdaX"], ["y", "bendY", "bendLambdaY"], ["z", "bendZ", "bendLambdaZ"],
] as const;

export type PlasticDeposit = Deposit & {
  halfHeight: number;
  volume: number;
  born: number;
  birthX: number;
  birthY: number;
  birthZ: number;
  restHalfHeight: number;
  restLength: number;
  breakBefore: boolean;
  vx: number;
  vy: number;
  vz: number;
  oldX: number;
  oldY: number;
  oldZ: number;
  bendX: number;
  bendY: number;
  bendZ: number;
  stretchLambda: number;
  bendLambdaX: number;
  bendLambdaY: number;
  bendLambdaZ: number;
  support: number;
  load: number;
  quiet: number;
};

type Contact = { a: number; b: number };

// A damped particle-strand approximation: XPBD stretch/bend, plastic rest curvature,
// ellipsoidal contact samples and load-driven flattening. Not a calibrated clay solver.
export class ClayStrand {
  readonly deposits: PlasticDeposit[] = [];
  readonly awake = new Set<number>();
  private readonly grid = new Map<number, Set<number>>();
  private readonly cells: number[] = [];
  private readonly supportedBy = new Map<number, Set<number>>();
  private maxWidth = WIDTH;
  private maxHeight = LAYER_HEIGHT / 2;
  dirtyStart = 0;

  private readonly floorAt: (x: number, z: number) => number;

  constructor(floorAt: (x: number, z: number) => number = (x, z) => {
    const radius = Math.hypot(x, z);
    return radius <= BASE_RADIUS + 0.015 ? BASE_TOP : radius <= 1.85 ? -0.02 : -0.23;
  }) { this.floorAt = floorAt; }

  private cell(x: number, y: number, z: number) {
    return (x + 1024) * 4194304 + (y + 1024) * 2048 + z + 1024;
  }

  private locate(p: Deposit) {
    return this.cell(Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL));
  }

  private reindex(index: number) {
    const key = this.locate(this.deposits[index]);
    if (this.cells[index] === key) return;
    const old = this.grid.get(this.cells[index]);
    old?.delete(index);
    if (old?.size === 0) this.grid.delete(this.cells[index]);
    let bucket = this.grid.get(key);
    if (!bucket) this.grid.set(key, bucket = new Set());
    bucket.add(index);
    this.cells[index] = key;
  }

  add(x: number, y: number, z: number, volume: number, born: number, connected = true) {
    const index = this.deposits.length;
    const previous = this.deposits[index - 1];
    const gap = volume === 0;
    const round = Math.sqrt(volume / DS / Math.PI);
    const halfHeight = round;
    const point: PlasticDeposit = {
      x, y, z, radius: Math.hypot(x, z), thickness: halfHeight ? volume / DS / Math.PI / halfHeight : 0,
      halfHeight, volume, gap, born, birthX: x, birthY: y, birthZ: z,
      restHalfHeight: halfHeight, restLength: DS,
      breakBefore: !connected || !previous || previous.gap || gap,
      vx: 0, vy: 0, vz: 0, oldX: x, oldY: y, oldZ: z,
      bendX: 0, bendY: 0, bendZ: 0,
      stretchLambda: 0, bendLambdaX: 0, bendLambdaY: 0, bendLambdaZ: 0,
      support: -1, load: volume, quiet: 0,
    };
    this.deposits.push(point);
    if (!gap) {
      this.maxWidth = Math.max(this.maxWidth, point.thickness);
      this.maxHeight = Math.max(this.maxHeight, point.halfHeight);
      this.reindex(index);
      this.awake.add(index);
      if (!point.breakBefore) this.wake(index - 1);
      if (previous && !previous.breakBefore && !point.breakBefore) {
        const before = this.deposits[index - 2];
        previous.bendX = previous.birthX - (before.birthX + x) / 2;
        previous.bendY = previous.birthY - (before.birthY + y) / 2;
        previous.bendZ = previous.birthZ - (before.birthZ + z) / 2;
      }
    }
    this.dirtyStart = Math.min(this.dirtyStart, index);
    return point;
  }

  private wake(index: number) {
    const p = this.deposits[index];
    if (!p || p.gap) return;
    this.awake.add(index);
    p.quiet = 0;
  }

  private weight(index: number) {
    const p = this.deposits[index];
    return p && !p.gap && this.awake.has(index) ? VOLUME / Math.max(VOLUME * 0.12, p.volume) : 0;
  }

  private contacts(active: number[]): Contact[] {
    const contacts: Contact[] = [];
    for (const i of active) {
      const p = this.deposits[i];
      const x = Math.floor(p.x / CELL), y = Math.floor(p.y / CELL), z = Math.floor(p.z / CELL);
      const reach = Math.ceil((Math.max(p.thickness, p.halfHeight) + this.maxWidth + SKIN) / CELL);
      const verticalReach = Math.ceil((p.halfHeight + this.maxHeight + SKIN) / CELL);
      for (let dx = -reach; dx <= reach; dx++) {
        for (let dy = -verticalReach; dy <= verticalReach; dy++) {
          for (let dz = -reach; dz <= reach; dz++) {
            const bucket = this.grid.get(this.cell(x + dx, y + dy, z + dz));
            if (!bucket) continue;
            for (const j of bucket) {
              if (j === i || (j < i && this.awake.has(j))) continue;
              const other = this.deposits[j];
              // Adjacent samples belong to one continuous tube, not colliding beads.
              if (Math.abs(j - i) <= 8 && Math.abs(p.born - other.born) < 12) {
                let continuous = true;
                for (let k = Math.min(i, j) + 1; k <= Math.max(i, j); k++) {
                  if (this.deposits[k].breakBefore || this.deposits[k].gap) { continuous = false; break; }
                }
                if (continuous) continue;
              }
              if (Math.abs(p.y - other.y) > p.halfHeight + other.halfHeight + SKIN) continue;
              const horizontal = (p.x - other.x) ** 2 + (p.z - other.z) ** 2;
              if (horizontal > (p.thickness + other.thickness + SKIN) ** 2) continue;
              // Use the closest sample along a continuous contacting strand. Otherwise
              // overlapping samples in the same tube count the same contact many times.
              let closest = true;
              for (const k of [j - 1, j + 1]) {
                const neighbor = this.deposits[k];
                if (!neighbor || neighbor.gap || (k < j ? other.breakBefore : neighbor.breakBefore)) continue;
                if (Math.abs(neighbor.y - other.y) > LAYER_HEIGHT / 2) continue;
                if ((p.x - neighbor.x) ** 2 + (p.z - neighbor.z) ** 2 < horizontal - 1e-12) { closest = false; break; }
              }
              if (closest) contacts.push({ a: i, b: j });
            }
          }
        }
      }
    }
    return contacts;
  }

  private stretch(index: number) {
    const p = this.deposits[index], q = this.deposits[index - 1];
    if (!q || p.gap || p.breakBefore || q.gap) return;
    const a = this.weight(index), b = this.weight(index - 1);
    if (a + b === 0) return;
    const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-9) return;
    const limit = 0.003 / Math.max(a, b);
    const dl = Math.max(-limit, Math.min(limit,
      (-(length - p.restLength) - STRETCH_ALPHA * p.stretchLambda) / (a + b + STRETCH_ALPHA)));
    p.stretchLambda += dl;
    const correction = dl / length;
    p.x += a * correction * dx; p.y += a * correction * dy; p.z += a * correction * dz;
    q.x -= b * correction * dx; q.y -= b * correction * dy; q.z -= b * correction * dz;
  }

  private bend(index: number) {
    const p = this.deposits[index], a = this.deposits[index - 1], b = this.deposits[index + 1];
    if (!a || !b || p.breakBefore || b.breakBefore || p.gap || a.gap || b.gap) return;
    const w = this.weight(index), wa = this.weight(index - 1), wb = this.weight(index + 1);
    const denominator = w + (wa + wb) / 4 + BEND_ALPHA;
    for (const [axis, rest, lambda] of BEND_AXES) {
      const c = p[axis] - (a[axis] + b[axis]) / 2 - p[rest];
      const limit = 0.002 / Math.max(w, wa / 2, wb / 2, 1e-9);
      const dl = Math.max(-limit, Math.min(limit, (-c - BEND_ALPHA * p[lambda]) / denominator));
      p[lambda] += dl;
      p[axis] += w * dl; a[axis] -= wa * dl / 2; b[axis] -= wb * dl / 2;
    }
  }

  private contact(a: number, b: number) {
    const p = this.deposits[a], q = this.deposits[b];
    const rx = p.thickness + q.thickness, ry = p.halfHeight + q.halfHeight;
    const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
    const distance = Math.sqrt((dx * dx + dz * dz) / (rx * rx) + dy * dy / (ry * ry));
    if (distance >= 1) return;
    if (distance < 1e-8) {
      const w = this.weight(a), wq = this.weight(b), sum = w + wq;
      if (sum) {
        const sign = a > b ? 1 : -1;
        p.y += sign * ry * w / sum;
        q.y -= sign * ry * wq / sum;
      }
      return;
    }
    this.flatten(p.y >= q.y ? a : b);
    const nx = dx / (rx * rx), ny = dy / (ry * ry), nz = dz / (rx * rx);
    const nlength = Math.hypot(nx, ny, nz);
    const w = this.weight(a), wq = this.weight(b), sum = w + wq;
    if (!sum) return;
    const penetration = (1 - distance) * distance / nlength;
    const scale = penetration / (sum * nlength);
    p.x += w * scale * nx; p.y += w * scale * ny; p.z += w * scale * nz;
    q.x -= wq * scale * nx; q.y -= wq * scale * ny; q.z -= wq * scale * nz;
    const ux = nx / nlength, uy = ny / nlength, uz = nz / nlength;
    const mx = (p.x - p.oldX) - (q.x - q.oldX);
    const my = (p.y - p.oldY) - (q.y - q.oldY);
    const mz = (p.z - p.oldZ) - (q.z - q.oldZ);
    const normalMotion = mx * ux + my * uy + mz * uz;
    const tx = mx - normalMotion * ux, ty = my - normalMotion * uy, tz = mz - normalMotion * uz;
    const friction = Math.min(1, (penetration * PLASTIC_PROFILE.friction + 0.00004) / (Math.hypot(tx, ty, tz) || 1));
    p.x -= w / sum * friction * tx; p.y -= w / sum * friction * ty; p.z -= w / sum * friction * tz;
    q.x += wq / sum * friction * tx; q.y += wq / sum * friction * ty; q.z += wq / sum * friction * tz;
  }

  private flatten(index: number) {
    const p = this.deposits[index];
    if (!this.awake.has(index)) return;
    const target = Math.min(p.restHalfHeight, LAYER_HEIGHT / 2);
    if (p.halfHeight <= target) return;
    p.halfHeight = target + (p.halfHeight - target) * Math.exp(-DT * 3);
    const previous = this.deposits[index - 1];
    const length = previous && !p.breakBefore ? Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z) : DS;
    p.thickness = p.volume / Math.max(DS * 0.65, length) / Math.PI / p.halfHeight;
    this.maxWidth = Math.max(this.maxWidth, p.thickness);
  }

  private stress(p: PlasticDeposit) {
    const area = Math.max(1e-8, 2 * p.thickness * DS);
    return p.load * SCALE / 1000 * PLASTIC_PROFILE.densityKgM3 * 9.81 / area;
  }

  private changeSupport(index: number, support: number) {
    const p = this.deposits[index];
    if (p.support === support) return;
    const propagate = (start: number, amount: number) => {
      for (let i = start, depth = 0; i >= 0 && depth < TOTAL_STEPS; depth++) {
        const q = this.deposits[i];
        q.load = Math.max(q.volume, q.load + amount);
        if (this.stress(q) > PLASTIC_PROFILE.compressiveYieldPa) this.wake(i);
        i = q.support;
      }
    };
    propagate(p.support, -p.load);
    this.supportedBy.get(p.support)?.delete(index);
    p.support = support;
    if (support >= 0) {
      let children = this.supportedBy.get(support);
      if (!children) this.supportedBy.set(support, children = new Set());
      children.add(index);
    }
    propagate(support, p.load);
  }

  step() {
    const active = [...this.awake].sort((a, b) => a - b);
    if (!active.length) return;
    this.dirtyStart = Math.min(this.dirtyStart, Math.max(0, active[0] - 2));
    const contacts = this.contacts(active);
    const constraints = new Set<number>();
    for (const i of active) for (let j = Math.max(0, i - 1); j <= Math.min(this.deposits.length - 1, i + 1); j++) constraints.add(j);
    const edges = [...constraints].sort((a, b) => a - b);
    for (let substep = 0; substep < PLASTIC_PROFILE.substeps; substep++) {
      for (const i of active) {
        const p = this.deposits[i];
        p.oldX = p.x; p.oldY = p.y; p.oldZ = p.z;
        const damping = 1 / (1 + PLASTIC_PROFILE.viscousDrag * DT);
        p.vx *= damping; p.vy = (p.vy - GRAVITY * DT) * damping; p.vz *= damping;
        const limit = Math.min(1, 0.006 / (Math.hypot(p.vx, p.vy, p.vz) * DT || 1));
        p.x += p.vx * DT * limit; p.y += p.vy * DT * limit; p.z += p.vz * DT * limit;
      }
      for (const i of edges) {
        const p = this.deposits[i];
        p.stretchLambda = p.bendLambdaX = p.bendLambdaY = p.bendLambdaZ = 0;
      }
      for (let iteration = 0; iteration < PLASTIC_PROFILE.iterations; iteration++) {
        for (const i of edges) this.stretch(i);
        for (const i of edges) this.bend(i);
        for (const pair of contacts) this.contact(pair.a, pair.b);
        for (const i of active) {
          const p = this.deposits[i], floor = this.floorAt(p.x, p.z);
          if (p.y - p.halfHeight < floor) {
            this.flatten(i);
            p.y = floor + p.halfHeight;
            p.x += (p.oldX - p.x) * 0.6; p.z += (p.oldZ - p.z) * 0.6;
          }
        }
      }
      for (const i of active) {
        const p = this.deposits[i];
        p.vx = (p.x - p.oldX) / DT; p.vy = (p.y - p.oldY) / DT; p.vz = (p.z - p.oldZ) / DT;
        const a = this.deposits[i - 1], b = this.deposits[i + 1];
        if (a && b && !p.breakBefore && !b.breakBefore && !a.gap && !b.gap) {
          const dx = p.x - (a.x + b.x) / 2 - p.bendX;
          const dy = p.y - (a.y + b.y) / 2 - p.bendY;
          const dz = p.z - (a.z + b.z) / 2 - p.bendZ;
          const error = Math.hypot(dx, dy, dz);
          const plastic = error > YIELD ? (1 - YIELD / error) * (1 - Math.exp(-DT * PLASTIC_PROFILE.plasticRate)) : 0;
          p.bendX += dx * plastic; p.bendY += dy * plastic; p.bendZ += dz * plastic;
        }
      }
    }
    // Contacts can change after a fall. Load follows only lower, older samples,
    // preventing cycles; it is a local single-support approximation, not stress FEM.
    const support = new Map<number, number>();
    for (const { a, b } of contacts) {
      const i = Math.max(a, b), j = Math.min(a, b);
      if (!this.awake.has(i) || i - j <= 8) continue;
      const p = this.deposits[i], q = this.deposits[j];
      const rx = p.thickness + q.thickness, ry = p.halfHeight + q.halfHeight;
      if (p.y <= q.y || Math.hypot((p.x - q.x) / rx, (p.y - q.y) / ry, (p.z - q.z) / rx) > 1.12) continue;
      const old = support.get(i);
      const distance = (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
      const previous = old === undefined ? undefined : this.deposits[old];
      if (!previous || distance < (p.x - previous.x) ** 2 + (p.z - previous.z) ** 2) support.set(i, j);
    }
    for (const i of active) {
      const p = this.deposits[i];
      this.changeSupport(i, support.get(i) ?? -1);
      const stress = this.stress(p);
      const excess = Math.max(0, stress / PLASTIC_PROFILE.compressiveYieldPa - 1);
      const oldHeight = p.halfHeight;
      p.halfHeight = Math.max(Math.min(p.restHalfHeight, LAYER_HEIGHT / 2) * 0.65,
        p.halfHeight * Math.exp(-excess * MATERIAL_DT * 0.012));
      const a = this.deposits[i - 1];
      let length = a && !p.breakBefore ? Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) : DS;
      if (!p.breakBefore && length > DS * PLASTIC_PROFILE.breakStretchRatio) {
        p.breakBefore = true;
        length = DS;
        this.wake(i - 1);
      } else if (length > p.restLength * PLASTIC_PROFILE.tensileYieldRatio) {
        p.restLength += (length - p.restLength * PLASTIC_PROFILE.tensileYieldRatio) * 0.04;
      }
      p.thickness = p.volume / Math.max(DS * 0.65, length) / Math.PI / p.halfHeight;
      p.radius = Math.hypot(p.x, p.z);
      this.maxWidth = Math.max(this.maxWidth, p.thickness, p.halfHeight);
      this.reindex(i);
      const moving = Math.hypot(p.vx, p.vy, p.vz) * DT + Math.abs(oldHeight - p.halfHeight);
      if (moving > 0.00002) {
        p.quiet = 0;
        for (const child of this.supportedBy.get(i) ?? []) this.wake(child);
      } else if (++p.quiet > 24) {
        this.awake.delete(i);
        p.vx = p.vy = p.vz = 0;
        p.oldX = p.x; p.oldY = p.y; p.oldZ = p.z;
      }
    }
  }
}

function randomSequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class PlasticSimulation {
  readonly body = new ClayStrand();
  readonly deposits = this.body.deposits;
  readonly pulses: SupplyPulse[] = [];
  tick = 0;
  stopStep = TOTAL_STEPS - RUNOUT_STEPS;
  flow = 1;
  pressure = 1;
  deliveredVolume = 0;
  depositedVolume = 0;
  tipVolume = 0;
  dirtyStart = 0;
  nozzle: NozzlePose = plannedNozzle(0);
  private eventIndex = 0;
  private pressureNoise = 0;
  private noiseUntil = 0;
  private pulseBudget: number;
  private pulseUntil = 0;
  private pulseIndex = 0;
  private readonly noiseRandom: () => number;
  private readonly pulseRandom: () => number;
  private readonly recordedPulses?: readonly SupplyPulse[];

  constructor(seed: number, record?: PlasticRecord) {
    this.noiseRandom = randomSequence(seed ^ 0x49c42a);
    this.pulseRandom = randomSequence(seed ^ 0xa31d75);
    this.pulseBudget = -Math.log(Math.max(1e-9, this.pulseRandom()));
    if (record) { this.stopStep = record.stopStep; this.recordedPulses = record.pulses; }
  }

  get pathEnd() { return Math.min(TOTAL_STEPS, this.stopStep + RUNOUT_STEPS); }
  get endTick() { return this.pathEnd + SETTLE_STEPS; }
  get complete() { return this.tick >= this.endTick; }
  stop() { this.stopStep = Math.min(this.stopStep, this.tick); }
  record(): PlasticRecord {
    return { version: 3, profile: PLASTIC_PROFILE.id, ticks: this.tick, stopStep: this.stopStep,
      pulses: this.pulses.map((pulse) => ({ ...pulse })) };
  }

  advanceTo(target: number, events: readonly ProcessEvent[]) {
    this.body.dirtyStart = this.deposits.length;
    const end = Math.min(Math.floor(target), this.endTick);
    while (this.tick < end) {
      while (this.eventIndex + 1 < events.length && events[this.eventIndex + 1].step <= this.tick) this.eventIndex++;
      if (this.tick < this.pathEnd) {
        this.advanceFlow(events[this.eventIndex] ?? { fluctuation: 0, interruption: 0, sag: true });
        const volume = this.flow < 0.085 ? 0 : this.tipVolume;
        if (volume) { this.tipVolume = 0; this.depositedVolume += volume; }
        const pose = plannedNozzle(this.tick);
        this.body.add(pose.x, pose.contactY, pose.z, volume, this.tick);
      }
      this.body.step();
      this.tick++;
    }
    this.dirtyStart = this.body.dirtyStart;
    this.nozzle = plannedNozzle(Math.max(0, Math.min(this.tick, this.pathEnd - 1)));
    this.nozzle.flow = this.tick < this.pathEnd ? this.flow : 0;
    const last = this.deposits.at(-1);
    this.nozzle.contactY = last && !last.gap ? last.y : this.nozzle.y;
    if (this.tick >= this.pathEnd) this.nozzle.y += Math.min(1, (this.tick - this.pathEnd) / 80) * 0.28;
  }

  // Keep the v2 pressure/flow law and seeded supply events; only deposition changes.
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

export function validPlasticRecord(value: unknown, steps: number): value is PlasticRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as PlasticRecord;
  return record.version === 3 && record.profile === PLASTIC_PROFILE.id &&
    validMaterialRecord({ ...record, version: 2, profile: MATERIAL_PROFILE.id }, steps);
}
