import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SOURCE, OUTPUT, MODELS, runChunk, compare, type Frozen, type Result, type ChunkCall } from './eval-memories.ts';
import { EvalFailure, createEvalProvider, type Provider } from './eval-memories-provider.ts';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
type Attempt = { startedAt: string; status: 'started' | 'ok' | 'transient' | 'schema' | 'unsupported' | 'authorization' | 'protocol'; seconds?: number; model?: string; finishStatus?: string; usage?: Record<string, number> | null };
function safeUsage(usage: unknown): Record<string, number> | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const source = usage as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'prompt_tokens', 'completion_tokens']) {
    const value = source[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) result[key] = value;
  }
  return Object.keys(result).length ? result : null;
}
type Chunk = { indices: number[]; attempts: Attempt[]; results?: Result[] };
type Checkpoint = { version: 1; frozenHash: string; providers: Record<Provider, Chunk[]> };
function newCheckpoint(frozen: Frozen, frozenHash: string): Checkpoint {
  const indices = frozen.sample.map(x => x.index);
  const chunks = Array.from({ length: 40 }, (_, i) => ({ indices: indices.slice(i * 5, i * 5 + 5), attempts: [] }));
  return { version: 1, frozenHash, providers: { gpt: structuredClone(chunks), minimax: structuredClone(chunks) } };
}
async function atomic(path: URL, data: unknown) {
  const tmp = new URL(`.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`, path);
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
}
export async function run(stage: 'pilot' | 'remaining', supplied?: Record<Provider, ChunkCall>, output: URL = OUTPUT) {
  const frozenRaw = await readFile(new URL('frozen.json', output), 'utf8');
  const frozen: Frozen = JSON.parse(frozenRaw), sourceRaw = await readFile(SOURCE, 'utf8');
  if (frozen.version !== 1 || frozen.annotationStatus !== 'independent-ai-draft-not-human-reviewed' || frozen.sample.length !== 200 || frozen.draftReviews.length !== 40 || digest(sourceRaw) !== frozen.datasetHash) throw Error('Frozen benchmark or corpus mismatch');
  const corpus: string[] = JSON.parse(sourceRaw);
  for (const x of frozen.sample) if (typeof corpus[x.index] !== 'string' || digest(corpus[x.index]) !== x.textHash) throw Error('Sample mismatch');
  await mkdir(output, { recursive: true });
  // Never remove this lock automatically: a crashed process might still be active.
  await writeFile(new URL('run.lock', output), `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  const statePath = new URL('checkpoint.json', output);
  let state: Checkpoint;
  try {
    try { state = JSON.parse(await readFile(statePath, 'utf8')); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; state = newCheckpoint(frozen, digest(frozenRaw)); }
    const expected = newCheckpoint(frozen, digest(frozenRaw));
    if (state.version !== 1 || state.frozenHash !== expected.frozenHash || (Object.keys(MODELS) as Provider[]).some(p => state.providers[p].length !== 40 || state.providers[p].some((c, i) => JSON.stringify(c.indices) !== JSON.stringify(expected.providers[p][i].indices) || c.attempts.length > 2))) throw Error('Checkpoint mismatch');
    if (stage === 'remaining' && (Object.keys(MODELS) as Provider[]).some(p => !state.providers[p][0].results)) throw Error('Both pilot chunks must pass before remaining evaluation');
    let pilotFailed = false;
    for (const provider of Object.keys(MODELS) as Provider[]) {
      const candidates = stage === 'pilot' ? [0] : Array.from({ length: 39 }, (_, i) => i + 1);
      let call: ChunkCall | undefined = supplied?.[provider];
      for (const chunkIndex of candidates) {
        const chunk = state.providers[provider][chunkIndex];
        if (chunk.results) continue;
        // A started attempt may have reached the provider; do not risk a duplicate.
        if (chunk.attempts.some(a => a.status === 'started') || chunk.attempts.length >= 2 || chunk.attempts.some(a => !['transient', 'schema'].includes(a.status))) {
          if (stage === 'pilot') { pilotFailed = true; break; }
          throw Error('Stopped: chunk requires manual review');
        }
        call ??= await createEvalProvider(provider);
        const items = chunk.indices.map(index => ({ index, text: corpus[index] }));
        while (chunk.attempts.length < 2 && !chunk.results) {
          const attempt: Attempt = { startedAt: new Date().toISOString(), status: 'started' };
          chunk.attempts.push(attempt); await atomic(statePath, state);
          const started = performance.now();
          try {
            const response = await runChunk(items, call);
            attempt.seconds = response.seconds; attempt.model = response.response.model.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 120); attempt.usage = safeUsage(response.response.usage);
            attempt.finishStatus = response.response.finishStatus === 'completed' || response.response.finishStatus === 'stop' ? response.response.finishStatus : undefined;
            if (attempt.model !== MODELS[provider]) throw new EvalFailure('protocol');
            attempt.status = 'ok'; chunk.results = response.response.results;
          } catch (e) {
            attempt.seconds = (performance.now() - started) / 1000;
            attempt.status = e instanceof EvalFailure ? e.category : 'protocol';
          }
          await atomic(statePath, state);
          if (attempt.status !== 'ok' && (!['transient', 'schema'].includes(attempt.status) || chunk.attempts.length >= 2)) {
            if (stage === 'pilot') { pilotFailed = true; break; }
            throw Error('Stopped: chunk failed');
          }
        }
      }
    }
    if (pilotFailed) throw Error('Stopped: at least one pilot failed');
    const report = compare(frozen.sample, frozen.draftReviews, state.providers.gpt.flatMap(c => c.results ?? []), state.providers.minimax.flatMap(c => c.results ?? []));
    await atomic(new URL('report.json', output), { stage, ...report });
    return report;
  } finally {
    // Delete only the lock this run created.
    const { unlink } = await import('node:fs/promises');
    await unlink(new URL('run.lock', output));
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stage = process.argv[2];
  if ((stage !== 'pilot' && stage !== 'remaining') || process.argv.length !== 3) { console.error('Specify pilot or remaining.'); process.exitCode = 1; }
  else run(stage).then(() => console.log('Stage completed; see checkpoint and provisional report.')).catch(() => { console.error('Stopped; inspect checkpoint status. No source or credentials are logged.'); process.exitCode = 1; });
}
