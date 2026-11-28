import {finite} from './calibrationTypes.ts';

export const SAG_PARAMETERS = {contactToleranceMm: 0.02, probeStepMm: 0.4, searchMm: 24,
  cellMm: 2, supportedFraction: 0.8, compliancePerMm: 0.012, relaxationS: 2, maxSagMm: 1.5};
export type SagParameters = typeof SAG_PARAMETERS;
export function validateSagParameters(p: SagParameters) {
  for (const key of Object.keys(SAG_PARAMETERS) as (keyof SagParameters)[]) finite(p[key], key, 0.0001, 100);
  finite(p.supportedFraction, 'Supported fraction', 0.01, 1);
  if (p.searchMm / p.probeStepMm > 1000) throw new Error('Support probe budget exceeded');
}
// Exact relaxation of an illustrative displacement target, not a measured force law.
export function relaxSag(displacement: number, target: number, seconds: number, relaxationS: number) {
  finite(displacement, 'Displacement'); finite(target, 'Sag target'); finite(seconds, 'Age'); finite(relaxationS, 'Relaxation time', 0.0001);
  return displacement + (target - displacement) * -Math.expm1(-seconds / relaxationS);
}
