import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySource } from '../src/memorySource.ts';
import { MAX_MEMORY_FILE_BYTES } from '../src/memoryPlayback.ts';

const file = (values) => ({ size: JSON.stringify(values).length, text: async () => JSON.stringify(values) });
const response = (values) => new Response(JSON.stringify(values));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('default loading gates printing and produces validated text-only originals', async () => {
  const pending = deferred();
  let options;
  const source = new MemorySource('/memories.json', () => false, async (url, init) => {
    assert.equal(url, '/memories.json'); options = init; return pending.promise;
  });
  assert.equal(source.canStart, false);
  const loading = source.loadDefault();
  assert.equal(source.getSnapshot().phase, 'loading');
  pending.resolve(response([{ activity: 'Original\ntext', name: 'Private metadata' }]));
  assert.equal(await loading, true);
  assert.deepEqual(source.getSnapshot().memories, [{ text: 'Original\ntext' }]);
  assert.equal(source.canStart, true);
  assert.equal(options.mode, 'same-origin'); assert.equal(options.cache, 'no-store');
});

test('default fetch wrapper does not bind the native browser API to the source instance', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function () {
    assert.equal(this, undefined, 'fetch must not receive MemorySource as its receiver');
    return response(['Default wrapper original']);
  };
  try {
    const source = new MemorySource('/memories.json', () => false);
    assert.equal(await source.loadDefault(), true);
  } finally { globalThis.fetch = original; }
});

test('production subpath loads its public default and still permits session-only replacement', async () => {
  const source = new MemorySource('/pottery/memories.json', () => false, async (url) => {
    assert.equal(url, '/pottery/memories.json');
    return response(['Public original']);
  });
  await source.loadDefault();
  assert.equal(source.getSnapshot().phase, 'ready');
  assert.equal(source.getSnapshot().origin, 'default');
  await source.importFile(file(['Manual original']));
  assert.equal(source.canStart, true);
  assert.equal(source.getSnapshot().origin, 'file');
});

test('manual import, clear and StrictMode-style cleanup invalidate delayed default loads', async () => {
  const requests = [];
  const source = new MemorySource('/memories.json', () => false, async (_url, options) => {
    const request = deferred(); requests.push({ ...request, options }); return request.promise;
  });
  const first = source.loadDefault(); source.cancel();
  const second = source.loadDefault();
  assert.equal(requests[0].options.signal.aborted, true);
  const importRead = deferred();
  const importing = source.importFile({ size: 100, text: () => importRead.promise });
  assert.equal(requests[1].options.signal.aborted, true);
  requests[0].resolve(response(['Stale first'])); requests[1].resolve(response(['Stale second']));
  await Promise.all([first, second]);
  assert.equal(source.canStart, false);
  importRead.resolve('["Manual choice"]'); await importing;
  assert.equal(source.getSnapshot().memories[0].text, 'Manual choice');
  const retry = source.loadDefault(); source.clear();
  requests[2].resolve(response(['Stale after clear'])); await retry;
  assert.equal(source.getSnapshot().phase, 'empty'); assert.deepEqual(source.getSnapshot().memories, []);
});

test('failed replacements preserve valid data and sanitize default-load errors', async () => {
  for (const makeResponse of [
    () => new Response('private-path-and-text', { status: 404 }),
    () => new Response('{PRIVATE_ORIGINAL'),
    () => response([]),
    () => response(Array(2001).fill('too many')),
    () => new Response('x', { headers: { 'content-length': String(MAX_MEMORY_FILE_BYTES + 1) } }),
    () => new Response('x'.repeat(MAX_MEMORY_FILE_BYTES + 1)),
  ]) {
    const source = new MemorySource('/memories.json', () => false, async () => makeResponse());
    assert.equal(await source.loadDefault(), false);
    assert.equal(source.getSnapshot().phase, 'error'); assert.equal(source.canStart, false);
    assert.ok(!source.getSnapshot().error.includes('PRIVATE'));
    await source.importFile(file(['Retained original']));
    assert.equal(await source.loadDefault(), false);
    assert.equal(source.canStart, true);
    assert.deepEqual(source.getSnapshot().memories, [{ text: 'Retained original' }]);
    assert.equal(await source.importFile({ size: MAX_MEMORY_FILE_BYTES + 1, text: () => { throw new Error('not read'); } }), false);
    assert.equal(source.canStart, true);
  }
});

test('active-print lock prevents import, retry, clear and pending commits', async () => {
  let locked = false;
  const source = new MemorySource('/memories.json', () => locked, async () => response(['Default']));
  await source.loadDefault(); locked = true;
  await source.importFile(file(['Forbidden'])); await source.loadDefault(); source.clear();
  assert.equal(source.getSnapshot().memories[0].text, 'Default');
  locked = false;
  const read = deferred(); const loading = source.importFile({ size: 1, text: () => read.promise });
  locked = true; read.resolve('["Forbidden late"]'); await loading;
  assert.equal(source.getSnapshot().memories[0].text, 'Default');
});
