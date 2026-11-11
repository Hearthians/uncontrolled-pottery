import { parentPort, workerData } from 'node:worker_threads';
import { extractInput } from './extraction.ts';
import type { MemoryInput } from '../shared/memoryAnalysis.ts';

if (!parentPort) throw new Error('Extraction worker requires a parent');
const port = parentPort;
try {
  const text = await extractInput(workerData as MemoryInput);
  port.postMessage({ ok: true, text });
} catch (error) {
  // Only the extractor's known, static error strings may cross the boundary.
  const message = error instanceof Error ? error.message : '';
  const allowed = new Set(['Extracted text is too large', 'No extractable text', 'File must contain valid UTF-8', 'Invalid JSON', 'Invalid DOCX archive', 'Unsafe DOCX archive', 'Invalid DOCX', 'PDF cannot be extracted (encrypted, invalid, or too large)', 'Invalid filename', 'Invalid or oversized file', 'Invalid CSV', 'Unsupported file type']);
  port.postMessage({ ok: false, error: allowed.has(message) ? message : 'Extraction failed' });
}
