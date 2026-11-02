import { generateDeposits } from "./pottery";
import type { Pottery } from "./pottery";

self.onmessage = (event: MessageEvent<{ request: number; pottery: Pottery }>) => {
  const { request, pottery } = event.data;
  try {
    const deposits = generateDeposits(pottery).map((point) => ({
      x: point.x, y: point.y, z: point.z,
      radius: point.radius, thickness: point.thickness, gap: point.gap,
      ...("halfHeight" in point ? { halfHeight: point.halfHeight } : {}),
      ...("breakBefore" in point ? { breakBefore: point.breakBefore } : {}),
    }));
    self.postMessage({ request, deposits });
  } catch (error) {
    self.postMessage({ request, error: error instanceof Error ? error.message : "Material reconstruction failed" });
  }
};
