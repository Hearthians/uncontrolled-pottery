import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySource } from '../src/memorySource.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateAnalyzedMemories } from '../src/memoryPlayback.ts';
const scores = {calm: 0, anxiety: 1, anger: 2, stress: 3, sadness: 5};
const entries = [{id:'one',text:'Example',scores,status:'analyzed',source:{block:0,start:0,end:7}}];
const response = () => new Response(JSON.stringify(['Old memory']));

test('analysis is reviewed and applied atomically, preserving independent scores', async () => {
  const source = new MemorySource('/memories.json', () => false, async () => response());
  await source.loadDefault();
  const generation = source.beginAnalysis();
  assert.equal(source.canStart, false);
  assert.equal(source.getSnapshot().memories[0].text, 'Old memory');
  assert.equal(source.applyAnalysis(generation, entries), true);
  assert.equal(source.canStart, true);
  assert.deepEqual(source.getSnapshot().memories, entries);
});

test('failed, cancelled, stale and locked results cannot replace the active source', async () => {
  let locked = false;
  const source = new MemorySource('/memories.json', () => locked, async () => response());
  await source.loadDefault();
  const first = source.beginAnalysis();
  assert.throws(() => source.applyAnalysis(first, [{...entries[0],scores:{...scores,calm:6}}]));
  assert.equal(source.getSnapshot().memories[0].text, 'Old memory');
  source.endAnalysis(first);
  assert.equal(source.applyAnalysis(first, entries), false);
  const second = source.beginAnalysis();
  locked = true;
  assert.equal(source.applyAnalysis(second, entries), false);
  locked = false;
  await source.loadDefault();
  assert.equal(source.applyAnalysis(second, entries), false);
  assert.equal(source.getSnapshot().memories[0].text, 'Old memory');
});

test('analyzed validation rejects duplicate IDs, incomplete scores and invalid ranges', () => {
  assert.throws(() => validateAnalyzedMemories([entries[0], entries[0]]));
  assert.throws(() => validateAnalyzedMemories([{...entries[0],scores:{calm:0}}]));
  assert.throws(() => validateAnalyzedMemories([{...entries[0],source:{block:0,start:0,end:9}}]));
});

const corpus = await readFile(new URL('../public/memories.json', import.meta.url));
const original = JSON.parse(corpus.toString('utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validSidecar = () => ({ version: 1, model: 'MiniMax-fixture', prompt: 'fixture-v1', corpusSha256: sha(corpus), scores: original.map((_, i) => ({ ...scores, calm: i % 6 })) });
const sourceFor = (sidecar, raw = corpus) => new MemorySource('/pottery/memories.json', () => false, async (url, options) => {
  if (url === '/pottery/memories.json') return new Response(raw);
  assert.equal(url, '/pottery/default-memory-scores.json');
  assert.equal(options.headers.Accept, 'application/json');
  return sidecar instanceof Response ? sidecar : new Response(JSON.stringify(sidecar));
});

test('sidecar binds every indexed score to exact raw corpus bytes and preserves original text', async () => {
  const data = validSidecar(), source = sourceFor(data);
  assert.equal(await source.loadDefault(), true);
  const state = source.getSnapshot();
  assert.equal(state.origin, 'default'); assert.equal(state.defaultScores, 'analyzed');
  assert.equal(state.memories.length, 1910);
  for (let i = 0; i < original.length; i++) {
    assert.equal(state.memories[i].text, original[i]);
    assert.deepEqual(state.memories[i].scores, data.scores[i]);
    assert.equal(state.memories[i].demoScores, undefined);
  }
});

test('invalid, mismatched, partial and unavailable sidecars fail closed without demo scores', async () => {
  const good = validSidecar();
  const cases = [
    { ...good, version: 2 }, { ...good, model: '' }, { ...good, model: 'other-model' }, { ...good, prompt: ' ' },
    { ...good, extra: true }, { ...good, corpusSha256: '0'.repeat(64) },
    { ...good, scores: good.scores.slice(1) },
    { ...good, scores: good.scores.map((s, i) => i === 500 ? { ...s, anger: 6 } : s) },
    { ...good, scores: good.scores.map((s, i) => i === 900 ? { ...s, extra: 0 } : s) },
    new Response('{bad json'), new Response('error', { status: 500 }),
  ];
  for (const data of cases) {
    const source = sourceFor(data);
    assert.equal(await source.loadDefault(), true);
    const state = source.getSnapshot();
    assert.equal(state.defaultScores, 'unavailable');
    assert.ok(state.memories.every(m => m.scores === undefined && !m.demoScores));
  }
  const changed = sourceFor(good, Buffer.concat([corpus, Buffer.from('\n')]));
  await changed.loadDefault();
  assert.equal(changed.getSnapshot().defaultScores, 'unavailable');
  const absent = sourceFor(new Response(null, { status: 404 }));
  await absent.loadDefault();
  assert.equal(absent.getSnapshot().defaultScores, 'none');
});

test('late sidecar results cannot replace an imported or cleared source', async () => {
  let resolve, signal, requested;
  const waiting = new Promise(r => { resolve = r; });
  const started = new Promise(r => { requested = r; });
  const source = new MemorySource('/memories.json', () => false, async (url, options) => {
    if (url === '/memories.json') return new Response(corpus);
    signal = options.signal; requested(); return waiting;
  });
  const loading = source.loadDefault();
  await started;
  await source.importFile({ size: 10, text: async () => '["Imported"]' });
  assert.equal(signal.aborted, true);
  resolve(new Response(JSON.stringify(validSidecar())));
  assert.equal(await loading, false);
  assert.equal(source.getSnapshot().origin, 'file');
  assert.deepEqual(source.getSnapshot().memories, [{ text: 'Imported' }]);
});
