import {
  isPottery as isLegacyPottery,
  generateDeposits as generateLegacyDeposits,
  PRESETS as LEGACY_PRESETS,
} from "./simulation.ts";
import type { Pottery as LegacyPottery } from "./simulation.ts";
import { MaterialSimulation, MATERIAL_PROFILE, MATERIAL_TICKS, RUNOUT_STEPS, validMaterialRecord } from "./materialSimulation.ts";
import type { MaterialRecord } from "./materialSimulation.ts";
import type { Deposit } from "./simulation.ts";

export { DURATION, LAYERS, SEGMENTS, TOTAL_STEPS, meanSettings } from "./simulation.ts";
export type { Settings, ProcessEvent } from "./simulation.ts";
export type Pottery = LegacyPottery & { simulation?: MaterialRecord };
export type SceneDeposit = Deposit & { halfHeight?: number };
export const DEFAULT_SETTINGS = { fluctuation: 0, interruption: 0, sag: true };

export function isPottery(value: unknown): value is Pottery {
  try {
    if (!isLegacyPottery(value)) return false;
    const pottery = value as Pottery;
    return pottery.simulation === undefined || validMaterialRecord(pottery.simulation, pottery.steps);
  } catch {
    return false;
  }
}

export function generateDeposits(pottery: Pottery): SceneDeposit[] {
  if (!pottery.simulation) return generateLegacyDeposits(pottery);
  const simulation = new MaterialSimulation(pottery.seed, pottery.simulation);
  simulation.advanceTo(pottery.simulation.ticks, pottery.events);
  return simulation.deposits;
}

export const PRESETS: Pottery[] = LEGACY_PRESETS.map((pottery) => ({
  ...pottery,
  id: `material-${pottery.id}`,
  simulation: {
    version: 2,
    profile: MATERIAL_PROFILE.id,
    ticks: MATERIAL_TICKS,
    stopStep: pottery.steps - RUNOUT_STEPS,
  },
  events: pottery.events.map((event) => ({ ...event, sag: true })),
}));
