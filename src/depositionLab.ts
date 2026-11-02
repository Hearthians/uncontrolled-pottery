export type LabCase = "single" | "layers" | "restart";
export type LabConfig = {
  cellMm: number;
  nozzleMm: number;
  clearanceMm: number;
  speedMmS: number;
  feedMm3S: number;
  yieldPa: number;
  viscosityPaS: number;
  squeezePaPerMm: number;
  densityKgM3: number;
};

export const LAB_DEFAULTS: Readonly<LabConfig> = Object.freeze({
  cellMm: 0.5,
  nozzleMm: 6,
  clearanceMm: 2,
  speedMmS: 10,
  feedMm3S: 120,
  yieldPa: 1500,
  viscosityPaS: 250,
  squeezePaPerMm: 6000,
  densityKgM3: 1700,
});
export const LAB_DT = 0.005;
const LENGTH = 56;
const WIDTH = 24;
const START = -18;
const END = 18;
const DWELL = 0.35;

export type LabSnapshot = {
  config: LabConfig;
  kind: LabCase;
  nx: number;
  nz: number;
  tick: number;
  endTick: number;
  height: Float64Array;
  layers: Float64Array[];
  injectedMm3: number;
  nozzle: { x: number; z: number; y: number; depositing: boolean };
};

/** A 2.5D shallow-layer Bingham flux experiment, in mm/seconds/Pa.
 * It cannot describe overhangs, voids under clay, fracture, or a full nozzle flow.
 * Each cell stores deposited volume per plan area, not a tube radius. Pressure
 * redistributes that volume. The nozzle penalty is illustrative, not calibrated.
 */
export class DepositionLab {
  readonly config: LabConfig;
  readonly kind: LabCase;
  readonly nx: number;
  readonly nz: number;
  readonly height: Float64Array;
  readonly layers: Float64Array[];
  readonly endTick: number;
  tick = 0;
  injectedMm3 = 0;
  nozzle = { x: START, z: 0, y: 0, depositing: false };
  private readonly pressure: Float64Array;
  private readonly pressureSlope: Float64Array;
  private readonly outgoing: Float64Array;
  private readonly deltas: Float64Array[];
  private readonly fluxX: Float64Array;
  private readonly fluxZ: Float64Array;
  private readonly passTicks: number;
  private readonly dwellTicks: number;
  private readonly layerCount: number;

  constructor(kind: LabCase, settings: Partial<LabConfig> = {}) {
    this.kind = kind;
    this.config = { ...LAB_DEFAULTS, ...settings };
    for (const value of Object.values(this.config)) {
      if (!Number.isFinite(value) || value <= 0) throw new Error("Lab parameters must be positive and finite");
    }
    if (![0.5, 1].includes(this.config.cellMm) || this.config.clearanceMm > 6 ||
      this.config.nozzleMm > 10 || this.config.speedMmS > 50 || this.config.feedMm3S > 500)
      throw new Error("Unsupported lab configuration");
    this.nx = Math.round(LENGTH / this.config.cellMm);
    this.nz = Math.round(WIDTH / this.config.cellMm);
    this.layerCount = kind === "layers" ? 3 : 1;
    this.height = new Float64Array(this.nx * this.nz);
    this.layers = Array.from({ length: this.layerCount }, () => new Float64Array(this.height.length));
    this.deltas = this.layers.map(() => new Float64Array(this.height.length));
    this.pressure = new Float64Array(this.height.length);
    this.pressureSlope = new Float64Array(this.height.length);
    this.outgoing = new Float64Array(this.height.length);
    this.fluxX = new Float64Array(this.height.length);
    this.fluxZ = new Float64Array(this.height.length);
    this.passTicks = Math.round((END - START) / this.config.speedMmS / LAB_DT);
    this.dwellTicks = Math.round(DWELL / LAB_DT);
    this.endTick = this.layerCount * (this.passTicks + this.dwellTicks) + Math.round(1 / LAB_DT);
  }

  get complete() { return this.tick >= this.endTick; }
  xAt(i: number) { return (i + 0.5) * this.config.cellMm - LENGTH / 2; }
  zAt(j: number) { return (j + 0.5) * this.config.cellMm - WIDTH / 2; }

  private inject(layer: number, x: number, amount: number) {
    const dx = this.config.cellMm;
    const radius = this.config.nozzleMm / 2;
    const cells: { index: number; weight: number }[] = [];
    let weights = 0;
    const lo = Math.max(0, Math.floor((x - radius + LENGTH / 2) / dx));
    const hi = Math.min(this.nx - 1, Math.ceil((x + radius + LENGTH / 2) / dx));
    const zlo = Math.max(0, Math.floor((WIDTH / 2 - radius) / dx));
    const zhi = Math.min(this.nz - 1, Math.ceil((WIDTH / 2 + radius) / dx));
    for (let j = zlo; j <= zhi; j++) for (let i = lo; i <= hi; i++) {
      const r2 = ((this.xAt(i) - x) ** 2 + this.zAt(j) ** 2) / (radius * radius);
      if (r2 >= 1) continue;
      const weight = (1 - r2) ** 2;
      cells.push({ index: j * this.nx + i, weight });
      weights += weight;
    }
    for (const cell of cells) {
      const increment = amount * cell.weight / weights / (dx * dx);
      this.layers[layer][cell.index] += increment;
      this.height[cell.index] += increment;
    }
    this.injectedMm3 += amount;
  }

  private flow(a: number, b: number) {
    const h = Math.max(this.height[a], this.height[b]);
    if (h < 1e-10) return 0;
    const gradient = (this.pressure[a] - this.pressure[b]) / this.config.cellMm;
    const shear = h * Math.abs(gradient);
    if (shear <= this.config.yieldPa) return 0;
    const ratio = this.config.yieldPa / shear;
    const mobility = h ** 3 / (3 * this.config.viscosityPaS) * (1 - 1.5 * ratio + 0.5 * ratio ** 3);
    // Locally implicit pressure response limits explicit grid oscillation without
    // changing volume or applying an aesthetic smoothing pass to the surface.
    const response = mobility * LAB_DT / (this.config.cellMm ** 2);
    return response * (this.pressure[a] - this.pressure[b]) /
      (1 + 4 * response * Math.max(this.pressureSlope[a], this.pressureSlope[b]));
  }

  private transfer(a: number, b: number, raw: number) {
    const donor = raw >= 0 ? a : b, receiver = raw >= 0 ? b : a;
    if (raw === 0 || this.height[donor] === 0) return;
    const limit = Math.min(1, this.height[donor] * 0.22 / this.outgoing[donor]);
    const transfer = Math.abs(raw) * limit;
    for (let layer = 0; layer < this.layers.length; layer++) {
      const part = transfer * this.layers[layer][donor] / this.height[donor];
      this.deltas[layer][donor] -= part;
      this.deltas[layer][receiver] += part;
    }
  }

  step() {
    if (this.complete) return;
    const pass = Math.floor(this.tick / (this.passTicks + this.dwellTicks));
    const withinTick = this.tick % (this.passTicks + this.dwellTicks);
    const within = withinTick * LAB_DT;
    const travelling = pass < this.layerCount && withinTick < this.passTicks;
    const x = START + Math.min(this.passTicks, withinTick) * LAB_DT * this.config.speedMmS;
    const ceiling = (pass + 1) * this.config.clearanceMm;
    // A commanded stop still has finite supply response; no stored reservoir is
    // discharged into a single segment when flow resumes.
    let feed = 1;
    if (this.kind === "restart") {
      const stop = 1.25, resume = 2.25, response = 0.12;
      if (within >= stop && within < resume) feed = Math.exp(-(within - stop) / response);
      else if (within >= resume) feed = 1 - (1 - Math.exp(-(resume - stop) / response)) * Math.exp(-(within - resume) / response);
    }
    if (travelling) this.inject(pass, x, this.config.feedMm3S * feed * LAB_DT);
    this.nozzle = { x, z: 0, y: ceiling, depositing: travelling && feed > 0.01 };
    const radius2 = (this.config.nozzleMm / 2 + 0.6) ** 2;
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const index = j * this.nx + i, h = this.height[index];
      const inside = travelling && (this.xAt(i) - x) ** 2 + this.zAt(j) ** 2 < radius2;
      this.pressure[index] = this.config.densityKgM3 * 9.81 * h / 1000 +
        (inside ? this.config.squeezePaPerMm * Math.max(0, h - ceiling) : 0);
      this.pressureSlope[index] = this.config.densityKgM3 * 9.81 / 1000 +
        (inside && h > ceiling ? this.config.squeezePaPerMm : 0);
    }
    this.outgoing.fill(0);
    this.fluxX.fill(0); this.fluxZ.fill(0);
    for (const delta of this.deltas) delta.fill(0);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const a = j * this.nx + i;
      if (i + 1 < this.nx) {
        const flux = this.flow(a, a + 1);
        this.fluxX[a] = flux;
        this.outgoing[flux >= 0 ? a : a + 1] += Math.abs(flux);
      }
      if (j + 1 < this.nz) {
        const flux = this.flow(a, a + this.nx);
        this.fluxZ[a] = flux;
        this.outgoing[flux >= 0 ? a : a + this.nx] += Math.abs(flux);
      }
    }
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const a = j * this.nx + i;
      if (i + 1 < this.nx) this.transfer(a, a + 1, this.fluxX[a]);
      if (j + 1 < this.nz) this.transfer(a, a + this.nx, this.fluxZ[a]);
    }
    for (let i = 0; i < this.height.length; i++) {
      let h = 0;
      for (let layer = 0; layer < this.layers.length; layer++) {
        this.layers[layer][i] += this.deltas[layer][i];
        h += this.layers[layer][i];
      }
      this.height[i] = h;
    }
    this.tick++;
  }

  advanceTo(target: number) {
    const end = Math.min(Math.floor(target), this.endTick);
    while (this.tick < end) this.step();
  }

  snapshot(): LabSnapshot {
    return { config: { ...this.config }, kind: this.kind, nx: this.nx, nz: this.nz,
      tick: this.tick, endTick: this.endTick, height: this.height.slice(),
      layers: this.layers.map((layer) => layer.slice()), injectedMm3: this.injectedMm3,
      nozzle: { ...this.nozzle } };
  }
}

export function labMetrics(snapshot: LabSnapshot) {
  const { nx, nz, config, height, layers } = snapshot;
  const cellArea = config.cellMm ** 2;
  const volumeMm3 = height.reduce((sum, h) => sum + h * cellArea, 0);
  const center = Math.floor(nx / 2);
  const profile = Array.from({ length: nz }, (_, j) => ({
    zMm: (j + 0.5) * config.cellMm - WIDTH / 2,
    heightMm: height[j * nx + center],
    layersMm: layers.map((layer) => layer[j * nx + center]),
  }));
  const occupied = profile.filter((point) => point.heightMm > 0.05);
  return {
    volumeMm3,
    massErrorPercent: snapshot.injectedMm3 > 0 ? (volumeMm3 / snapshot.injectedMm3 - 1) * 100 : 0,
    widthMm: occupied.length * config.cellMm,
    peakMm: Math.max(...height),
    centerHeightMm: Math.max(...profile.map((p) => p.heightMm)),
    profile,
  };
}

export const LAB_CASES: Record<LabCase, { title: string; description: string }> = {
  single: { title: "One strand", description: "A 6 mm nozzle lays a straight bead. Compare the same volume at different nozzle clearances." },
  layers: { title: "Three layers", description: "Three passes occupy the same volume field. No separate tube meshes or hidden overlapping interior walls." },
  restart: { title: "Stop and restart", description: "Supply decays and recovers over 0.12 s while travel continues. A real empty gap must not be filled by surface smoothing." },
};
