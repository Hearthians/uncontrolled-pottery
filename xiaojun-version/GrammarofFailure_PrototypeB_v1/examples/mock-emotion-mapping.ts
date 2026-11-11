// Synthetic data only: this independent module never reads memory or classifies emotions.
import { scheduleFromHeightIntervals, FAILURE_TYPES } from "../src/failureSchedule.ts";
import type { GeometryManifest } from "../src/serialization.ts";
import type { HeightFailureInterval } from "../src/failureSchedule.ts";

export function mock64StepIntervals(gapsOnly=false): readonly HeightFailureInterval[] {
  return Array.from({length:64}, (_,i) => {
    if(gapsOnly)return {start:i/64,end:(i+1)/64,failureType:i<16?"stable":"gaps",intensity:[0,.25,.5,1][Math.floor(i/16)]};
    const failureType = FAILURE_TYPES[Math.floor(i * FAILURE_TYPES.length / 64)];
    return {start:i/64,end:(i+1)/64,failureType,intensity:failureType === "stable" ? 0 : (i % 4 + 1)/4};
  });
}
/** The only interchange here is manifest JSON in, existing schedule JSON out. */
export function mockMappingJson(manifestJson: string,gapsOnly=false): string {
  const manifest = JSON.parse(manifestJson) as GeometryManifest;
  return JSON.stringify(scheduleFromHeightIntervals(manifest,mock64StepIntervals(gapsOnly),42));
}
