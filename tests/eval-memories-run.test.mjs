import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCE, makeFrozen, MODELS } from '../scripts/eval-memories.ts';
import { run } from '../scripts/eval-memories-run.ts';
import { EvalFailure } from '../scripts/eval-memories-provider.ts';

const scores = { calm: 0, anxiety: 0, anger: 0, stress: 0, sadness: 0 };
async function withOutput(testFn) {
  const dir = await mkdtemp(join(tmpdir(), 'memory-eval-test-'));
  const output = pathToFileURL(`${dir}/`);
  try {
    const raw = await readFile(SOURCE, 'utf8');
    await writeFile(new URL('frozen.json', output), JSON.stringify(makeFrozen(raw)));
    await testFn(output);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const response = (model, items) => ({ model, usage: { total_tokens: 9, unsafe: 'ignore' }, finishStatus: 'stop', results: items.map(x => ({ index: x.index, scores })) });

test('pilot completes 5+5, resumes, then runs 195+195', async () => withOutput(async output => {
  const calls = { gpt: 0, minimax: 0 };
  const mock = Object.fromEntries(Object.keys(calls).map(k => [k, async items => { calls[k]++; assert.equal(items.length, 5); return response(MODELS[k], items); }]));
  await assert.rejects(run('remaining', mock, output));
  await run('pilot', mock, output);
  assert.deepEqual(calls, { gpt: 1, minimax: 1 });
  await run('pilot', mock, output);
  assert.deepEqual(calls, { gpt: 1, minimax: 1 });
  const report = await run('remaining', mock, output);
  assert.deepEqual(calls, { gpt: 40, minimax: 40 });
  assert.equal(report.gpt.valid, 200);
  assert.equal(report.selected, null);
  const state = JSON.parse(await readFile(new URL('checkpoint.json', output), 'utf8'));
  assert.deepEqual(state.providers.gpt[0].attempts[0].usage, { total_tokens: 9 });
}));

test('one retry only for schema or transient failure', async () => withOutput(async output => {
  let calls = 0;
  const mock = { gpt: async items => { calls++; if (calls === 1) throw new EvalFailure('schema'); return response(MODELS.gpt, items); }, minimax: async items => response(MODELS.minimax, items) };
  await run('pilot', mock, output);
  assert.equal(calls, 2);
  const state = JSON.parse(await readFile(new URL('checkpoint.json', output), 'utf8'));
  assert.deepEqual(state.providers.gpt[0].attempts.map(x => x.status), ['schema', 'ok']);
}));

test('authorization failure is not retried and does not prevent the other pilot', async () => withOutput(async output => {
  let calls = 0, otherCalls = 0;
  const mock = { gpt: async () => { calls++; throw new EvalFailure('authorization'); }, minimax: async items => { otherCalls++; return response(MODELS.minimax, items); } };
  await assert.rejects(run('pilot', mock, output));
  await assert.rejects(run('pilot', mock, output));
  await assert.rejects(run('remaining', mock, output));
  assert.equal(calls, 1);
  assert.equal(otherCalls, 1);
}));
