import { useEffect, useSyncExternalStore } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";

export type HandModelState = {
  phase: "idle" | "downloading" | "initializing" | "ready" | "error";
  loaded: number;
  total: number;
};

let state: HandModelState = { phase: "idle", loaded: 0, total: 0 };
const listeners = new Set<() => void>();
let pending: Promise<void> | null = null;
let warmDetector: HandLandmarker | null = null;
let createDetector: (() => Promise<HandLandmarker>) | null = null;
const CACHE_NAME = "pottery-hand-assets-0.10.32-v1";

function publish(next: HandModelState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function preloadHandModel(): Promise<void> {
  if (pending) return pending;
  const controller = new AbortController();
  publish({ phase: "downloading", loaded: 0, total: 0 });
  pending = (async () => {
    const base = `${import.meta.env.BASE_URL}hand-tracking/`;
    const [vision, manifestResponse] = await Promise.all([
      import("@mediapipe/tasks-vision"),
      fetch(`${base}assets.json`, { signal: controller.signal }),
    ]);
    if (!manifestResponse.ok) throw new Error("Asset manifest unavailable");
    const sizes = (await manifestResponse.json()) as Record<string, number>;
    const files = await vision.FilesetResolver.forVisionTasks(`${base}wasm`);
    const paths = [
      files.wasmLoaderPath,
      files.wasmBinaryPath,
      `${base}hand_landmarker.task`,
    ];
    const total = paths.reduce((sum, path) => sum + sizes[path.slice(base.length)], 0);
    if (!Number.isFinite(total) || total <= 0) throw new Error("Invalid asset sizes");
    let cache: Cache | null = null;
    try { cache = await window.caches.open(CACHE_NAME); } catch {}
    let loaded = 0;
    let updatedAt = 0;
    publish({ phase: "downloading", loaded, total });
    const buffers = await Promise.all(
      paths.map(async (path) => {
        let timeout = 0;
        const touch = () => {
          clearTimeout(timeout);
          timeout = window.setTimeout(() => controller.abort(), 45000);
        };
        touch();
        try {
          const cached = cache ? await cache.match(path).catch(() => undefined) : undefined;
          const response = cached ?? await fetch(path, { signal: controller.signal });
          if (!response.ok || !response.body) throw new Error(`Asset unavailable: ${path}`);
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let length = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            touch();
            chunks.push(value);
            length += value.byteLength;
            loaded += value.byteLength;
            if (performance.now() - updatedAt > 70) {
              publish({ phase: "downloading", loaded, total });
              updatedAt = performance.now();
            }
          }
          if (length !== sizes[path.slice(base.length)]) {
            if (cache) await cache.delete(path).catch(() => {});
            throw new Error(`Incomplete asset: ${path}`);
          }
          const buffer = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.length;
          }
          if (!cached && cache) {
            await cache.put(path, new Response(buffer, {
              headers: { "Content-Type": response.headers.get("Content-Type") || "application/octet-stream" },
            })).catch(() => {});
          }
          return buffer;
        } finally {
          clearTimeout(timeout);
        }
      }),
    );
    publish({ phase: "initializing", loaded: total, total });
    // Blob URLs let MediaPipe use the downloaded bytes without fetching them again.
    const loaderUrl = URL.createObjectURL(new Blob([buffers[0]], { type: "application/javascript" }));
    const wasmUrl = URL.createObjectURL(new Blob([buffers[1]], { type: "application/wasm" }));
    const create = () => vision.HandLandmarker.createFromOptions(
      { wasmLoaderPath: loaderUrl, wasmBinaryPath: wasmUrl },
      {
        baseOptions: { modelAssetBuffer: buffers[2], delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      },
    );
    try {
      warmDetector = await create();
      createDetector = create;
    } catch (error) {
      URL.revokeObjectURL(loaderUrl);
      URL.revokeObjectURL(wasmUrl);
      throw error;
    }
    publish({ phase: "ready", loaded: total, total });
  })().catch((error) => {
    controller.abort();
    pending = null;
    publish({ ...state, phase: "error" });
    throw error;
  });
  return pending;
}

export async function acquireHandDetector(): Promise<HandLandmarker> {
  await preloadHandModel();
  if (warmDetector) {
    const detector = warmDetector;
    warmDetector = null;
    return detector;
  }
  return createDetector!();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useHandModel() {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  useEffect(() => { void preloadHandModel().catch(() => {}); }, []);
  return snapshot;
}
