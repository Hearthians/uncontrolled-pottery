import {
  isPottery as isLegacyPottery,
  generateDeposits as generateLegacyDeposits,
  PRESETS as LEGACY_PRESETS,
} from "./simulation.ts";
import type { Pottery as LegacyPottery } from "./simulation.ts";
import { MaterialSimulation, MATERIAL_PROFILE, MATERIAL_TICKS, RUNOUT_STEPS, validMaterialRecord } from "./materialSimulation.ts";
import type { MaterialRecord, NozzlePose } from "./materialSimulation.ts";
import { PlasticSimulation, validPlasticRecord } from "./plasticSimulation.ts";
import type { PlasticRecord } from "./plasticSimulation.ts";
import { HeightfieldSimulation, validHeightfieldRecord } from "./heightfieldSimulation.ts";
import type { HeightfieldRecord, HeightfieldSurface } from "./heightfieldSimulation.ts";
import type { Deposit } from "./simulation.ts";
import { isEmotionPlan } from "./emotionTrajectory.ts";
import type { EmotionPlan } from "./emotionTrajectory.ts";

export { DURATION, LAYERS, SEGMENTS, TOTAL_STEPS, meanSettings } from "./simulation.ts";
export type { Settings, ProcessEvent } from "./simulation.ts";
export type Pottery = LegacyPottery & { simulation?: MaterialRecord | PlasticRecord | HeightfieldRecord; emotionPlan?: EmotionPlan };
export type SceneDeposit = Deposit & { halfHeight?: number; breakBefore?: boolean };
export const DEFAULT_SETTINGS = { fluctuation: 0, interruption: 0, sag: true };

export function isPottery(value: unknown): value is Pottery {
  try {
    if (!isLegacyPottery(value)) return false;
    const pottery = value as Pottery;
    return (pottery.simulation === undefined ||
      validMaterialRecord(pottery.simulation, pottery.steps) ||
      validPlasticRecord(pottery.simulation, pottery.steps) ||
      validHeightfieldRecord(pottery.simulation, pottery.steps)) &&
      (pottery.emotionPlan === undefined || isEmotionPlan(pottery.emotionPlan));
  } catch {
    return false;
  }
}

export type SceneMaterial = { deposits: SceneDeposit[]; surface?: HeightfieldSurface; nozzle?: NozzlePose };

export function generateMaterial(pottery: Pottery): SceneMaterial {
  if (!pottery.simulation) return { deposits: generateLegacyDeposits(pottery) };
  const simulation = pottery.simulation.version === 4
    ? new HeightfieldSimulation(pottery.seed, pottery.simulation)
    : pottery.simulation.version === 3
      ? new PlasticSimulation(pottery.seed, pottery.simulation)
      : new MaterialSimulation(pottery.seed, pottery.simulation);
  simulation.advanceTo(pottery.simulation.ticks, pottery.events);
  return { deposits: simulation.deposits, nozzle: simulation.nozzle,
    ...(simulation instanceof HeightfieldSimulation ? { surface: simulation.surface } : {}) };
}

export function generateDeposits(pottery: Pottery): SceneDeposit[] {
  return generateMaterial(pottery).deposits;
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
