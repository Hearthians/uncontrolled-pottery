import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelClient } from '../server/model.ts';
const scores = { calm:0, anxiety:1, anger:2, stress:3, sadness:4 };
function json(body, status=200) { return new Response(JSON.stringify(body), { status, headers:{ 'content-type':'application/json' } }); }
const items = [{ id:'one', text:'first' },{ id:'two', text:'second' }];
test('batch adapter returns actual metadata and checks all IDs', async () => {
  let count = 0;
  const client = createModelClient({ provider:'minimax', apiKey:'fake', fetch: async () => { count++; return json({ model:'actual-version', usage:{ prompt_tokens:7, completion_tokens:8 }, choices:[{ finish_reason:'stop', message:{ content:JSON.stringify({ entries:items.map(({id}) => ({ id, scores })) }) } }] }); } });
  const result = await client.analyzeMemories(items);
  assert.equal(result.model, 'actual-version'); assert.deepEqual(result.usage, { prompt_tokens:7, completion_tokens:8 }); assert.equal(result.finishStatus, 'stop'); assert.equal(result.entries.length, 2); assert.equal(count, 1);
});
test('batch adapter sanitizes errors, refuses bad schema and never retries', async () => {
  for (const [body, status, kind] of [
    [{ error:{ message:'private secret' } }, 401, 'auth'],
    [{ error:{ message:'private secret' } }, 404, 'unsupported'],
    [{ error:{ message:'private secret' } }, 429, 'transient'],
    [{ model:'actual', choices:[{finish_reason:'stop',message:{refusal:'secret'}}] }, 200, 'refusal'],
    [{ model:'actual', choices:[{finish_reason:'length',message:{content:'secret'}}] }, 200, 'incomplete'],
    [{ model:'actual', choices:[{finish_reason:'stop',message:{content:JSON.stringify({entries:[{id:'one',scores},{id:'one',scores}]})}}] }, 200, 'schema']
  ]) {
    let count = 0;
    const client = createModelClient({ provider:'minimax', apiKey:'private secret', fetch: async () => { count++; return json(body,status); } });
    await assert.rejects(client.analyzeMemories(items), e => e.kind === kind && !e.message.includes('secret'));
    assert.equal(count, 1);
  }
});
