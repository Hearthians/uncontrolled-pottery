export type TopographyRegion = {
  id: string;
  indices: number[];
  share: number;
  meanPairwiseCosine: number;
  diversity: number;
  representatives: number[];
};
export type TopographyData = {
  version: 2;
  corpusSha256: string;
  count: number;
  embedding: { source: string; model: string; dimensions: number };
  clustering: { method: "spherical-kmeans"; dimensions: number; requestedK: number; seed: number; restarts: number;
    selectedRestart: number; iterations: number; objective: number };
  ordering: { method: "shortest-centroid-cosine-path"; totalDistance: number; neighborDistances: number[]; direction: string };
  diversityMetric: "mean-pairwise-cosine-distance";
  baselineMeanCosine: number;
  regions: TopographyRegion[];
};

export const TOPOGRAPHY = Object.freeze({
  version: "memory-topography-2", decoder: "count-diversity-plump-strand-4",
  seed: 42, totalLayers: 64, foundationLayers: 2, rimLayers: 2,
  heightMm: 256, radiusMm: 48, layerHeightMm: 4, beadWidthMm: 6.8,
  maxDropMm: 28, minDiversityRange: 0.05,
});
export type TopographyBand = TopographyRegion & {
  startLayer: number;
  endLayer: number;
  layers: number;
  intensity: number;
  maxDropMm: number;
};
export type TopographyPlan = {
  version: typeof TOPOGRAPHY.version;
  corpusSha256: string;
  count: number;
  bands: TopographyBand[];
  diversityRange: [number, number];
  dataLayers: number;
};

function finite(value: unknown, low: number, high: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;
}
export function validateTopography(value: unknown, count: number): TopographyData {
  if (!value || typeof value !== "object") throw new Error("Memory group data is missing.");
  const data = value as TopographyData;
  if (data.version !== 2 || !/^[a-f0-9]{64}$/.test(data.corpusSha256) || data.count !== count || count < 2 ||
    !data.embedding || data.clustering?.method !== "spherical-kmeans" || data.clustering.dimensions !== data.embedding.dimensions ||
    !Number.isInteger(data.embedding.dimensions) || data.embedding.dimensions < 1 ||
    data.ordering?.method !== "shortest-centroid-cosine-path" ||
    data.diversityMetric !== "mean-pairwise-cosine-distance" ||
    !Array.isArray(data.regions) || !data.regions.length || data.regions.length > 8)
    throw new Error("The memory group data format is invalid.");
  const seen = new Set<number>(), ids = new Set<string>();
  for (const region of data.regions) {
    if (!region || !/^region-\d+$/.test(region.id) || ids.has(region.id) || !Array.isArray(region.indices) || !region.indices.length ||
      !finite(region.meanPairwiseCosine, -1, 1.000000001) || !finite(region.diversity, 0, 2) ||
      Math.abs(region.diversity - (1 - region.meanPairwiseCosine)) > 1e-10 ||
      !finite(region.share, 0, 1) || Math.abs(region.share - region.indices.length / count) > 1e-10 ||
      !Array.isArray(region.representatives) || !region.representatives.length || region.representatives.length > 3)
      throw new Error("Group statistics do not match the memory counts.");
    ids.add(region.id);
    let previous = -1;
    for (const index of region.indices) {
      if (!Number.isInteger(index) || index <= previous || index >= count || seen.has(index)) throw new Error("The groups contain missing or duplicate memories.");
      seen.add(index); previous = index;
    }
    if (region.representatives.some(index => !region.indices.includes(index))) throw new Error("A representative memory does not belong to its group.");
  }
  if (seen.size !== count) throw new Error("The groups contain missing or duplicate memories.");
  return data;
}

/** Hamilton apportionment: sum is exact, each region differs by <1 layer from quota. */
export function allocateLayers(counts: readonly number[], totalLayers: number): number[] {
  if (!counts.length || counts.some(count => !Number.isSafeInteger(count) || count <= 0) ||
    !Number.isSafeInteger(totalLayers) || totalLayers < counts.length) throw new Error("Invalid layer allocation");
  const sum = counts.reduce((a, b) => a + b, 0);
  const quotas = counts.map(count => count / sum * totalLayers);
  const allocation = quotas.map(Math.floor);
  const order = counts.map((_, i) => i).sort((a, b) => (quotas[b] - allocation[b]) - (quotas[a] - allocation[a]) || a - b);
  const remaining = totalLayers - allocation.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) allocation[order[i]]++;
  if (allocation.some(value => value === 0)) throw new Error("Increase layer resolution to represent every group");
  return allocation;
}

export function compileTopography(data: TopographyData): TopographyPlan {
  validateTopography(data, data.count);
  const dataLayers = TOPOGRAPHY.totalLayers - TOPOGRAPHY.foundationLayers - TOPOGRAPHY.rimLayers;
  const allocation = allocateLayers(data.regions.map(region => region.indices.length), dataLayers);
  const low = Math.min(...data.regions.map(region => region.diversity));
  const high = Math.max(...data.regions.map(region => region.diversity));
  const span = Math.max(TOPOGRAPHY.minDiversityRange, high - low);
  let cursor: number = TOPOGRAPHY.foundationLayers;
  const bands = data.regions.map((region, i) => {
    const intensity = Math.max(0, Math.min(1, (region.diversity - low) / span));
    const band = { ...region, layers: allocation[i], startLayer: cursor, endLayer: cursor + allocation[i], intensity,
      maxDropMm: Math.min(TOPOGRAPHY.maxDropMm, allocation[i] * TOPOGRAPHY.layerHeightMm * 0.42) * intensity };
    cursor = band.endLayer;
    return band;
  });
  return { version: TOPOGRAPHY.version, corpusSha256: data.corpusSha256, count: data.count,
    bands, diversityRange: [low, high], dataLayers };
}

export async function loadTopography(signal?: AbortSignal): Promise<{ data: TopographyData; texts: string[] }> {
  const base = import.meta.env.BASE_URL;
  const [corpusResponse, response] = await Promise.all([
    fetch(`${base}memories.json`, { signal }), fetch(`${base}memory-topography.json`, { signal }),
  ]);
  if (!corpusResponse.ok || !response.ok) throw new Error("Memory Topography data could not be loaded.");
  const corpus = await corpusResponse.text(), texts: unknown = JSON.parse(corpus);
  if (!Array.isArray(texts) || !texts.every(text => typeof text === "string" && text.trim())) throw new Error("The memory text format is invalid.");
  const data = validateTopography(await response.json(), texts.length);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(corpus));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== data.corpusSha256) throw new Error("The memories do not match the group record. Please regenerate the data.");
  return { data, texts };
}
