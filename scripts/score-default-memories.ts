// Scores only the public default corpus. Checkpoints contain scores and indices, never credentials.
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createEvalProvider, EvalFailure } from './eval-memories-provider.ts';
import { MODELS, runChunk, validateResults, type Result, type Sample } from './eval-memories.ts';

const source = new URL('../public/memories.json', import.meta.url);
const prior = new URL('../artifacts/eval-memory-retry-20261103/', import.meta.url);
const output = new URL('../artifacts/default-minimax-20261103/', import.meta.url);
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
type Attempt = { status: 'started' | 'ok' | 'schema' | 'transient' | 'authorization' | 'unsupported' | 'protocol'; seconds?: number; model?: string; usage?: unknown };
type Chunk = { indices: number[]; attempts: Attempt[]; results?: Result[] };
type Checkpoint = { version: 1; datasetHash: string; priorHash: string; chunks: Chunk[] };
async function atomic(file: URL, value: unknown) {
  const tmp = new URL(`.${process.pid}-${Date.now()}.tmp`, file);
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(tmp, file);
}
export async function scoreDefaults(): Promise<void> {
  const raw = await readFile(source, 'utf8');
  const corpus: unknown = JSON.parse(raw);
  if (!Array.isArray(corpus) || corpus.length !== 1910 || corpus.some(x => typeof x !== 'string' || !x.trim())) throw Error('Invalid default corpus');
  const frozen = JSON.parse(await readFile(new URL('frozen.json', prior), 'utf8'));
  const priorRaw = await readFile(new URL('checkpoint.json', prior), 'utf8');
  const previous = JSON.parse(priorRaw);
  if (frozen.datasetHash !== digest(raw) || previous.frozenHash !== digest(await readFile(new URL('frozen.json', prior), 'utf8'))) throw Error('Previous dataset mismatch');
  const sample: Sample[] = frozen.sample;
  if (!Array.isArray(sample) || sample.length !== 200 || sample.some(x => digest(corpus[x.index]) !== x.textHash)) throw Error('Previous sample mismatch');
  const existing = validateResults(sample, previous.providers.minimax.flatMap((c: Chunk) => c.results ?? []));
  if (existing.length !== 200) throw Error('Previous analysis incomplete');
  const done = new Set(existing.map(x => x.index));
  const remaining = corpus.map((_, i) => i).filter(i => !done.has(i));
  const chunks: Chunk[] = [];
  for (let i = 0; i < remaining.length; i += 5) chunks.push({ indices: remaining.slice(i, i + 5), attempts: [] });
  await mkdir(output, { recursive: true, mode: 0o700 });
  const lock = new URL('run.lock', output); await writeFile(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  try {
    const path = new URL('checkpoint.json', output); let state: Checkpoint;
    try { state = JSON.parse(await readFile(path, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; state = { version: 1, datasetHash: digest(raw), priorHash: digest(priorRaw), chunks }; }
    if (state.version !== 1 || state.datasetHash !== digest(raw) || state.priorHash !== digest(priorRaw) || state.chunks.length !== chunks.length || state.chunks.some((c, i) => JSON.stringify(c.indices) !== JSON.stringify(chunks[i].indices) || c.attempts.length > (c.indices[0] === 1384 || c.indices[0] === 1428 || c.indices[0] === 1639 ? 3 : 2))) throw Error('Checkpoint mismatch');
    const call = await createEvalProvider('minimax');
    for (const chunk of state.chunks) {
      if (chunk.results) { validateResults(chunk.indices.map(index => ({ index, textHash: digest(corpus[index]) })), chunk.results); if (chunk.results.length !== chunk.indices.length) throw Error('Invalid checkpoint results'); continue; }
      const attemptLimit = chunk.indices[0] === 1384 || chunk.indices[0] === 1428 || chunk.indices[0] === 1639 ? 3 : 2;
      if (chunk.attempts.some(a => a.status === 'started') || chunk.attempts.length >= attemptLimit || chunk.attempts.some(a => !['schema', 'transient', 'protocol'].includes(a.status))) throw Error('Chunk needs manual review');
      while (chunk.attempts.length < attemptLimit && !chunk.results) {
        const attempt: Attempt = { status: 'started' }; chunk.attempts.push(attempt); await atomic(path, state);
        const start = performance.now();
        try {
          const r = await runChunk(chunk.indices.map(index => ({ index, text: corpus[index] })), call);
          attempt.seconds = r.seconds; attempt.model = r.response.model; attempt.usage = r.response.usage;
          if (r.response.model !== MODELS.minimax) throw new EvalFailure('protocol');
          attempt.status = 'ok'; chunk.results = r.response.results;
        } catch (e) {
          attempt.seconds = (performance.now() - start) / 1000; attempt.status = e instanceof EvalFailure ? e.category : 'protocol';
        }
        await atomic(path, state);
        if (attempt.status !== 'ok' && (!['transient', 'schema', 'protocol'].includes(attempt.status) || chunk.attempts.length >= 2)) throw Error('Stopped after failed batch');
      }
    }
    const results = [...existing, ...state.chunks.flatMap(c => c.results ?? [])];
    const all: Sample[] = corpus.map((text, index) => ({ index, textHash: digest(text) }));
    validateResults(all, results);
    if (results.length !== corpus.length) throw Error('Incomplete scores');
    await atomic(new URL('scores.json', output), { version: 1, datasetHash: digest(raw), model: MODELS.minimax, prompt: 'memory-score-1', results: results.sort((a, b) => a.index - b.index) });
    console.log(`Scored ${results.length} public memories, including ${existing.length} reused benchmark results.`);
  } finally { await unlink(lock); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) scoreDefaults().catch(e => { console.error(`Stopped: ${e.message}`); process.exitCode = 1; });
