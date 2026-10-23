export const LAYERS = 64;
export const SEGMENTS = 160;
export const TOTAL_STEPS = LAYERS * SEGMENTS;
export const DURATION = 55;
export const LAYER_HEIGHT = 0.043;
export const BASE_RADIUS = 1.12;

export type Settings = {
  fluctuation: number;
  interruption: number;
  sag: boolean;
};
export type ProcessEvent = Settings & { step: number };
export type Deposit = {
  x: number;
  y: number;
  z: number;
  radius: number;
  thickness: number;
  gap: boolean;
};
export type Pottery = {
  id: string;
  title: string;
  seed: number;
  steps: number;
  events: ProcessEvent[];
  createdAt: string;
  duration: number;
  preset?: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  fluctuation: 35,
  interruption: 12,
  sag: false,
};

function noise(n: number, seed: number) {
  const v = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export function createDeposit(
  index: number,
  settings: Settings,
  seed: number,
  previous: Deposit[],
): Deposit {
  const layer = Math.floor(index / SEGMENTS);
  const theta = (index / SEGMENTS) * Math.PI * 2;
  const f = Math.max(0, Math.min(100, settings.fluctuation)) / 100;
  const interruption = Math.max(0, Math.min(100, settings.interruption)) / 100;
  const wave =
    Math.sin(theta * 5 + layer * 0.39 + seed) * 0.48 +
    Math.sin(theta * 11 - layer * 0.22) * 0.27 +
    Math.sin(theta * 2 + layer * 0.17) * 0.25;
  const roughness = (noise(index, seed) - 0.5) * 0.007 * f;
  const radius =
    BASE_RADIUS +
    f * (wave * 0.17 + Math.sin(theta * 3 + layer * 0.09) * 0.035) +
    roughness;
  const thickness = Math.max(0.013, 0.031 + wave * f * 0.029 + roughness);
  // Short supply interruptions affect only the segment being deposited.
  const gap =
    layer > 1 && noise(Math.floor(index / 5), seed + 7) < interruption * 0.58;
  const support = previous[index - SEGMENTS];
  const plannedY = 0.055 + (index / SEGMENTS) * LAYER_HEIGHT;
  const sag =
    settings.sag && support && !gap
      ? Math.min(
          0.1,
          support.gap
            ? 0.055
            : Math.max(0, plannedY - support.y - LAYER_HEIGHT) * 0.65,
        )
      : 0;
  return {
    x: Math.cos(theta) * radius,
    y: plannedY - sag,
    z: Math.sin(theta) * radius,
    radius,
    thickness,
    gap,
  };
}

export function generateDeposits(
  pottery: Pick<Pottery, "seed" | "steps" | "events">,
): Deposit[] {
  const deposits: Deposit[] = [];
  let eventIndex = 0;
  for (let i = 0; i < Math.min(TOTAL_STEPS, pottery.steps); i++) {
    while (
      eventIndex + 1 < pottery.events.length &&
      pottery.events[eventIndex + 1].step <= i
    )
      eventIndex++;
    deposits.push(
      createDeposit(
        i,
        pottery.events[eventIndex] ?? DEFAULT_SETTINGS,
        pottery.seed,
        deposits,
      ),
    );
  }
  return deposits;
}

export function settingsAt(pottery: Pottery, step: number): Settings {
  let result: Settings = DEFAULT_SETTINGS;
  for (const event of pottery.events) {
    if (event.step > step) break;
    result = event;
  }
  return result;
}

export function meanSettings(pottery: Pottery): {
  fluctuation: number;
  interruption: number;
} {
  let fluctuation = 0;
  let interruption = 0;
  for (let i = 0; i < pottery.events.length; i++) {
    const event = pottery.events[i];
    const length = Math.max(
      0,
      Math.min(pottery.steps, pottery.events[i + 1]?.step ?? pottery.steps) -
        event.step,
    );
    fluctuation += event.fluctuation * length;
    interruption += event.interruption * length;
  }
  return {
    fluctuation: Math.round(fluctuation / (pottery.steps || 1)),
    interruption: Math.round(interruption / (pottery.steps || 1)),
  };
}

export function isPottery(value: unknown): value is Pottery {
  if (!value || typeof value !== "object") return false;
  const p = value as Pottery;
  return (
    typeof p.id === "string" &&
    typeof p.title === "string" &&
    Number.isFinite(p.seed) &&
    Number.isInteger(p.steps) &&
    p.steps >= 0 &&
    p.steps <= TOTAL_STEPS &&
    typeof p.createdAt === "string" &&
    Number.isFinite(p.duration) &&
    Array.isArray(p.events) &&
    p.events.length > 0 &&
    p.events[0].step === 0 &&
    p.events.every(
      (e, i) =>
        Number.isInteger(e.step) &&
        e.step >= 0 &&
        e.step <= TOTAL_STEPS &&
        (i === 0 || e.step >= p.events[i - 1].step) &&
        Number.isFinite(e.fluctuation) &&
        e.fluctuation >= 0 &&
        e.fluctuation <= 100 &&
        Number.isFinite(e.interruption) &&
        e.interruption >= 0 &&
        e.interruption <= 100 &&
        typeof e.sag === "boolean",
    )
  );
}

export const PRESETS: Pottery[] = [
  {
    id: "study-001",
    title: "秩序之外",
    seed: 19,
    steps: TOTAL_STEPS,
    duration: DURATION,
    createdAt: "2026-10-01T10:00:00Z",
    preset: true,
    events: [
      { step: 0, fluctuation: 78, interruption: 9, sag: false },
      { step: 4900, fluctuation: 22, interruption: 15, sag: false },
      { step: 7600, fluctuation: 42, interruption: 18, sag: false },
    ],
  },
  {
    id: "study-002",
    title: "留白的容器",
    seed: 63,
    steps: TOTAL_STEPS,
    duration: DURATION,
    createdAt: "2026-10-01T11:00:00Z",
    preset: true,
    events: [
      { step: 0, fluctuation: 18, interruption: 8, sag: false },
      { step: 2600, fluctuation: 35, interruption: 54, sag: true },
      { step: 7400, fluctuation: 12, interruption: 5, sag: true },
    ],
  },
  {
    id: "study-003",
    title: "缓慢的偏离",
    seed: 112,
    steps: TOTAL_STEPS,
    duration: DURATION,
    createdAt: "2026-10-01T12:00:00Z",
    preset: true,
    events: [
      { step: 0, fluctuation: 10, interruption: 0, sag: false },
      { step: 3500, fluctuation: 47, interruption: 8, sag: false },
      { step: 6900, fluctuation: 95, interruption: 14, sag: false },
    ],
  },
];
