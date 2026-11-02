import { LAYERS, SEGMENTS } from "./simulation.ts";
import type { ProcessEvent, Settings } from "./simulation.ts";

export type EmotionPoint = {
  position: number;
  label: string;
  valence: number;
  arousal: number;
  dominance: number;
  sourceMemoryIndices: number[];
  sourceChunks: number[];
};

export type EmotionPlan = {
  version: 1;
  title: string;
  summary: string;
  methodNote: string;
  memoryCount: number;
  model: string;
  promptVersion: string;
  mappingVersion: string;
  trajectory: EmotionPoint[];
};

export const COLLECTIVE_EMOTION_PLAN: EmotionPlan = {
  version: 1,
  title: "Closeness and Its Boundaries",
  summary:
    "Everyday care forms the base; wonder and achievement open it. Pressure, shame, anger, danger, grief and isolation tighten the form. Choice and quiet self-care make space again, without undoing every loss.",
  methodNote:
    "A dramatic arc composed from 1,910 collective memories—not a shared chronology, a single life story, or a psychological diagnosis.",
  memoryCount: 1910,
  model: "claude-opus-5-5",
  promptVersion: "collective-memory-dramaturgy-1",
  mappingVersion: "emotion-behavior-2",
  trajectory: [
    {
      position: 0,
      label: "Everyday care",
      valence: 0.84,
      arousal: 0.3,
      dominance: 0.62,
      sourceMemoryIndices: [121, 333, 427, 692, 898, 1209, 1419, 1828, 1901],
      sourceChunks: [2, 4, 5, 7, 9, 13, 15, 19, 20],
    },
    {
      position: 0.09,
      label: "Wonder and play",
      valence: 0.87,
      arousal: 0.75,
      dominance: 0.61,
      sourceMemoryIndices: [25, 295, 345, 414, 630, 945, 1018, 1327, 1815, 1907],
      sourceChunks: [1, 3, 4, 5, 7, 10, 11, 14, 19, 20],
    },
    {
      position: 0.18,
      label: "Ability recognized",
      valence: 0.85,
      arousal: 0.71,
      dominance: 0.85,
      sourceMemoryIndices: [81, 104, 406, 628, 817, 1340, 1566, 1605, 1869, 1908],
      sourceChunks: [1, 2, 5, 7, 9, 14, 16, 17, 19, 20],
    },
    {
      position: 0.27,
      label: "Pressure to succeed",
      valence: -0.8,
      arousal: 0.75,
      dominance: 0.2,
      sourceMemoryIndices: [109, 110, 341, 400, 635, 852, 853, 996, 1168, 1739, 1818],
      sourceChunks: [2, 4, 7, 9, 10, 12, 18, 19],
    },
    {
      position: 0.36,
      label: "Exposure and self-doubt",
      valence: -0.86,
      arousal: 0.76,
      dominance: 0.16,
      sourceMemoryIndices: [298, 426, 750, 1026, 1166, 1390, 1420, 1567, 1777],
      sourceChunks: [3, 5, 8, 11, 12, 14, 15, 16, 18],
    },
    {
      position: 0.45,
      label: "Anger without choice",
      valence: -0.79,
      arousal: 0.87,
      dominance: 0.32,
      sourceMemoryIndices: [128, 428, 1469, 1574, 1581, 1593, 1774, 1778, 1900],
      sourceChunks: [2, 5, 15, 16, 18, 19],
    },
    {
      position: 0.54,
      label: "Losing control",
      valence: -0.91,
      arousal: 0.95,
      dominance: 0.11,
      sourceMemoryIndices: [7, 66, 343, 693, 712, 1023, 1145, 1146, 1416, 1523, 1843],
      sourceChunks: [1, 4, 7, 8, 11, 12, 15, 16, 19],
    },
    {
      position: 0.63,
      label: "Irreversible loss",
      valence: -0.95,
      arousal: 0.65,
      dominance: 0.12,
      sourceMemoryIndices: [3, 234, 422, 486, 561, 754, 821, 977, 1070, 1271, 1663, 1772],
      sourceChunks: [1, 3, 5, 6, 8, 9, 10, 11, 13, 17, 18],
    },
    {
      position: 0.72,
      label: "Distance without closure",
      valence: -0.79,
      arousal: 0.39,
      dominance: 0.19,
      sourceMemoryIndices: [87, 140, 531, 629, 636, 731, 951, 1084, 1418, 1606, 1614, 1633],
      sourceChunks: [1, 2, 6, 7, 8, 10, 11, 15, 17],
    },
    {
      position: 0.81,
      label: "Reclaiming choice",
      valence: 0.38,
      arousal: 0.62,
      dominance: 0.74,
      sourceMemoryIndices: [292, 567, 729, 788, 1079, 1118, 1170, 1574, 1779, 1895],
      sourceChunks: [3, 6, 8, 11, 12, 16, 18, 19],
    },
    {
      position: 0.9,
      label: "Enough beyond achievement",
      valence: 0.74,
      arousal: 0.18,
      dominance: 0.67,
      sourceMemoryIndices: [145, 438, 478, 573, 688, 1172, 1185, 1206, 1210, 1487, 1693, 1905],
      sourceChunks: [2, 5, 6, 7, 12, 13, 15, 17, 20],
    },
    {
      position: 1,
      label: "Love, leaving, possibility",
      valence: 0.34,
      arousal: 0.52,
      dominance: 0.48,
      sourceMemoryIndices: [68, 420, 568, 810, 1173, 1299, 1300, 1334, 1423, 1881, 1906, 1909],
      sourceChunks: [1, 5, 6, 9, 12, 13, 14, 15, 19, 20],
    },
  ],
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function emotionToSettings(
  point: Pick<EmotionPoint, "valence" | "arousal" | "dominance">,
): Settings {
  const negative = Math.max(0, -point.valence);
  const lossOfControl = 1 - point.dominance;
  return {
    fluctuation: clamp(
      4 + point.arousal * 48 + lossOfControl * point.arousal * 24 + negative * 12,
    ),
    interruption: clamp(
      1 + negative * (0.4 + lossOfControl * 0.6) * 48 + lossOfControl * point.arousal * 20,
    ),
    // Emotion changes supply only, never the material. V3 ignores this legacy flag.
    sag: true,
  };
}

export function emotionAt(
  progress: number,
  plan: EmotionPlan = COLLECTIVE_EMOTION_PLAN,
): EmotionPoint {
  const value = Math.max(0, Math.min(1, progress));
  let index = plan.trajectory.findIndex((point) => point.position >= value);
  if (index <= 0) return { ...plan.trajectory[0] };
  if (index < 0) return { ...plan.trajectory.at(-1)! };
  const before = plan.trajectory[index - 1];
  const after = plan.trajectory[index];
  const amount = (value - before.position) / (after.position - before.position);
  return {
    position: value,
    label: amount < 0.5 ? before.label : after.label,
    valence: before.valence + (after.valence - before.valence) * amount,
    arousal: before.arousal + (after.arousal - before.arousal) * amount,
    dominance: before.dominance + (after.dominance - before.dominance) * amount,
    sourceMemoryIndices:
      amount < 0.5 ? [...before.sourceMemoryIndices] : [...after.sourceMemoryIndices],
    sourceChunks: amount < 0.5 ? [...before.sourceChunks] : [...after.sourceChunks],
  };
}

/** Sample the original full-plan layer, including when a print stops early. */
export function emotionAtStep(
  step: number,
  plan: EmotionPlan = COLLECTIVE_EMOTION_PLAN,
): EmotionPoint {
  const layer = Math.max(0, Math.min(LAYERS - 1, Math.floor(step / SEGMENTS)));
  return emotionAt(layer / (LAYERS - 1), plan);
}

export function emotionPlanToEvents(
  plan: EmotionPlan = COLLECTIVE_EMOTION_PLAN,
): ProcessEvent[] {
  return Array.from({ length: LAYERS }, (_, layer) => ({
    step: layer * SEGMENTS,
    ...emotionToSettings(emotionAtStep(layer * SEGMENTS, plan)),
  }));
}

export function isEmotionPlan(value: unknown): value is EmotionPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as EmotionPlan;
  return plan.version === 1 && typeof plan.title === "string" &&
    typeof plan.summary === "string" && typeof plan.methodNote === "string" &&
    Number.isInteger(plan.memoryCount) && plan.memoryCount > 0 &&
    typeof plan.model === "string" && typeof plan.promptVersion === "string" &&
    typeof plan.mappingVersion === "string" && Array.isArray(plan.trajectory) &&
    plan.trajectory.length >= 2 && plan.trajectory.every((point, index) =>
      Number.isFinite(point.position) && point.position >= 0 && point.position <= 1 &&
      (index === 0 || point.position > plan.trajectory[index - 1].position) &&
      typeof point.label === "string" && Number.isFinite(point.valence) &&
      point.valence >= -1 && point.valence <= 1 && Number.isFinite(point.arousal) &&
      point.arousal >= 0 && point.arousal <= 1 && Number.isFinite(point.dominance) &&
      point.dominance >= 0 && point.dominance <= 1 &&
      Array.isArray(point.sourceMemoryIndices) &&
      point.sourceMemoryIndices.every(Number.isInteger) &&
      Array.isArray(point.sourceChunks) && point.sourceChunks.every(Number.isInteger));
}
