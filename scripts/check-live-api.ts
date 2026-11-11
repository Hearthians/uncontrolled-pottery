// Local diagnostic: synthetic text only. Never logs credentials or submitted text.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveCredential } from './eval-memories-provider.ts';
import { createModelClient } from '../server/model.ts';
import { createServer } from '../server/index.ts';

const config = JSON.parse(await readFile(join(homedir(), '.config/opencode/opencode.json'), 'utf8'));
const apiKey = await resolveCredential(config.provider['gfyh-minimax'].options.apiKey);
const server = createServer({ allowLocal: true, modelClient: createModelClient({ provider: 'minimax', apiKey }) });
server.listen(0, '127.0.0.1', async () => {
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server unavailable');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}/api/memories/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: { kind: 'text', text: 'I felt calm sitting in the garden.' } }) });
    const handle = await response.json() as { id: string; token: string };
    let status = '';
    for (let i = 0; i < 120; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = await (await fetch(`${base}/api/memories/jobs/${handle.id}`, { headers: { 'x-memory-job-token': handle.token } })).json() as { status: string; entries?: unknown[] };
      status = result.status;
      if (status === 'completed') { console.log(`MiniMax HTTP job completed: ${result.entries?.length ?? 0} entries`); return; }
      if (status === 'failed' || status === 'cancelled') break;
    }
    console.error(`MiniMax HTTP job did not complete: ${status}`);
    process.exitCode = 1;
  } catch {
    console.error('MiniMax HTTP job diagnostic failed');
    process.exitCode = 1;
  } finally { server.close(); }
});
