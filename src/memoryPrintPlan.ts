import { SCORE_KEYS, validateScores, type Scores } from "../shared/memoryAnalysis.ts";
import { LAYERS, SEGMENTS, type ProcessEvent } from "./simulation.ts";

type MemoryScores = { scores?: Scores; demoScores?: boolean };
type Contribution = { start: number; end: number };

/**
 * Compile ordered, equally long memory intervals into a full print plan.
 * Contribution ranges describe direct overlaps before smoothing; each event can
 * also be influenced by the adjacent layers' ranges through the smoothing kernel.
 */
export function compileMemoryPrintPlan(
  memories: readonly MemoryScores[],
  mode: "analyzed" | "demo",
): { events: ProcessEvent[]; contributions: Contribution[]; blendedScores: Scores[] } {
  if (!Array.isArray(memories) || memories.length === 0 || (mode !== "analyzed" && mode !== "demo")) {
    throw new Error("A nonempty memory collection and valid mode are required");
  }

  const scores: Scores[] = [];
  for (const memory of memories) {
    if (!memory || !validateScores(memory.scores) ||
      (mode === "demo" ? memory.demoScores !== true : memory.demoScores !== undefined && memory.demoScores !== false)) {
      throw new Error("Invalid memory scores or provenance");
    }
    scores.push(memory.scores);
  }

  const count = scores.length;
  const contributions: Contribution[] = [];
  const layerScores: Scores[] = [];
  for (let layer = 0; layer < LAYERS; layer++) {
    // Scale the whole timeline to count * LAYERS: each layer is count
    // units wide, and each memory is LAYERS units wide.
    const left = layer * count;
    const right = (layer + 1) * count;
    const start = Math.floor(left / LAYERS);
    const end = Math.ceil(right / LAYERS);
    contributions.push({ start, end });
    const sum: Scores = { calm: 0, anxiety: 0, anger: 0, stress: 0, sadness: 0 };
    for (let index = start; index < end; index++) {
      const weight = Math.min(right, (index + 1) * LAYERS) - Math.max(left, index * LAYERS);
      for (const key of SCORE_KEYS) sum[key] += scores[index][key] * weight;
    }
    for (const key of SCORE_KEYS) sum[key] /= count;
    layerScores.push(sum);
  }

  const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
  const blendedScores = layerScores.map((current, layer): Scores => {
    const before = layerScores[Math.max(0, layer - 1)];
    const after = layerScores[Math.min(LAYERS - 1, layer + 1)];
    const smooth = (key: keyof Scores) => (before[key] + 2 * current[key] + after[key]) / 4;
    return { calm: smooth("calm"), anxiety: smooth("anxiety"), anger: smooth("anger"), stress: smooth("stress"), sadness: smooth("sadness") };
  });
  const events = blendedScores.map((scores, layer): ProcessEvent => {
    const c = scores.calm / 5, a = scores.anxiety / 5, g = scores.anger / 5;
    const t = scores.stress / 5, s = scores.sadness / 5;
    return {
      step: layer * SEGMENTS,
      fluctuation: clamp(12 + 18 * a + 26 * g + 14 * t + 4 * s - 8 * c),
      interruption: clamp(2 + 8 * a + 4 * g + 12 * t + 14 * s - 2 * c),
      sag: true,
    };
  });
  return { events, contributions, blendedScores };
}
