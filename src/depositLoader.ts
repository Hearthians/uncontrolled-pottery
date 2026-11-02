import { generateMaterial } from "./pottery";
import type { Pottery, SceneMaterial } from "./pottery";

let worker: Worker | undefined;
let nextRequest = 0;
const pending = new Map<number, { resolve: (material: SceneMaterial) => void; reject: (error: Error) => void }>();
const cache = new WeakMap<Pottery, { key: string; promise: Promise<SceneMaterial> }>();

export function loadMaterial(pottery: Pottery): Promise<SceneMaterial> {
  const key = JSON.stringify([pottery.seed, pottery.steps, pottery.events, pottery.simulation]);
  const cached = cache.get(pottery);
  if (cached?.key === key) return cached.promise;
  if (!pottery.simulation || typeof Worker === "undefined")
    return Promise.resolve(generateMaterial(pottery));
  if (!worker) {
    worker = new Worker(new URL("./material.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ request: number; material?: SceneMaterial; error?: string }>) => {
      const request = pending.get(event.data.request);
      if (!request) return;
      pending.delete(event.data.request);
      if (event.data.material) request.resolve(event.data.material);
      else request.reject(new Error(event.data.error ?? "Material reconstruction failed"));
    };
    worker.onerror = () => {
      for (const request of pending.values()) request.reject(new Error("Material worker failed"));
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  const request = nextRequest++;
  const promise = new Promise<SceneMaterial>((resolve, reject) => {
    pending.set(request, { resolve, reject });
    worker!.postMessage({ request, pottery });
  });
  cache.set(pottery, { key, promise });
  promise.catch(() => {
    if (cache.get(pottery)?.promise === promise) cache.delete(pottery);
  });
  return promise;
}
