import { LAYERS, SEGMENTS, TOTAL_STEPS, type ProcessEvent } from "./simulation.ts";
import { MATERIAL_TICKS, RUNOUT_STEPS } from "./materialSimulation.ts";
import { PLASTIC_PROFILE } from "./plasticSimulation.ts";
import type { Pottery } from "./pottery.ts";

export type MemoryRegion = {
  id: string;
  indices: number[];
  center: number;
  min: number;
  max: number;
  meanPairwiseCosine: number;
  representatives: number[];
};
export type RegionStudy = {
  version: 1;
  corpusSha256: string;
  count: number;
  embedding: { source: string; model: string; dimensions: number };
  projection: { method: "pca-1d"; normalization: "l2"; orientation: string;
    explainedVariance: number; iterations: number; residual: number; rawRange: [number, number] };
  clustering: { method: "optimal-1d-kmeans"; requestedK: number; sumSquaredError: number };
  baselineMeanCosine: number;
  positions: number[];
  regions: MemoryRegion[];
};

export const REGION_EXPERIMENT = Object.freeze({
  version: "memory-regions-1", decoder: "global-coordinate-gaps-1",
  seed: 42, foundationLayers: 2, maxInterruption: 90,
});

const unit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const cosine = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1.000000001;

export function validateRegionStudy(value: unknown, memoryCount: number): RegionStudy {
  if (!value || typeof value !== "object") throw new Error("Missing region data");
  const data = value as RegionStudy;
  if (data.version !== 1 || !/^[a-f0-9]{64}$/.test(data.corpusSha256) || data.count !== memoryCount || memoryCount < 2 ||
    !Array.isArray(data.positions) || data.positions.length !== memoryCount || !data.positions.every(unit) ||
    data.projection?.method !== "pca-1d" || data.projection.normalization !== "l2" || !unit(data.projection.explainedVariance) ||
    data.clustering?.method !== "optimal-1d-kmeans" || !Number.isInteger(data.clustering.requestedK) ||
    !data.embedding || !Number.isInteger(data.embedding.dimensions) || data.embedding.dimensions < 1 ||
    !cosine(data.baselineMeanCosine) || !Array.isArray(data.regions) || !data.regions.length || data.regions.length > 8 ||
    data.regions.length > data.clustering.requestedK) throw new Error("Invalid region study");
  const seen = new Set<number>(), ids = new Set<string>();
  let previousMax = -Infinity;
  for (const region of data.regions) {
    if (!region || typeof region.id !== "string" || !/^region-\d+$/.test(region.id) || ids.has(region.id) ||
      !Array.isArray(region.indices) || !region.indices.length ||
      !unit(region.min) || !unit(region.max) || !unit(region.center) || region.min < previousMax ||
      region.min > region.center || region.center > region.max || !cosine(region.meanPairwiseCosine) ||
      !Array.isArray(region.representatives) || !region.representatives.length || region.representatives.length > 3)
      throw new Error("Invalid or overlapping region");
    ids.add(region.id);
    previousMax = region.max;
    let previousIndex = -1;
    for (const index of region.indices) {
      if (!Number.isInteger(index) || index <= previousIndex || index >= memoryCount || seen.has(index) ||
        data.positions[index] < region.min - 1e-12 || data.positions[index] > region.max + 1e-12)
        throw new Error("Region membership does not match the corpus");
      previousIndex = index;
      seen.add(index);
    }
    if (region.representatives.some(index => !region.indices.includes(index))) throw new Error("Invalid representative memory");
  }
  if (seen.size !== memoryCount) throw new Error("Some memories are missing from the regions");
  return data;
}

export type RegionLayer = {
  layer: number;
  activeSteps: number;
  position: number | null;
  interruption: number;
  contributions: { memoryIndex: number; weight: number }[];
};

// Global authored scale. It is neither an emotion score nor a measured gap percentage.
export function decodeRegionPosition(position: number): number {
  if (!unit(position)) throw new Error("Decoder requires a coordinate in [0, 1]");
  return Math.round(REGION_EXPERIMENT.maxInterruption * position * position);
}

/** Equal memory coverage over active deposition, excluding foundation and runout. */
export function compileRegionLayers(indices: readonly number[], positions: readonly number[]): RegionLayer[] {
  if (!indices.length || new Set(indices).size !== indices.length ||
    indices.some(index => !Number.isInteger(index) || index < 0 || index >= positions.length || !unit(positions[index])))
    throw new Error("Invalid memory coordinates or membership");
  const foundationSteps = REGION_EXPERIMENT.foundationLayers * SEGMENTS;
  const stopStep = TOTAL_STEPS - RUNOUT_STEPS;
  const bodySteps = stopStep - foundationSteps, count = indices.length;
  return Array.from({ length: LAYERS }, (_, layer) => {
    if (layer < REGION_EXPERIMENT.foundationLayers) return { layer, activeSteps: 0, position: null, interruption: 0, contributions: [] };
    const activeSteps = Math.min((layer + 1) * SEGMENTS, stopStep) - layer * SEGMENTS;
    const left = (layer * SEGMENTS - foundationSteps) * count, right = left + activeSteps * count;
    const contributions = [];
    let position = 0;
    for (let i = Math.floor(left / bodySteps); i < Math.ceil(right / bodySteps); i++) {
      const weight = (Math.min(right, (i + 1) * bodySteps) - Math.max(left, i * bodySteps)) / (right - left);
      const memoryIndex = indices[i];
      contributions.push({ memoryIndex, weight });
      position += positions[memoryIndex] * weight;
    }
    position = Math.max(0, Math.min(1, position));
    return { layer, activeSteps, position, interruption: decodeRegionPosition(position), contributions };
  });
}

export function regionPottery(id: string, layers?: readonly RegionLayer[]): Pottery {
  const events: ProcessEvent[] = layers
    ? layers.map(layer => ({ step: layer.layer * SEGMENTS, fluctuation: 0, interruption: layer.interruption, sag: true }))
    : [{ step: 0, fluctuation: 0, interruption: 0, sag: true }];
  return {
    id: `${REGION_EXPERIMENT.version}-${id}`, title: id === "control" ? "Continuous supply control" : id,
    seed: REGION_EXPERIMENT.seed, steps: TOTAL_STEPS, events,
    createdAt: "2026-11-10T00:00:00.000Z", duration: 90,
    simulation: { version: 3, profile: PLASTIC_PROFILE.id, ticks: MATERIAL_TICKS, stopStep: TOTAL_STEPS - RUNOUT_STEPS },
  };
}

export async function loadRegionStudy(signal?: AbortSignal): Promise<{ study: RegionStudy; texts: string[] }> {
  const base = import.meta.env.BASE_URL;
  const [corpusResponse, studyResponse] = await Promise.all([
    fetch(`${base}memories.json`, { signal }), fetch(`${base}memory-regions.json`, { signal }),
  ]);
  if (!corpusResponse.ok || !studyResponse.ok) throw new Error("无法载入实验数据，请确认两个数据文件均已生成。");
  const corpus = await corpusResponse.text(), texts: unknown = JSON.parse(corpus);
  if (!Array.isArray(texts) || !texts.every(text => typeof text === "string" && text.trim().length > 0))
    throw new Error("记忆原文格式无效。");
  const study = validateRegionStudy(await studyResponse.json(), texts.length);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(corpus));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== study.corpusSha256) throw new Error("原文与一维坐标不匹配，请重新生成实验数据。");
  return { study, texts };
}
