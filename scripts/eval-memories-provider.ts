// Runtime-only config: never log, copy or serialize credentials.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createModelClient, ModelAnalysisError } from '../server/model.ts';
import { MODELS, type ChunkCall } from './eval-memories.ts';

export type Provider = keyof typeof MODELS;
export class EvalFailure extends Error {
  readonly category: 'transient' | 'schema' | 'unsupported' | 'authorization' | 'protocol';
  constructor(category: 'transient' | 'schema' | 'unsupported' | 'authorization' | 'protocol') { super(category); this.category = category; }
}
export async function resolveCredential(value: string, read: (path: string, encoding: 'utf8') => Promise<string> = readFile): Promise<string> {
  const file = /^\{file:([^{}]+)\}$/.exec(value);
  if (!file) {
    if (!value || /[\r\n]/.test(value) || value.startsWith('{')) throw new EvalFailure('authorization');
    return value;
  }
  if (!file[1].startsWith('/')) throw new EvalFailure('authorization');
  try {
    const secret = (await read(file[1], 'utf8')).trim();
    if (!secret || /[\r\n]/.test(secret)) throw new Error();
    return secret;
  } catch { throw new EvalFailure('authorization'); }
}
async function config(provider: Provider): Promise<{ apiKey: string; baseURL: string }> {
  try {
    if (provider === 'gpt') {
      const [raw, authRaw] = await Promise.all([readFile(join(homedir(), '.codex/config.toml'), 'utf8'), readFile(join(homedir(), '.codex/auth.json'), 'utf8')]);
      if (!/^\s*base_url\s*=\s*["']https:\/\/api\.gfyh\.fun\/v1\/?["']\s*$/m.test(raw) || !/^\s*wire_api\s*=\s*["']responses["']\s*$/m.test(raw)) throw Error();
      const auth = JSON.parse(authRaw);
      if (typeof auth.OPENAI_API_KEY !== 'string' || !auth.OPENAI_API_KEY) throw Error();
      return { apiKey: auth.OPENAI_API_KEY, baseURL: 'https://api.gfyh.fun/v1' };
    }
    const obj = JSON.parse(await readFile(join(homedir(), '.config/opencode/opencode.json'), 'utf8'));
    const options = obj?.provider?.['gfyh-minimax']?.options;
    if (typeof options?.apiKey !== 'string' || !options.apiKey || typeof options?.baseURL !== 'string') throw Error();
    const endpoint = new URL(options.baseURL);
    if (endpoint.origin !== 'https://api.gfyh.fun' || endpoint.pathname.replace(/\/$/, '') !== '/v1' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw Error();
    return { apiKey: await resolveCredential(options.apiKey), baseURL: 'https://api.gfyh.fun/v1' };
  } catch { throw new EvalFailure('authorization'); }
}
export async function createEvalProvider(provider: Provider): Promise<ChunkCall> {
  const options = await config(provider);
  const client = createModelClient({ provider, model: MODELS[provider], ...options });
  return async (items, signal) => {
    try {
      const response = await client.analyzeMemories(items.map(x => ({ id: String(x.index), text: x.text })), { signal });
      return { results: response.entries.map(x => ({ index: Number(x.id), scores: x.scores })), model: response.model, usage: response.usage, finishStatus: response.finishStatus };
    } catch (error) {
      if (error instanceof ModelAnalysisError) {
        const category = error.kind === 'auth' ? 'authorization' : error.kind === 'refusal' || error.kind === 'incomplete' ? 'protocol' : error.kind;
        throw new EvalFailure(category);
      }
      throw new EvalFailure('protocol');
    }
  };
}
