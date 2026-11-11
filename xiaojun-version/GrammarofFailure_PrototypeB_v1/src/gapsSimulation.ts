/** One simulation boundary for manual and external v1.0.0 schedules. */
import type {GeometryResult} from "./geometry.ts";
import {createGeometryManifest} from "./serialization.ts";
import {validateFailureSchedule} from "./failureSchedule.ts";
import {applyGaps,gapResultToToolpath,GAP_CALIBRATION} from "./gaps.ts";
import type {GapSettings} from "./gaps.ts";
import {createResiduePlan,RESIDUE_CALIBRATION} from "./clayResidue.ts";
import {analyzeSupport,SUPPORT_CALIBRATION} from "./support.ts";
import {beadBuffers} from "./claySurface.ts";
export const GAPS_SIMULATION_VERSION="1.0.0" as const;
/** Throws before publishing a partial result; renderer buffers are owned by this result. */
export async function simulateGaps(source:GeometryResult,schedule:unknown,seed:number,settings:GapSettings=GAP_CALIBRATION){
  const checked=validateFailureSchedule(schedule,createGeometryManifest(source));
  if(!checked.ok)throw new Error(checked.errors.join(" "));
  const gaps=await applyGaps(source,checked.schedule,seed,settings);
  const path=gapResultToToolpath(gaps),residue=createResiduePlan(path,seed);
  const support=analyzeSupport(path,residue,source.geometryId,gaps.derivedId);
  const material=beadBuffers(path,residue,support.segments);
  // Identity tracks effective commands and material versions, not UI mode or redundant stable entries.
  const recipe=JSON.stringify([GAPS_SIMULATION_VERSION,gaps.derivedId,RESIDUE_CALIBRATION,SUPPORT_CALIBRATION]);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(recipe));
  const simulationId=`gof-simulation-1.0.0-${Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("")}`;
  return Object.freeze({version:GAPS_SIMULATION_VERSION,operatorVersion:"1.0.0" as const,simulationId,sourceGeometryId:source.geometryId,
    schedule:checked.schedule,assignments:checked.assignments,
    targetedLayerCount:gaps.appliedIntensities.filter(a=>a.intensity>0).length,
    gaps,residue,support,material:Object.freeze(material),materialCalibration:RESIDUE_CALIBRATION,
    warnings:Object.freeze([...gaps.validation.warnings,...support.warnings])});
}
export type GapsSimulationResult=Awaited<ReturnType<typeof simulateGaps>>;
