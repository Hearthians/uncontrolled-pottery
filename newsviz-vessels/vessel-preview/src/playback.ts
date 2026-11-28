import {sampleToolpath} from './toolpath.ts';
import type {Toolpath} from './toolpath.ts';

export class Playback {
  elapsedS = 0;
  playing = false;
  readonly path: Toolpath;
  constructor(path: Toolpath) { this.path = path; }
  play() { if (this.elapsedS >= this.path.durationS) this.elapsedS = 0; this.playing = true; }
  pause() { this.playing = false; }
  reset() { this.pause(); this.elapsedS = 0; }
  seekLayer(layer: number) {
    if (!Number.isInteger(layer) || layer < 0 || layer > this.path.layerEndTimes.length) throw new Error('Invalid layer');
    this.pause(); this.elapsedS = layer === 0 ? 0 : layer === this.path.layerEndTimes.length ? this.path.durationS : this.path.layerEndTimes[layer - 1];
  }
  advance(seconds: number) {
    if (this.playing && Number.isFinite(seconds) && seconds > 0) {
      this.elapsedS = Math.min(this.path.durationS, this.elapsedS + seconds);
      if (this.elapsedS === this.path.durationS) this.pause();
    }
    return this.sample();
  }
  sample() { return sampleToolpath(this.path, this.elapsedS); }
  completedLayers() { return this.path.layerEndTimes.filter(t => t <= this.elapsedS).length; }
}
