export const TOPOGRAPHY_ANIMATION = Object.freeze({
  printSeconds: 56, settleSeconds: 4.2, settleDelaySeconds: 0.18, turnSeconds: 120,
});

export type TopographyFrame = {
  phase: "printing" | "settling" | "complete";
  progress: number;
  layer: number;
  rotation: number;
};

export function topographyFrame(elapsed: number, layers: number): TopographyFrame {
  const { printSeconds, settleSeconds, settleDelaySeconds, turnSeconds } = TOPOGRAPHY_ANIMATION;
  const completeAt = printSeconds + settleSeconds + settleDelaySeconds;
  const progress = Math.max(0, Math.min(1, elapsed / printSeconds));
  const turnTime = Math.max(0, elapsed - completeAt);
  // Ease into the final turntable, then keep a constant slow rotation.
  const rotation = (turnTime - 2 * (1 - Math.exp(-turnTime / 2))) * Math.PI * 2 / turnSeconds;
  return { phase: elapsed < printSeconds ? "printing" : elapsed < completeAt ? "settling" : "complete",
    progress, layer: Math.ceil(progress * layers), rotation };
}

/** Index prefixes follow the print path, including its intentionally empty spans. */
export function revealedIndices(reveal: readonly { path: number; indexCount: number }[], path: number): number {
  let left = 0, right = reveal.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (reveal[middle].path <= path) left = middle + 1;
    else right = middle;
  }
  return left ? reveal[left - 1].indexCount : 0;
}
