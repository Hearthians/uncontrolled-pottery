import { sampleToolpath } from "./toolpath.ts";
import type { Toolpath } from "./toolpath.ts";

export class Playback {
  elapsedS = 0;
  playing = false;
  readonly path: Toolpath;
  constructor(path: Toolpath) { this.path = path; }
  play() { if (this.elapsedS < this.path.durationS) this.playing = true; }
  pause() { this.playing = false; }
  reset() { this.playing = false; this.elapsedS = 0; }
  advance(seconds: number) {
    if (this.playing && Number.isFinite(seconds) && seconds > 0) {
      this.elapsedS = Math.min(this.path.durationS, this.elapsedS + seconds);
      if (this.elapsedS === this.path.durationS) this.playing = false;
    }
    return this.sample();
  }
  sample() { return sampleToolpath(this.path, this.elapsedS); }
}
