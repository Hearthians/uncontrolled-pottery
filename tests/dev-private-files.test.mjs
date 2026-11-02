import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, resolveConfig, isFileServingAllowed } from 'vite';
import { devPrivateFiles } from '../scripts/dev-private-files.ts';
import { parseMemories } from '../src/memoryPlayback.ts';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pottery-public-memories-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['public', 'artifacts', '.runtime', '.tmuxhub']) await mkdir(join(root, path));
  await writeFile(join(root, 'public/memories.json'), '["Public fixture original"]');
  for (const path of ['artifacts/local-memories.json', '.runtime/secret', '.tmuxhub/secret', 'embeddings_lab_updated.zip'])
    await writeFile(join(root, path), 'PRIVATE_FIXTURE');
  return root;
}

test('curated public corpus is a text-only array of 1910 complete memories', async () => {
  const text = await readFile(new URL('../public/memories.json', import.meta.url), 'utf8');
  const raw = JSON.parse(text);
  assert.equal(raw.length, 1910);
  assert.ok(raw.every((entry) => typeof entry === 'string'));
  assert.equal(parseMemories(text).length, 1910);
});

test('dev permits the public asset through localhost aliases and proxy headers but denies private work files', async (t) => {
  const root = await fixture(t);
  const server = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent',
    plugins: [devPrivateFiles()], server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => server.close());
  await server.listen();
  const port = server.httpServer.address().port;
  const base = `http://127.0.0.1:${port}`;
  for (const headers of [{}, { host: `localhost:${port}`, 'x-forwarded-for': '192.0.2.1', 'x-forwarded-proto': 'https' }]) {
    const res = await fetch(`${base}/memories.json`, { headers });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), ['Public fixture original']);
  }
  for (const path of ['artifacts/local-memories.json', '.runtime/secret', '.tmuxhub/secret', 'embeddings_lab_updated.zip']) {
    for (const prefix of ['/', `/@fs/${root}/`]) for (const suffix of ['', '?raw', '?url', '?import']) {
      const res = await fetch(base + prefix + path + suffix);
      assert.equal(res.status, 403);
      assert.equal((await res.text()).includes('PRIVATE_FIXTURE'), false);
    }
    assert.equal((await fetch(base + '/' + encodeURIComponent(path))).status, 403);
  }
  for (const path of ['.env', '.git/private', 'key.pem', 'artifacts/local-memories.json'])
    assert.equal(isFileServingAllowed(server.config, join(root, path)), false);
  const old = await fetch(`${base}/_local/memories`);
  assert.equal((await old.text()).includes('PRIVATE_FIXTURE'), false);
});

test('private file guard does not enforce local host access or change preview/build behavior', async (t) => {
  const root = await fixture(t);
  const options = { root, configFile: false, logLevel: 'silent', plugins: [devPrivateFiles()],
    server: { host: '0.0.0.0', fs: { deny: ['**/custom-secret/**'] } } };
  const config = await resolveConfig(options, 'serve');
  assert.equal(isFileServingAllowed(config, join(root, 'custom-secret/value')), false);
  assert.equal(isFileServingAllowed(config, join(root, 'artifacts/value')), false);
  const plugin = devPrivateFiles();
  assert.equal(plugin.apply({}, { command: 'build' }), false);
  assert.equal(plugin.apply({}, { command: 'serve', isPreview: true }), false);
});
