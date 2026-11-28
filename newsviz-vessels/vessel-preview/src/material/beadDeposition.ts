import type {LabSettings} from './calibrationTypes.ts';
import type {simulateResponse} from './extrusionResponse.ts';
export function beadDeposition(response: ReturnType<typeof simulateResponse>, settings: LabSettings) {
  const ratio = settings.widthMm / settings.heightMm;
  const segments = response.bins.map(bin => {
    const lengthMm = Math.hypot(...bin.end.map((v, k) => v - bin.start[k]));
    const deposited = bin.command.kind === 'deposit' && lengthMm > 0;
    const areaMm2 = deposited ? bin.volumeMm3 / lengthMm : 0;
    const heightMm = Math.sqrt(4 * areaMm2 / (Math.PI * ratio)), widthMm = ratio * heightMm;
    return {...bin, lengthMm, areaMm2, widthMm, heightMm, deposited,
      baseZMm: (bin.command.layerId - 1) * settings.heightMm};
  });
  const depositedMm3 = segments.filter(s => s.deposited).reduce((sum, s) => sum + s.volumeMm3, 0);
  const oozeMm3 = segments.filter(s => !s.deposited).reduce((sum, s) => sum + s.volumeMm3, 0);
  return {segments, ledger: {requestedMm3: response.requestedMm3, deliveredMm3: response.deliveredMm3, depositedMm3, oozeMm3,
    otherSinksMm3: 0, discrepancyMm3: response.deliveredMm3 - depositedMm3 - oozeMm3,
    requestedMinusDeliveredMm3: response.requestedMm3 - response.deliveredMm3, futureTailMm3: response.futureTailMm3,
    depositedMassG: settings.densityGPerCm3 === null ? null : depositedMm3 / 1000 * settings.densityGPerCm3}};
}
