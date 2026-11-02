import { MAX_MEMORY_FILE_BYTES, MemoryImportError, parseMemories } from "./memoryPlayback.ts";
import type { MemoryEntry } from "./memoryPlayback.ts";

export type MemorySourceState = {
  memories: MemoryEntry[];
  phase: "loading" | "ready" | "empty" | "error";
  origin: "default" | "file" | null;
  error: string;
};

async function responseText(response: Response) {
  if (!response.ok) throw new Error("Default memories unavailable");
  if (Number(response.headers.get("content-length")) > MAX_MEMORY_FILE_BYTES || !response.body)
    throw new MemoryImportError("The JSON file must be 8 MiB or smaller.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_MEMORY_FILE_BYTES) throw new MemoryImportError("The JSON file must be 8 MiB or smaller.");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// One owner for default loading and manual changes, independent of carousel remounts.
export class MemorySource {
  private readonly defaultUrl: string;
  private state: MemorySourceState;
  private generation = 0;
  private controller?: AbortController;
  private listeners = new Set<() => void>();
  private readonly locked: () => boolean;
  private readonly request: typeof fetch;

  constructor(defaultUrl: string, locked: () => boolean, request: typeof fetch = (input, init) => fetch(input, init)) {
    this.defaultUrl = defaultUrl;
    this.locked = locked;
    this.request = request;
    this.state = { memories: [], phase: "loading", origin: null, error: "" };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  get canStart() { return this.state.phase === "ready" && this.state.memories.length > 0; }

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
    this.publish({ ...this.state, phase: "loading", error: "" });
    return { generation: this.generation, signal: this.controller.signal };
  }
  private async load(read: (signal: AbortSignal) => Promise<string>, origin: "default" | "file") {
    if (this.locked()) return false;
    const { generation, signal } = this.begin();
    try {
      const text = await read(signal);
      if (generation !== this.generation || this.locked()) return false;
      const memories = parseMemories(text);
      this.publish({ memories, phase: "ready", origin, error: "" });
      return true;
    } catch (reason) {
      if (generation !== this.generation || this.locked()) return false;
      const error = origin === "default" ? "Default memories could not be loaded. Retry or choose a JSON file."
        : reason instanceof MemoryImportError ? reason.message : "The file could not be read. Choose a JSON file again.";
      this.publish({ ...this.state, phase: this.state.memories.length ? "ready" : "error", error });
      return false;
    }
  }
  loadDefault = () => this.load(async (signal) => {
    const response = await this.request(this.defaultUrl, { mode: "same-origin", cache: "no-store", signal });
    return responseText(response);
  }, "default");
  importFile = (file: Pick<File, "size" | "text">) => this.load(async () => {
    if (file.size > MAX_MEMORY_FILE_BYTES) throw new MemoryImportError("The JSON file must be 8 MiB or smaller.");
    return file.text();
  }, "file");
  clear = () => {
    if (this.locked()) return;
    this.cancel();
    this.publish({ memories: [], phase: "empty", origin: null, error: "" });
  };
}
