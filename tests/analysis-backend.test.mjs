import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { once } from 'node:events';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateRanges, validateEntry, parseMemoryInput } from '../shared/memoryAnalysis.ts';
import { splitText, analyzeText } from '../server/analysis.ts';
import { extractInput } from '../server/extraction.ts';
import { extractInWorker } from '../server/worker-extraction.ts';
import { createServer } from '../server/index.ts';

const scores = { calm: 0, anxiety: 1, anger: 2, stress: 3, sadness: 5 };
const mock = { async analyze(text) { return [{ start: 0, end: text.length, scores }]; } };
const file = (name, text) => ({ kind: 'file', name, dataBase64: Buffer.from(text).toString('base64') });
function crc32(data) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, value] of entries) {
    const n = Buffer.from(name), data = Buffer.from(value), compressed = deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, compressed); centrals.push(central, n); offset += local.length + n.length + compressed.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('strict range coverage and UTF-16 offsets', async () => {
  const text = '  first 😀\n second  ';
  const ranges = [{ start: 2, end: 10, scores }, { start: 12, end: 18, scores }];
  assert.deepEqual(validateRanges(ranges, text), ranges);
  assert.throws(() => validateRanges([{ start: 2, end: 9, scores }], text));
  assert.throws(() => validateRanges([{ start: 2, end: text.length, scores: { ...scores, calm: 6 } }], text));
  assert.throws(() => validateRanges([{ start: 2, end: 10, scores }, { start: 9, end: 18, scores }], text));
  const source = `${'a'.repeat(5999)}😀${'b'.repeat(7000)}`;
  const blocks = splitText(source); assert.equal(blocks.join(''), source); assert.ok(blocks.every(b => b.length <= 6000));
  const entries = await analyzeText(source, mock);
  for (const entry of entries) { assert.ok(validateEntry(entry)); assert.equal(entry.text, blocks[entry.source.block].substring(entry.source.start, entry.source.end)); }
  assert.throws(() => parseMemoryInput({ input: { kind: 'text', text: 'x', extra: 1 } }));
});

test('entry count limit rejects excessive segmentation', async () => {
  const text = 'x'.repeat(2001);
  const perCharacter = { async analyze(block) { return Array.from(block, (_, start) => ({ start, end: start + 1, scores })); } };
  await assert.rejects(analyzeText(text, perCharacter), /Too many memory entries/);
});

test('text, JSON, CSV preserve duplicate data in order', async () => {
  assert.equal(await extractInput(file('x.txt', '你好\n你好')), '你好\n你好');
  assert.equal(await extractInput(file('x.JSON', '["a","a","b"]')), 'a\n\na\n\nb');
  assert.equal(await extractInput(file('x.csv', 'a,"b,c"\na,"b,c"')), 'a\n\nb,c\n\na\n\nb,c');
  assert.equal(await extractInput(file('x.json', '{"2":"two","1":"one","nested":[{"x":"repeat","x":"repeat"},false,null,42,"last"]}')), 'two\n\none\n\nrepeat\n\nrepeat\n\nlast');
  await assert.rejects(extractInput(file('x.json', '{"text":true}')), /No extractable text/);
  await assert.rejects(extractInput(file('../x.txt', 'x')), /filename/);
  await assert.rejects(extractInput({ kind:'file', name:'x.txt', dataBase64:'x!' }), /file/);
  await assert.rejects(extractInput({ kind:'text', text:'x'.repeat(2000001) }), /large/);
});

test('DOCX extraction screens ZIP traversal and decompression limits', async () => {
  const doc = zip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>']
  ]);
  assert.match(await extractInput(file('x.docx', doc)), /hello/);
  await assert.rejects(extractInput(file('x.docx', zip([['../escape', 'oops']]))));
  await assert.rejects(extractInput(file('x.docx', zip([['word/document.xml', 'x'.repeat(16 * 1024 * 1024 + 1)]]))));
  await assert.rejects(extractInput(file('x.docx', 'not a zip')));
});

function pdf(text = 'hello') {
  const stream = text ? `BT /F1 12 Tf 10 50 Td (${text}) Tj ET` : '';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(out)); out += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(out); out += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n` + offsets.slice(1).map(x => `${String(x).padStart(10,'0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}
test('PDF text extraction and image-only/invalid rejection', async () => {
  assert.match(await extractInput(file('x.pdf', pdf('hello world'))), /hello world/);
  await assert.rejects(extractInput(file('x.pdf', pdf(''))), /No extractable text/);
  await assert.rejects(extractInput(file('x.pdf', 'not a pdf')), /PDF/);
});

async function serverFor(options) { const server = createServer(options); server.listen(0, '127.0.0.1'); await once(server, 'listening'); return { server, base: `http://127.0.0.1:${server.address().port}` }; }
const json = { 'content-type': 'application/json' };
async function request(base, route, options = {}) { const r = await fetch(base + route, options); return [r.status, await r.json()]; }
async function waitFor(base, id, headers, status) { for (let i = 0; i < 100; i++) { const [, job] = await request(base, `/api/memories/jobs/${id}`, { headers }); if (status.includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('job timed out'); }

test('extraction worker enforces timeout and cancellation', async () => {
  assert.equal(await extractInWorker({kind:'text',text:'hello'}), 'hello');
  await assert.rejects(extractInWorker({kind:'text',text:'  '}), /No extractable text/);
  // A deliberately non-terminating worker verifies preemption, not merely a race
  // against a Promise while parsing continues in the background.
  const endless = new URL('data:text/javascript,' + encodeURIComponent('while (true) {}'));
  await assert.rejects(extractInWorker({kind:'text',text:'x'}, {workerURL:endless, timeoutMs:50}), /timed out/);
  const controller = new AbortController();
  const result = extractInWorker({kind:'text',text:'x'}, {workerURL:endless, signal:controller.signal});
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(result, /cancelled/);
});

test('API access, capability, same-origin and progress', async t => {
  const { server, base } = await serverFor({ modelClient: mock, accessCode: 'secret' }); t.after(() => server.close());
  const payload = JSON.stringify({ input: { kind: 'text', text: 'hello 😀' } });
  assert.equal((await request(base, '/api/memories/jobs', { method:'POST', headers:json, body:payload }))[0], 403);
  assert.equal((await request(base, '/api/memories/jobs', { method:'POST', headers:{ ...json, 'x-memory-access-code':'secret', origin:'https://evil.example' }, body:payload }))[0], 403);
  const [status, created] = await request(base, '/pottery/api/memories/jobs', { method:'POST', headers:{ ...json, 'x-memory-access-code':'secret' }, body:payload }); assert.equal(status, 202);
  assert.equal((await request(base, `/api/memories/jobs/${created.id}`, { headers: { 'x-memory-access-code':'secret', 'x-memory-job-token':'bad' } }))[0], 404);
  const headers = { 'x-memory-access-code':'secret', 'x-memory-job-token':created.token };
  const job = await waitFor(base, created.id, headers, ['completed', 'failed']); assert.equal(job.status, 'completed'); assert.deepEqual(job.progress, { completed:1, total:1 }); assert.equal(job.entries[0].text, 'hello 😀');
});

test('static files stay inside the public directory and job TTL is bounded', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'memory-static-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  const publicDir = path.join(root, 'public'); await import('node:fs/promises').then(fs => fs.mkdir(publicDir));
  await writeFile(path.join(publicDir, 'index.html'), 'public'); await writeFile(path.join(root, 'secret.txt'), 'secret');
  await symlink(path.join(root, 'secret.txt'), path.join(publicDir, 'leak.txt'));
  let time = 0;
  const { server, base } = await serverFor({ modelClient:mock, allowLocal:true, staticDir:publicDir, now:() => time }); t.after(() => server.close());
  assert.equal(await (await fetch(base + '/pottery/')).text(), 'public');
  assert.equal((await fetch(base + '/leak.txt')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/secret.txt')).status, 404);
  const [, job] = await request(base, '/api/memories/jobs', {method:'POST',headers:json,body:JSON.stringify({input:{kind:'text',text:'hi'}})});
  await waitFor(base, job.id, {'x-memory-job-token':job.token}, ['completed', 'failed']);
  time = 300001;
  assert.equal((await request(base, `/api/memories/jobs/${job.id}`, {headers:{'x-memory-job-token':job.token}}))[0], 404);
});

test('active jobs survive five minutes and expire at their absolute deadline', async t => {
  let time = 0, started = 0, aborted = 0;
  const slow = { analyze(_text, {signal}) { started++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted++; reject(new Error('cancel')); }, {once:true})); } };
  const {server, base} = await serverFor({modelClient:slow,allowLocal:true,now:() => time}); t.after(() => server.close());
  const [, created] = await request(base, '/api/memories/jobs', {method:'POST',headers:json,body:JSON.stringify({input:{kind:'text',text:'one'}})});
  for (let i=0;i<100 && !started;i++) await new Promise(r => setTimeout(r,10));
  assert.equal(started,1);
  const headers = {'x-memory-job-token':created.token}; time = 300001;
  assert.equal((await request(base, `/api/memories/jobs/${created.id}`, {headers}))[1].status, 'analyzing');
  time = 2 * 60 * 60_000;
  const expired = (await request(base, `/api/memories/jobs/${created.id}`, {headers}))[1];
  assert.equal(expired.status,'failed'); assert.equal(expired.error,'Analysis timed out'); assert.equal(aborted,1);
});

test('jobs are bounded, cancellable, and disabled by default', async t => {
  const disabled = await serverFor({ modelClient: mock }); t.after(() => disabled.server.close());
  assert.equal((await request(disabled.base, '/api/memories/jobs', { method:'POST', headers:json, body:'{}' }))[0], 403);
  let running = 0, peak = 0;
  const slow = { analyze(_text, { signal }) { running++; peak = Math.max(peak, running); return new Promise((resolve, reject) => signal.addEventListener('abort', () => { running--; reject(new Error('cancel')); }, { once:true })); } };
  const { server, base } = await serverFor({ modelClient: slow, allowLocal:true }); t.after(() => server.close());
  const payload = JSON.stringify({ input: { kind:'text', text:'one' } }); const created = [];
  for (let i = 0; i < 3; i++) { const [s, job] = await request(base, '/api/memories/jobs', { method:'POST', headers:json, body:payload }); assert.equal(s, 202); created.push(job); }
  assert.equal((await request(base, '/api/memories/jobs', { method:'POST', headers:json, body:payload }))[0], 429);
  for (let i = 0; i < 100 && peak < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(peak, 2);
  for (const job of created) { const [s, result] = await request(base, `/api/memories/jobs/${job.id}`, { method:'DELETE', headers:{ 'x-memory-job-token':job.token } }); assert.equal(s, 200); assert.equal(result.status, 'cancelled'); }
});
