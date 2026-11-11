import { MAX_MEMORY_FILE_BYTES, MemoryImportError, parseMemories, validateAnalyzedMemories } from "./memoryPlayback.ts";
import type { MemoryEntry } from "./memoryPlayback.ts";
import { validateScores } from "../shared/memoryAnalysis.ts";

const DEFAULT_MEMORY_COUNT = 1910;
type DefaultScores = "analyzed" | "demo" | "unavailable" | "none" | null;

export type MemorySourceState = {
  memories: MemoryEntry[];
  phase: "loading" | "ready" | "empty" | "error";
  origin: "default" | "file" | "analyzed" | null;
  error: string;
  defaultScores: DefaultScores;
  analysisPending: boolean;
};

async function responseBytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) throw new Error("Default memories unavailable");
  if (Number(response.headers.get("content-length")) > MAX_MEMORY_FILE_BYTES || !response.body)
    throw new MemoryImportError("The JSON file must be 8 MiB or smaller.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_MEMORY_FILE_BYTES) throw new MemoryImportError("The JSON file must be 8 MiB or smaller.");
      chunks.push(value);
    }
    const result = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function bindDefaultScores(raw: Uint8Array<ArrayBuffer>, entries: MemoryEntry[], sidecar: unknown): Promise<MemoryEntry[]> {
  if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) throw new Error("Invalid sidecar");
  const data = sidecar as Record<string, unknown>;
  const keys = ["version", "model", "prompt", "corpusSha256", "scores"];
  if (Object.keys(data).length !== keys.length || !keys.every(key => Object.hasOwn(data, key)) ||
      data.version !== 1 || typeof data.model !== "string" || !/minimax/i.test(data.model) ||
      typeof data.prompt !== "string" || !data.prompt.trim() ||
      typeof data.corpusSha256 !== "string" || !/^[0-9a-f]{64}$/.test(data.corpusSha256) ||
      !Array.isArray(data.scores) || entries.length !== DEFAULT_MEMORY_COUNT ||
      data.scores.length !== DEFAULT_MEMORY_COUNT || !data.scores.every(validateScores)) throw new Error("Invalid sidecar");
  const digest = await crypto.subtle.digest("SHA-256", raw);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== data.corpusSha256) throw new Error("Corpus mismatch");
  const original: unknown = JSON.parse(new TextDecoder().decode(raw).replace(/^﻿/, ""));
  if (!Array.isArray(original) || original.length !== DEFAULT_MEMORY_COUNT || !original.every(text => typeof text === "string")) throw new Error("Invalid corpus");
  const scores = data.scores;
  return entries.map((entry, index) => ({ ...entry, scores: scores[index] }));
}

// One owner for default loading and manual changes, independent of carousel remounts.
export class MemorySource {
  private readonly defaultUrl: string;
  private readonly sidecarUrl: string;
  private state: MemorySourceState;
  private generation = 0;
  private controller?: AbortController;
  private listeners = new Set<() => void>();
  private readonly locked: () => boolean;
  private readonly request: typeof fetch;

  constructor(defaultUrl: string, locked: () => boolean, request: typeof fetch = (input, init) => fetch(input, init)) {
    this.defaultUrl = defaultUrl;
    this.sidecarUrl = defaultUrl.replace(/[^/]*$/, "default-memory-scores.json");
    this.locked = locked;
    this.request = request;
    this.state = { memories: [], phase: "loading", origin: null, error: "", defaultScores: null, analysisPending: false };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  get canStart() { return !this.state.analysisPending && this.state.phase === "ready" && this.state.memories.length > 0; }

  private publish(state: MemorySourceState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  cancel = () => {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
  };
  private begin() {
    this.cancel();
    this.controller = new AbortController();
    this.publish({ ...this.state, phase: "loading", error: "", analysisPending: false });
    return { generation: this.generation, signal: this.controller.signal };
  }
  loadDefault = async () => {
    if (this.locked()) return false;
    const { generation, signal } = this.begin();
    try {
      const options: RequestInit = { mode: "same-origin", cache: "no-store", signal };
      const raw = await responseBytes(await this.request(this.defaultUrl, options));
      const text = new TextDecoder().decode(raw);
      let entries = parseMemories(text);
      const original: unknown = JSON.parse(text.replace(/^﻿/, ""));
      if (Array.isArray(original) && original.every(value => typeof value === "string")) entries = original.map(text => ({ text }));
      if (generation !== this.generation || this.locked()) return false;
      let memories = entries;
      let defaultScores: DefaultScores = "unavailable";
      try {
        const response = await this.request(this.sidecarUrl, { ...options, headers: { Accept: "application/json" } });
        if (response.status === 404) {
          const demo = import.meta.env?.DEV || import.meta.env?.VITE_PUBLIC_DEMO_SCORES === "1";
          defaultScores = demo ? "demo" : "none";
          if (demo) memories = entries.map(entry => ({
            ...entry, demoScores: true,
            scores: {
              calm: Math.floor(Math.random() * 6), anxiety: Math.floor(Math.random() * 6),
              anger: Math.floor(Math.random() * 6), stress: Math.floor(Math.random() * 6),
              sadness: Math.floor(Math.random() * 6),
            },
          }));
        } else {
          const bytes = await responseBytes(response);
          memories = await bindDefaultScores(raw, entries, JSON.parse(new TextDecoder().decode(bytes)));
          defaultScores = "analyzed";
        }
      } catch {
        // Network failures, invalid files, digest failures and mismatches are never demo scores.
        defaultScores = "unavailable";
      }
      if (generation !== this.generation || this.locked()) return false;
      this.publish({ memories, phase: "ready", origin: "default", defaultScores, error: "", analysisPending: false });
      return true;
    } catch {
      if (generation !== this.generation || this.locked()) return false;
      this.publish({ ...this.state, phase: this.state.memories.length ? "ready" : "error", error: "Default memories could not be loaded. Retry or choose a JSON file." });
      return false;
    }
  };
  importFile = async (file: Pick<File, "size" | "text">) => {
    if (this.locked()) return false;
    const { generation } = this.begin();
    try {
      if (file.size > MAX_MEMORY_FILE_BYTES) throw new MemoryImportError("The JSON file must be 8 MiB or smaller.");
      const memories = parseMemories(await file.text());
      if (generation !== this.generation || this.locked()) return false;
      this.publish({ memories, phase: "ready", origin: "file", defaultScores: null, error: "", analysisPending: false });
      return true;
    } catch (reason) {
      if (generation !== this.generation || this.locked()) return false;
      const error = reason instanceof MemoryImportError ? reason.message : "The file could not be read. Choose a JSON file again.";
      this.publish({ ...this.state, phase: this.state.memories.length ? "ready" : "error", error });
      return false;
    }
  };
  // A review is tied to the source generation it started with; stale results
  // cannot overwrite a reload, import, clear, or newer analysis.
  beginAnalysis = () => {
    if (this.locked()) return null;
    this.cancel();
    this.publish({ ...this.state, phase: this.state.memories.length ? "ready" : "empty", error: "", analysisPending: true });
    return this.generation;
  };
  applyAnalysis = (generation: number, value: unknown) => {
    if (this.locked() || generation !== this.generation) return false;
    const memories = validateAnalyzedMemories(value);
    this.cancel();
    this.publish({ memories, phase: "ready", origin: "analyzed", defaultScores: null, error: "", analysisPending: false });
    return true;
  };
  endAnalysis = (generation: number) => {
    if (generation !== this.generation || !this.state.analysisPending) return;
    this.cancel();
    this.publish({ ...this.state, analysisPending: false });
  };
  clear = () => {
    if (this.locked()) return;
    this.cancel();
    this.publish({ memories: [], phase: "empty", origin: null, defaultScores: null, error: "", analysisPending: false });
  };
}
