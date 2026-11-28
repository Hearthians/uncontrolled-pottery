import {FORM} from './config.ts';
export type ConcernDataset = {
  schemaVersion: '1.0'; datasetId: string;
  records: {layerId: number; concernScore: number}[];
};

export function validateConcernDataset(input: unknown, layerCount: number = FORM.layerCount): ConcernDataset {
  if (!Number.isInteger(layerCount) || layerCount < 1) throw new Error('Invalid expected layer count');
  if (!input || typeof input !== 'object') throw new Error('Expected concern dataset');
  const data = input as Partial<ConcernDataset>;
  if (data.schemaVersion !== '1.0' || typeof data.datasetId !== 'string' || !data.datasetId.trim() || !Array.isArray(data.records)) throw new Error('Invalid dataset metadata');
  if (data.records.length !== layerCount) throw new Error('Missing or extra layers');
  const seen = new Set<number>();
  for (const row of data.records) {
    if (!row || !Number.isInteger(row.layerId) || row.layerId < 1 || row.layerId > layerCount) throw new Error('Invalid layer ID');
    if (seen.has(row.layerId)) throw new Error('Duplicate layer');
    if (!Number.isFinite(row.concernScore) || row.concernScore < 0 || row.concernScore > 1) throw new Error('Concern score must be finite and within [0,1]');
    seen.add(row.layerId);
  }
  return {schemaVersion: '1.0', datasetId: data.datasetId, records: data.records.map(r => ({layerId: r.layerId, concernScore: r.concernScore})).sort((a, b) => a.layerId - b.layerId)};
}

export function syntheticFixtures(): ConcernDataset[] {
  const patterns = [
    {id: 'zero', score: (_: number) => 0},
    {id: 'constant', score: (_: number) => 0.5},
    {id: 'ramp', score: (i: number) => i / (FORM.layerCount - 1)},
    {id: 'spikes', score: (i: number) => [24, 49, 74].includes(i) ? 1 : 0},
  ];
  return patterns.map(p => validateConcernDataset({schemaVersion: '1.0', datasetId: `synthetic-${p.id}-001`,
    records: Array.from({length: FORM.layerCount}, (_, i) => ({layerId: i + 1, concernScore: p.score(i)}))}));
}
