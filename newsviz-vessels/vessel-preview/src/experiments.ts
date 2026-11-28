import {syntheticFixtures, validateConcernDataset} from './concern.ts';
import {FORM} from './config.ts';

export function concernExperiments() {
  const [zero, medium, ramp] = syntheticFixtures();
  const make = (id: string, score: (i: number) => number) => validateConcernDataset({schemaVersion: '1.0', datasetId: `synthetic-${id}-001`,
    records: Array.from({length: FORM.layerCount}, (_, i) => ({layerId: i + 1, concernScore: score(i)}))});
  return [
    {label: 'Zero Concern', data: zero},
    {label: 'Low Concern', data: make('low', () => 0.2)},
    {label: 'Medium Concern', data: medium},
    {label: 'High Concern', data: make('high', () => 0.9)},
    {label: 'Increasing Concern', data: ramp},
    {label: 'Alternating Concern', data: make('alternating', i => i % 2 ? 0.9 : 0.2)},
    {label: 'Local Concern Spike', data: make('band', i => i >= 45 && i < 50 ? 0.9 : 0)},
  ];
}
