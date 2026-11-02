// Imported text is session-only reading material, never part of a pottery record.
export type MemoryEntry = { text: string };

export const MAX_MEMORIES = 2_000;
export const MAX_MEMORY_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_MEMORY_TEXT_LENGTH = 10_000;
export const MAX_TOTAL_MEMORY_TEXT_LENGTH = 2_000_000;

export class MemoryImportError extends Error {}

export function parseMemories(json: string): MemoryEntry[] {
  // Check before JSON.parse; count UTF-8 bytes as well as inexpensive string length.
  if (json.length > MAX_MEMORY_FILE_BYTES || new TextEncoder().encode(json).byteLength > MAX_MEMORY_FILE_BYTES) {
    throw new MemoryImportError("The JSON file must be 8 MiB or smaller.");
  }
  let value: unknown;
  try {
    value = JSON.parse(json.replace(/^﻿/, ""));
  } catch {
    // Native parse errors can contain private text. Only expose a fixed message.
    throw new MemoryImportError("The file is not valid JSON.");
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MEMORIES) {
    throw new MemoryImportError("Use a JSON array containing 1 to 2,000 memories.");
  }
  let totalLength = 0;
  return value.map((entry: unknown, index) => {
    let text: unknown = entry;
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      text = Object.hasOwn(record, "activity") ? record.activity : record.content;
    }
    if (typeof text !== "string" || !text.trim()) {
      throw new MemoryImportError(`Memory ${index + 1} needs a non-empty string, activity, or content field.`);
    }
    if (text.length > MAX_MEMORY_TEXT_LENGTH) {
      throw new MemoryImportError(`Memory ${index + 1} exceeds 10,000 characters.`);
    }
    totalLength += text.length;
    if (totalLength > MAX_TOTAL_MEMORY_TEXT_LENGTH) {
      throw new MemoryImportError("Memory text exceeds the 2,000,000-character total limit.");
    }
    // Deliberately discard names, dates, and all other metadata. Preserve file order.
    return { text: text.trim() };
  });
}

/** Use deposited step count and the ORIGINAL full plan, never elapsed ticks/pathEnd. */
export function memoryIndexAtStep(depositedSteps: number, memoryCount: number, totalSteps: number): number {
  if (!Number.isInteger(memoryCount) || memoryCount <= 0) return -1;
  if (!Number.isFinite(totalSteps) || totalSteps <= 0 || !Number.isFinite(depositedSteps)) return 0;
  const progress = Math.max(0, Math.min(1, Math.floor(depositedSteps) / totalSteps));
  return Math.min(memoryCount - 1, Math.floor(progress * memoryCount));
}

// Four-second-ish passages within the existing 55-second print. The reading
// cadence follows deposited clay, so pause and early finish cannot advance it.
export const MEMORY_PASSAGES = 14;
export function memoryPassageAtStep(depositedSteps: number, memoryCount: number, totalSteps: number): number {
  const current = memoryIndexAtStep(depositedSteps, memoryCount, totalSteps);
  if (current < 0 || memoryCount <= MEMORY_PASSAGES) return current;
  if (!Number.isFinite(depositedSteps) || !Number.isFinite(totalSteps) || totalSteps <= 0) return 0;
  if (depositedSteps >= totalSteps) return memoryCount - 1;
  const passage = Math.floor(Math.max(0, depositedSteps) / totalSteps * MEMORY_PASSAGES);
  return Math.min(memoryCount - 1, Math.floor(passage / MEMORY_PASSAGES * memoryCount));
}
