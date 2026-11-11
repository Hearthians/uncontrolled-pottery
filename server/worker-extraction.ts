import { Worker } from 'node:worker_threads';
import type { MemoryInput } from '../shared/memoryAnalysis.ts';

export const EXTRACTION_TIMEOUT_MS = 30_000;
/** Run untrusted document parsers in a disposable, memory-limited thread. */
export function extractInWorker(input: MemoryInput, options: { signal?: AbortSignal; timeoutMs?: number; workerURL?: URL } = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? EXTRACTION_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > EXTRACTION_TIMEOUT_MS) throw new Error('Invalid extraction timeout');
  if (options.signal?.aborted) return Promise.reject(new Error('Extraction cancelled'));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(options.workerURL ?? new URL('./extraction-worker.ts', import.meta.url), {
        workerData: input,
        resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      });
    } catch { reject(new Error('Extraction failed')); return; }
    let finished = false;
    const finish = (error?: string, text?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      // Always terminate: workers must not retain original input or background work.
      void worker.terminate();
      if (error) reject(new Error(error)); else resolve(text!);
    };
    const abort = () => finish('Extraction cancelled');
    const timer = setTimeout(() => finish('Extraction timed out'), timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    // A signal can race with worker creation/listener registration.
    if (options.signal?.aborted) abort();
    worker.once('message', (message: unknown) => {
      if (!message || typeof message !== 'object') return finish('Extraction failed');
      const value = message as { ok?: unknown; text?: unknown; error?: unknown };
      if (value.ok === true && typeof value.text === 'string') return finish(undefined, value.text);
      finish(typeof value.error === 'string' ? value.error : 'Extraction failed');
    });
    worker.once('error', () => finish('Extraction failed'));
    worker.once('exit', () => finish('Extraction failed'));
  });
}
