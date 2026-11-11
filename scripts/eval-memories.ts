import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SCALE_KEYS, SCALE_GUIDE, REVIEWS, type Key, type Review } from './eval-memories-rubric.ts';
import { validateScores, type Scores } from '../shared/memoryAnalysis.ts';

export const MODELS = { gpt: 'gpt-6-luna', minimax: 'MiniMax-M3.1-Flash' } as const;
export const SOURCE = new URL('../public/memories.json', import.meta.url);
export const OUTPUT = new URL('../artifacts/eval-memory-preblind/', import.meta.url);
const hash = (x: string) => createHash('sha256').update(x).digest('hex');
export type Sample = { index: number; textHash: string };
export type Result = { index: number; scores: Scores };
export type Frozen = { version: 1; datasetHash: string; scale: typeof SCALE_GUIDE; sample: Sample[]; draftReviews: readonly Review[]; annotationStatus: 'independent-ai-draft-not-human-reviewed'; frozenAt: string };

// Equal-sized length quartiles, deterministically spaced within each quartile.
// Interleaving avoids ordering pilot by length; replace one with the sole CJK item.
export function sampleIndices(texts: string[]): number[] {
  if (texts.length < 200 || texts.some(x => typeof x !== 'string' || !x.trim())) throw Error('Invalid corpus');
  const ranked = texts.map((s, i) => ({ i, length: s.length })).sort((a, b) => a.length - b.length || a.i - b.i);
  const selected: number[] = [];
  for (let j = 0; j < 50; j++) for (let q = 0; q < 4; q++) selected.push(ranked[Math.floor((q * 50 + j + 0.5) * texts.length / 200)].i);
  // This corpus has one CJK item. Include it only if present and not already selected.
  const cjk = texts.findIndex(s => /[㐀-鿿]/u.test(s));
  if (cjk >= 0 && !selected.includes(cjk)) selected[2] = cjk;
  return selected;
}
export function makeFrozen(raw: string): Frozen {
  const texts: unknown = JSON.parse(raw);
  if (!Array.isArray(texts)) throw Error('Invalid corpus');
  const sample = sampleIndices(texts).map(index => ({ index, textHash: hash(texts[index]) }));
  const selected = new Set(sample.map(x => x.index));
  if (selected.size !== 200 || REVIEWS.length !== 40 || new Set(REVIEWS.map(x => x.index)).size !== 40 || REVIEWS.some(x => !selected.has(x.index))) throw Error('Review set must be 40 distinct members of sample');
  return { version: 1, datasetHash: hash(raw), scale: SCALE_GUIDE, sample, draftReviews: REVIEWS, annotationStatus: 'independent-ai-draft-not-human-reviewed', frozenAt: new Date().toISOString() };
}
export async function freeze(): Promise<void> {
  const raw = await readFile(SOURCE, 'utf8');
  const frozen = makeFrozen(raw);
  await mkdir(OUTPUT, { recursive: true });
  // Exclusive creation prevents accidental overwrite of a pre-existing frozen review.
  await writeFile(new URL('frozen.json', OUTPUT), JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
export function validateResults(sample: Sample[], input: unknown): Result[] {
  if (!Array.isArray(input)) throw Error('Invalid results');
  const valid = new Set(sample.map(x => x.index)), seen = new Set<number>();
  for (const row of input) {
    if (!row || !Number.isSafeInteger(row.index) || !valid.has(row.index) || seen.has(row.index) || !validateScores(row.scores)) throw Error('Invalid or duplicate result');
    seen.add(row.index);
  }
  return input;
}
export function evaluate(sample: Sample[], reviews: readonly Review[], input: unknown) {
  const results = validateResults(sample, input);
  const byIndex = new Map(results.map(x => [x.index, x.scores]));
  let accepted = 0, assessed = 0, seriousFalsePositives = 0;
  const perScale = Object.fromEntries(SCALE_KEYS.map(k => [k, { accepted: 0, assessed: 0, seriousFalsePositives: 0 }])) as Record<Key, { accepted: number; assessed: number; seriousFalsePositives: number }>;
  for (const review of reviews) {
    const scores = byIndex.get(review.index);
    if (!scores) continue;
    for (const key of SCALE_KEYS) {
      const [lo, hi] = review.intervals[key], score = scores[key];
      const pass = score >= lo && score <= hi;
      assessed++; perScale[key].assessed++;
      if (pass) { accepted++; perScale[key].accepted++; }
      // Operational definition, reported as a count rather than silently folded into acceptance.
      if (hi === 0 && score >= 3) { seriousFalsePositives++; perScale[key].seriousFalsePositives++; }
    }
  }
  return { valid: results.length, complete: results.length >= 198, reviewedOriginals: assessed / 5, assessed, accepted, acceptance: assessed ? accepted / assessed : null, seriousFalsePositives, perScale,
    note: 'Acceptance only covers independently reviewed originals; the other 160 have unknown correctness. False positive means score >=3 where the review upper bound is 0.' };
}
export function compare(sample: Sample[], reviews: readonly Review[], a: unknown, b: unknown) {
  const gpt = evaluate(sample, reviews, a), minimax = evaluate(sample, reviews, b);
  const comparable = gpt.complete && minimax.complete && gpt.assessed === 200 && minimax.assessed === 200;
  const withinFivePoints = comparable && Math.abs(gpt.acceptance! - minimax.acceptance!) <= 0.05 + Number.EPSILON;
  return { gpt, minimax, comparable, withinFivePoints, selected: null, selectionReason: 'No automatic winner: review is an AI draft, not an attested human review; acceptance and false-positive adequacy require human judgment.' };
}

// This injected boundary deliberately performs no network access. A production adapter
// must use the server model client with one request per five presegmented originals,
// capture returned model and usage, and classify errors before it can be enabled.
export type ChunkResponse = { results: Result[]; model: string; usage: unknown; finishStatus?: string };
export type ChunkCall = (items: { index: number; text: string }[], signal: AbortSignal) => Promise<ChunkResponse>;
export async function runChunk(items: { index: number; text: string }[], call: ChunkCall, timeoutMs = 60000): Promise<{ response: ChunkResponse; seconds: number }> {
  if (!items.length || items.length > 5 || new Set(items.map(x => x.index)).size !== items.length) throw Error('Invalid chunk');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Chunk timeout')); }, timeoutMs); });
  const started = performance.now();
  try {
    const response = await Promise.race([call(items, controller.signal), timeout]);
    if (controller.signal.aborted || !response || typeof response.model !== 'string' || !response.model || !('usage' in response)) throw Error('Invalid chunk metadata');
    const result = validateResults(items.map(x => ({ index: x.index, textHash: hash(x.text) })), response.results);
    if (result.length !== items.length) throw Error('Incomplete chunk');
    return { response, seconds: (performance.now() - started) / 1000 };
  } finally { clearTimeout(timer); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === 'freeze' && process.argv.length === 3) {
    freeze().then(() => console.log('Frozen AI draft created; human review and model adapter are still required.')).catch(() => { console.error('Freeze failed; existing frozen files are never overwritten.'); process.exitCode = 1; });
  } else {
    console.error('Only the offline freeze command is available. No model calls are enabled.'); process.exitCode = 1;
  }
}
