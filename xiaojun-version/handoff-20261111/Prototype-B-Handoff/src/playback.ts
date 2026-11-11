import { sampleToolpath } from "./toolpath.ts";
import type { Toolpath } from "./toolpath.ts";
import type {PathSample} from "./toolpath.ts";

export class Playback {
  elapsedS = 0;
  playing = false;
  readonly path: Toolpath;
  readonly durationS:number;
  private timing?:{durationS:number;sample:(time:number)=>PathSample};
  constructor(path: Toolpath,timing?:{durationS:number;sample:(time:number)=>PathSample}) { this.path = path;this.timing=timing;this.durationS=timing?.durationS??path.durationS; }
  play() { if (this.elapsedS < this.durationS) this.playing = true; }
  pause() { this.playing = false; }
  reset() { this.playing = false; this.elapsedS = 0; }
  advance(seconds: number) {
    if (this.playing && Number.isFinite(seconds) && seconds > 0) {
      this.elapsedS = Math.min(this.durationS, this.elapsedS + seconds);
      if (this.elapsedS === this.durationS) this.playing = false;
    }
    return this.sample();
  }
  sample() { return this.timing?this.timing.sample(this.elapsedS):sampleToolpath(this.path, this.elapsedS); }
}
