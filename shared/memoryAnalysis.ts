export const SCORE_KEYS = ['calm', 'anxiety', 'anger', 'stress', 'sadness'] as const;
export type Scores = Record<(typeof SCORE_KEYS)[number], number>;
export type MemoryInput = { kind: 'text'; text: string } | { kind: 'file'; name: string; dataBase64: string };
export type ScoredMemoryEntry = { id: string; text: string; scores: Scores; status: 'analyzed'; source: { block: number; start: number; end: number } };
export type ScoredRange = { start: number; end: number; scores: Scores };
export type JobStatus = 'queued' | 'extracting' | 'analyzing' | 'completed' | 'failed' | 'cancelled';
export type JobResponse = { id: string; status: JobStatus; progress: { completed: number; total: number }; entries?: ScoredMemoryEntry[]; error?: string };

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: string[]): boolean { return Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value, k)); }
export function validateScores(value: unknown): value is Scores {
  return object(value) && keys(value, [...SCORE_KEYS]) && SCORE_KEYS.every(k => Number.isInteger(value[k]) && (value[k] as number) >= 0 && (value[k] as number) <= 5);
}
export function parseMemoryInput(value: unknown): MemoryInput {
  if (!object(value) || !keys(value, ['input']) || !object(value.input)) throw new Error('Invalid request');
  const input = value.input;
  if (input.kind === 'text' && keys(input, ['kind', 'text']) && typeof input.text === 'string') return { kind: 'text', text: input.text };
  if (input.kind === 'file' && keys(input, ['kind', 'name', 'dataBase64']) && typeof input.name === 'string' && typeof input.dataBase64 === 'string') return { kind: 'file', name: input.name, dataBase64: input.dataBase64 };
  throw new Error('Invalid request');
}
export function validateEntry(value: unknown): value is ScoredMemoryEntry {
  if (!object(value) || !keys(value, ['id', 'text', 'scores', 'status', 'source']) || typeof value.id !== 'string' || !value.id || typeof value.text !== 'string' || !value.text || value.status !== 'analyzed' || !validateScores(value.scores) || !object(value.source) || !keys(value.source, ['block', 'start', 'end'])) return false;
  const s = value.source;
  return Number.isSafeInteger(s.block) && (s.block as number) >= 0 && Number.isSafeInteger(s.start) && (s.start as number) >= 0 && Number.isSafeInteger(s.end) && (s.end as number) > (s.start as number) && value.text.length === (s.end as number) - (s.start as number);
}
export function validateRanges(value: unknown, source: string): ScoredRange[] {
  if (!Array.isArray(value) || !value.length || value.length > source.length) throw new Error('Invalid analysis ranges');
  let cursor = 0;
  const ranges: ScoredRange[] = [];
  for (const item of value) {
    if (!object(item) || !keys(item, ['start', 'end', 'scores']) || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) || !validateScores(item.scores)) throw new Error('Invalid analysis ranges');
    const start = item.start as number, end = item.end as number;
    if (start < cursor || end <= start || end > source.length || /\S/u.test(source.slice(cursor, start)) || !/\S/u.test(source.slice(start, end))) throw new Error('Invalid analysis coverage');
    // Never split a UTF-16 surrogate pair.
    for (const offset of [start, end]) if (offset > 0 && offset < source.length && /[\uD800-\uDBFF]/.test(source[offset - 1]) && /[\uDC00-\uDFFF]/.test(source[offset])) throw new Error('Invalid Unicode boundary');
    ranges.push({ start, end, scores: item.scores }); cursor = end;
  }
  if (/\S/u.test(source.slice(cursor))) throw new Error('Invalid analysis coverage');
  return ranges;
}
