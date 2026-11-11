import { validateRanges, type ScoredMemoryEntry } from '../shared/memoryAnalysis.ts';
import type { ModelClient } from './model.ts';
import { MAX_TEXT_UNITS } from './extraction.ts';

export const MAX_BLOCK_UNITS = 6000;
export const MAX_BLOCKS = 400;
export function splitText(text: string): string[] {
  if (text.length > MAX_TEXT_UNITS || !/\S/u.test(text)) throw new Error('Invalid or oversized text');
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + MAX_BLOCK_UNITS, text.length);
    if (end < text.length) {
      const area = text.slice(cursor, end);
      const paragraph = area.lastIndexOf('\n\n');
      const line = area.lastIndexOf('\n');
      const space = area.lastIndexOf(' ');
      const boundary = paragraph >= MAX_BLOCK_UNITS / 2 ? paragraph + 2 : line >= MAX_BLOCK_UNITS / 2 ? line + 1 : space >= MAX_BLOCK_UNITS / 2 ? space + 1 : -1;
      if (boundary > 0) end = cursor + boundary;
      if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    }
    const block = text.slice(cursor, end);
    // Preserve even whitespace-only blocks in the indexed source; they need no model call.
    blocks.push(block); cursor = end;
    if (blocks.length > MAX_BLOCKS) throw new Error('Too many text blocks');
  }
  return blocks;
}
export async function analyzeText(text: string, client: ModelClient, options: { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void } = {}): Promise<ScoredMemoryEntry[]> {
  const blocks = splitText(text);
  const entries: ScoredMemoryEntry[] = [];
  options.onProgress?.(0, blocks.length);
  for (let block = 0; block < blocks.length; block++) {
    if (options.signal?.aborted) throw new Error('Analysis cancelled');
    const source = blocks[block];
    if (/\S/u.test(source)) {
      const ranges = validateRanges(await client.analyze(source, { signal: options.signal }), source);
      if (options.signal?.aborted) throw new Error('Analysis cancelled');
      for (const range of ranges) {
        if (range.end - range.start > 10_000) throw new Error('Memory entry is too large');
        if (entries.length >= 2000) throw new Error('Too many memory entries');
        entries.push({ id: `${block}-${range.start}-${range.end}`, text: source.substring(range.start, range.end), scores: range.scores, status: 'analyzed', source: { block, start: range.start, end: range.end } });
      }
    }
    options.onProgress?.(block + 1, blocks.length);
  }
  return entries;
}
