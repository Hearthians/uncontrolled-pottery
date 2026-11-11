import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, chmod, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openQuota } from '../server/quota.ts';
import { createModelClient, createFallbackModelClient, QuotaError } from '../server/model.ts';
import { createServer } from '../server/index.ts';

async function fixture(t, limit = 3, clock = () => Date.now()) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quota-test-')); const dir = path.join(root, 'quota');
  t.after(() => rm(root, { recursive: true, force: true }));
  const quota = await openQuota(dir, limit, clock); t.after(() => quota.close());
  return { quota, dir };
}
const scores = {calm:0,anxiety:0,anger:0,stress:0,sadness:0};
function reply(text = 'hello') { return new Response(JSON.stringify({ id:'id', model:'mock', choices:[{ finish_reason:'stop', message:{role:'assistant',content:JSON.stringify({ranges:[{start:0,end:text.length,scores}]})} }] }), {status:200,headers:{'content-type':'application/json'}}); }

test('quota serializes concurrent reservations, survives restart and resets UTC day', async t => {
  let time = Date.UTC(2026,0,1,23,59); const { quota, dir } = await fixture(t, 3, () => time);
  const results = await Promise.allSettled(Array.from({length:10}, () => quota.reserve()));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 3);
  assert.equal(JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).count, 3);
  await assert.rejects(openQuota(dir, 3, () => time));
  await quota.close(); const reopened = await openQuota(dir, 3, () => time); t.after(() => reopened.close());
  await assert.rejects(reopened.reserve(), /exhausted/);
  time = Date.UTC(2026,0,2); await reopened.reserve();
  assert.equal(JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).count, 1);
});

test('killing lock holder during writes cannot overwrite a new holder reservation', async t => {
  const { quota, dir } = await fixture(t, 3000);
  const childIds = (await readFile(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean);
  let worker;
  for (const id of childIds) { try { const cmd = await readFile(`/proc/${id}/cmdline`, 'utf8'); if (cmd.includes('--quota-worker') && cmd.includes(dir)) worker = Number(id); } catch {} }
  assert.ok(worker, 'quota worker identified');
  const requests = Array.from({length:200}, () => quota.reserve());
  await new Promise(r => setTimeout(r, 5)); process.kill(worker, 'SIGKILL');
  const results = await Promise.allSettled(requests);
  await quota.close();
  const before = JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).count;
  assert.ok(before >= results.filter(x => x.status === 'fulfilled').length);
  const reopened = await openQuota(dir, 3000); t.after(() => reopened.close());
  await reopened.reserve();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).count, before + 1);
});

test('quota fails closed for bad state, permissions and backward clock', async t => {
  let time = Date.UTC(2026,0,2); const { quota, dir } = await fixture(t, 3, () => time);
  time -= 86400000; await assert.rejects(quota.reserve()); time += 86400000; await assert.rejects(quota.reserve());
  await quota.close(); await chmod(path.join(dir,'state.json'), 0o644); await assert.rejects(openQuota(dir, 3));
  await chmod(path.join(dir,'state.json'), 0o600); await writeFile(path.join(dir,'state.json'), '{'); await assert.rejects(openQuota(dir, 3));
});

test('each failed retry and fallback consumes shared quota; quota stops fallback', async t => {
  const { quota } = await fixture(t, 3); const calls = [], statuses = [];
  const fetch = async (_url, init) => { calls.push(JSON.parse(init.body).model); return calls.length < 3 ? new Response('{}',{status:500}) : new Response(JSON.stringify({id:'id',model:'mock',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({ranges:[{start:0,end:5,scores}]})}]}]}),{status:200,headers:{'content-type':'application/json'}}); };
  const client = createFallbackModelClient({provider:'minimax', apiKey:'primary', fallbackApiKey:'other', quota, fetch, onStatus:s => statuses.push(s)});
  assert.equal((await client.analyze('hello')).length, 1);
  assert.deepEqual(calls, ['MiniMax-M3.1-Flash','MiniMax-M3.1-Flash','gpt-6-luna']);
  assert.deepEqual(statuses, ['fallback','fallback-ok']);
  await assert.rejects(client.analyze('hello'), QuotaError); assert.equal(calls.length, 3);
});

test('auth and refusal do not fall back, and direct client accounts for schema retry', async t => {
  const { quota, dir } = await fixture(t, 10); let calls = 0;
  const auth = createFallbackModelClient({provider:'minimax',apiKey:'x',fallbackApiKey:'y',quota,fetch:async () => { calls++; return new Response('{}',{status:401}); }});
  await assert.rejects(auth.analyze('hello')); assert.equal(calls,1);
  const malformed = createModelClient({provider:'minimax',apiKey:'x',quota,fetch:async () => { calls++; return reply('bad'); }});
  await assert.rejects(malformed.analyze('hello'));
  assert.equal(calls,3); assert.equal(JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).count,3);
});

test('job reports safe quota failure without calling the model', async t => {
  const { quota } = await fixture(t, 1); await quota.reserve(); let calls = 0;
  const modelClient = createModelClient({provider:'minimax',apiKey:'x',quota,fetch:async () => { calls++; return reply(); }});
  const server = createServer({publicAccess:true,modelClient}); server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/memories/jobs`;
  const created = await (await fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:{kind:'text',text:'private input'}})})).json();
  let job;
  for (let i=0;i<100;i++) { job = await (await fetch(`${base}/${created.id}`,{headers:{'x-memory-job-token':created.token}})).json(); if (job.status === 'failed') break; await new Promise(r => setTimeout(r,10)); }
  assert.equal(job.status,'failed'); assert.equal(job.error,'Daily model quota exhausted or unavailable'); assert.equal(calls,0); assert.ok(!JSON.stringify(job).includes('private input'));
});

test('refusal and cancellation do not fall back', async t => {
  const { quota } = await fixture(t, 10); let calls = 0;
  const fetch = async () => { calls++; return new Response(JSON.stringify({id:'id',model:'mock',choices:[{finish_reason:'content_filter',message:{role:'assistant',content:null}}]}), {status:200,headers:{'content-type':'application/json'}}); };
  const client = createFallbackModelClient({provider:'minimax',apiKey:'x',fallbackApiKey:'y',quota,fetch});
  await assert.rejects(client.analyze('hello')); assert.equal(calls,2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.analyze('hello',{signal:controller.signal})); assert.equal(calls,2);
});

test('public entrypoint fails closed without explicit budget configuration', () => {
  const env = {...process.env, MEMORY_ANALYSIS_PUBLIC:'1', MEMORY_ANALYSIS_PROVIDER:'minimax', MEMORY_ANALYSIS_API_KEY:'test', MEMORY_ANALYSIS_BUDGET_MODE:'', MEMORY_ANALYSIS_QUOTA_DIR:'', MEMORY_ANALYSIS_DAILY_LIMIT:''};
  const run = (extra) => spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../server/index.ts', import.meta.url))], {env:{...env,...extra}, encoding:'utf8',timeout:3000});
  for (const extra of [{}, {MEMORY_ANALYSIS_BUDGET_MODE:'bad'}, {MEMORY_ANALYSIS_BUDGET_MODE:'disk'}, {MEMORY_ANALYSIS_BUDGET_MODE:'gateway',MEMORY_ANALYSIS_DAILY_LIMIT:'3000'}]) {
    const result = run(extra);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/budget|quota/i);
  }
});

test('gateway budget must be explicit, restricted to gateway and retains fallback', async t => {
  assert.throws(() => createFallbackModelClient({provider:'minimax',apiKey:'x',fallbackApiKey:'y'}));
  assert.throws(() => createModelClient({provider:'minimax',apiKey:'x',gatewayBudget:true,baseURL:'https://example.com/v1'}));
  assert.throws(() => createModelClient({provider:'minimax',apiKey:'x',gatewayBudget:true,quota:{reserve:async () => {}}}));
  const calls = [];
  const client = createFallbackModelClient({provider:'minimax',apiKey:'x',fallbackApiKey:'y',gatewayBudget:true,fetch:async (_url, init) => {
    calls.push(JSON.parse(init.body).model);
    return calls.length < 3 ? new Response('{}',{status:500}) : new Response(JSON.stringify({id:'id',model:'mock',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({ranges:[{start:0,end:5,scores}]})}]}]}),{status:200,headers:{'content-type':'application/json'}});
  }});
  const server = createServer({publicAccess:true,publicOrigin:'https://gfyh.fun',modelClient:client}); server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(() => server.close());
  assert.equal((await client.analyze('hello')).length, 1);
  assert.deepEqual(calls,['MiniMax-M3.1-Flash','MiniMax-M3.1-Flash','gpt-6-luna']);
});

test('public requires guarded client and globally rate limits even with spoofed headers', async t => {
  assert.throws(() => createServer({publicAccess:true, allowLocal:true, modelClient:{analyze:async () => []}}));
  const { quota } = await fixture(t, 10);
  const modelClient = createModelClient({provider:'minimax',apiKey:'x',quota,fetch:async () => reply()});
  const server = createServer({publicAccess:true,publicOrigin:'https://gfyh.fun',modelClient}); server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/memories/jobs`;
  assert.equal((await fetch(url,{method:'POST',headers:{origin:'https://gfyh.fun.evil.test','x-forwarded-host':'gfyh.fun','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{origin:'https://evil.test','x-forwarded-host':'gfyh.fun','content-type':'application/json'},body:'{}'})).status,403);
  const results = [];
  for (let i=0;i<7;i++) results.push((await fetch(url,{method:'POST',headers:{origin:'https://gfyh.fun','content-type':'application/json','x-forwarded-for':`1.1.1.${i}`},body:'{}'})).status);
  assert.deepEqual(results,[400,400,400,400,400,400,429]);
});
