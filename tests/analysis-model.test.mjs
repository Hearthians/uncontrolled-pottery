import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelClient, ANALYSIS_PROMPT } from '../server/model.ts';

const scores = { calm:0, anxiety:1, anger:0, stress:2, sadness:0 };
function response(body) { return new Response(JSON.stringify(body), { status:200, headers:{ 'content-type':'application/json' } }); }
test('both providers use fixed endpoints, rubric and strict output validation', async () => {
  for (const provider of ['gpt', 'minimax']) {
    let count = 0;
    const client = createModelClient({ provider, apiKey:'test-key', fetch: async (url, options) => {
      count++;
      assert.equal(new URL(url).hostname, 'api.gfyh.fun');
      const req = JSON.parse(options.body);
      assert.equal(req.model, provider === 'gpt' ? 'gpt-6-luna' : 'MiniMax-M3.1-Flash');
      assert.match(JSON.stringify(req), /explicitly sustained/);
      if (provider === 'gpt') {
        assert.equal(req.instructions, undefined);
        assert.deepEqual(req.input.map(message => message.role), ['system', 'user']);
        assert.equal(req.input[1].content, 'hi');
      }
      const text = JSON.stringify({ ranges:[{ start:0, end:2, scores }] });
      return response(provider === 'gpt' ? { id:'x', model:'test-model', status:'completed', output:[{ type:'message', content:[{ type:'output_text', text }] }] } : { model:'test-model', choices:[{ finish_reason:'stop', message:{ role:'assistant', content:text } }] });
    } });
    assert.deepEqual(await client.analyze('hi'), [{ start:0, end:2, scores }]); assert.equal(count, 1);
  }
  assert.match(ANALYSIS_PROMPT, /third party/);
});
test('auth and unsupported failures do not retry or leak response bodies', async () => {
  for (const [status, kind] of [[401, 'auth'], [404, 'unsupported']]) {
    let count = 0;
    const client = createModelClient({ provider:'gpt', apiKey:'test', fetch: async () => { count++; return new Response(JSON.stringify({error:{message:'secret'}}), {status, headers:{'content-type':'application/json'}}); } });
    await assert.rejects(client.analyze('hi'), error => error.kind === kind && !error.message.includes('secret'));
    assert.equal(count, 1);
  }
});
test('invalid or refused responses retry only once and do not expose errors', async () => {
  let count = 0;
  const client = createModelClient({ provider:'minimax', apiKey:'secret', fetch: async () => { count++; return response({ choices:[{ finish_reason:'stop', message:{ role:'assistant', refusal:'private refusal secret', content:null } }] }); } });
  await assert.rejects(client.analyze('hi'), error => error.kind === 'refusal' && !error.message.includes('secret')); assert.equal(count, 2);
});
