import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMemoryInput, type JobResponse } from '../shared/memoryAnalysis.ts';
import { MAX_FILE_BYTES } from './extraction.ts';
import { extractInWorker } from './worker-extraction.ts';
import { analyzeText } from './analysis.ts';
import { createFallbackModelClient, createModelClient, hasModelQuota, hasGatewayBudget, QuotaError, type ModelClient } from './model.ts';
import { openQuota } from './quota.ts';

const TTL = 5 * 60_000;
// Active work has a separate absolute deadline; completed jobs expire after TTL.
const ACTIVE_TTL = 2 * 60 * 60_000;
const MAX_JOBS = 30, MAX_PER_CLIENT = 3, MAX_CONCURRENT = 2;
const BODY_LIMIT = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 16_384;
type Job = { id: string; token: string; owner: string; created: number; updated: number; response: JobResponse; controller: AbortController; input?: ReturnType<typeof parseMemoryInput> };
export type AppOptions = { modelClient?: ModelClient; accessCode?: string; allowLocal?: boolean; publicAccess?: boolean; publicOrigin?: string; staticDir?: string; now?: () => number };
function equal(a: string, b: string): boolean { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function send(res: http.ServerResponse, status: number, body: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); }
function local(address: string): boolean { return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'; }
function sameOrigin(req: http.IncomingMessage, publicOrigin?: string): boolean {
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { const parsed = new URL(origin); return origin === parsed.origin && (publicOrigin ? origin === publicOrigin : (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === req.headers.host); } catch { return false; }
}
async function readBody(req: http.IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? '')) throw new Error('Expected JSON');
  const length = Number(req.headers['content-length'] ?? 0);
  if (!Number.isFinite(length) || length > BODY_LIMIT) throw new Error('Request too large');
  const chunks: Buffer[] = []; let size = 0;
  const timeout = setTimeout(() => req.destroy(), 30_000); timeout.unref();
  try {
    for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) throw new Error('Request too large'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid JSON'); }
  } finally { clearTimeout(timeout); }
}
export function createApp(options: AppOptions = {}) {
  if (options.publicAccess && (!options.modelClient || (!hasModelQuota(options.modelClient) && !hasGatewayBudget(options.modelClient)))) throw new Error('Public access requires a quota-protected model client or explicit gateway budget');
  if (options.publicOrigin) {
    let parsed: URL;
    try { parsed = new URL(options.publicOrigin); } catch { throw new Error('Invalid public origin'); }
    if (parsed.protocol !== 'https:' || parsed.origin !== options.publicOrigin || parsed.username || parsed.password) throw new Error('Invalid public origin');
  }
  const jobs = new Map<string, Job>();
  const now = options.now ?? Date.now;
  let active = 0;
  const pending = new Map<string, number>();
  let apiTokens = 120, apiTime = now();
  function admitApi(): boolean {
    const time = now(); apiTokens = Math.min(120, apiTokens + Math.max(0, time - apiTime) / 500); apiTime = Math.max(time, apiTime);
    if (apiTokens < 1) return false;
    apiTokens--; return true;
  }
  let admissionTokens = 6, admissionTime = now();
  function admit(): boolean {
    const time = now(); admissionTokens = Math.min(6, admissionTokens + Math.max(0, time - admissionTime) / 10_000); admissionTime = Math.max(time, admissionTime);
    if (admissionTokens < 1) return false;
    admissionTokens--; return true;
  }
  const code = options.accessCode ?? '';
  const staticDir = options.staticDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist-public');
  const cleanup = () => { for (const [id, job] of jobs) {
    const activeJob = ['queued', 'extracting', 'analyzing'].includes(job.response.status);
    if (activeJob && now() - job.created >= ACTIVE_TTL) {
      job.controller.abort(); job.input = undefined; job.response.status = 'failed'; job.response.error = 'Analysis timed out'; job.updated = now();
    } else if (!activeJob && now() - job.updated >= TTL) { job.controller.abort(); job.input = undefined; jobs.delete(id); }
  } };
  const timer = setInterval(cleanup, 30_000); timer.unref();
  function pump() {
    cleanup();
    for (const job of jobs.values()) {
      if (active >= MAX_CONCURRENT) break;
      if (job.response.status !== 'queued') continue;
      active++; job.response.status = 'extracting'; job.updated = now();
      void (async () => {
        try {
          const text = await extractInWorker(job.input!, { signal: job.controller.signal }); job.input = undefined;
          if (job.controller.signal.aborted) return;
          job.response.status = 'analyzing'; job.updated = now();
          const entries = await analyzeText(text, options.modelClient!, { signal: job.controller.signal, onProgress(completed, total) { job.response.progress = { completed, total }; job.updated = now(); } });
          if (!job.controller.signal.aborted) { job.response.entries = entries; job.response.status = 'completed'; job.updated = now(); }
        } catch (error) {
          if (!job.controller.signal.aborted) { job.response.status = 'failed'; job.response.error = error instanceof QuotaError ? 'Daily model quota exhausted or unavailable' : error instanceof Error && /^(Invalid|Unsupported|No extractable|Extracted text|File must|PDF |Unsafe DOCX|Too many)/.test(error.message) ? error.message : 'Analysis failed'; job.updated = now(); }
        } finally { job.input = undefined; active--; pump(); }
      })();
    }
  }
  const handler: http.RequestListener = (req, res) => { void (async () => {
    cleanup();
    let pathname: string;
    try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; } catch { return send(res, 400, { error: 'Invalid URL' }); }
    if (pathname === '/pottery/api' || pathname.startsWith('/pottery/api/')) pathname = pathname.slice('/pottery'.length);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (!sameOrigin(req, options.publicOrigin)) return send(res, 403, { error: 'Forbidden' });
      if (options.publicAccess && !admitApi()) return send(res, 429, { error: 'Request rate exceeded' });
      const address = req.socket.remoteAddress ?? '';
      if (!options.publicAccess && ((!code && !(options.allowLocal && local(address))) || (code && !equal(String(req.headers['x-memory-access-code'] ?? ''), code)))) return send(res, 403, { error: 'Access denied' });
      if (pathname === '/api/memories/jobs' && req.method === 'POST') {
        if (!options.modelClient) return send(res, 503, { error: 'Analysis is not configured' });
        if (options.publicAccess && !admit()) return send(res, 429, { error: 'Admission rate exceeded' });
        if (jobs.size >= MAX_JOBS || (!options.publicAccess && [...jobs.values()].filter(j => j.owner === address).length >= MAX_PER_CLIENT) || (options.publicAccess && [...jobs.values()].filter(j => j.response.status === 'queued' || j.response.status === 'extracting' || j.response.status === 'analyzing').length >= 6)) return send(res, 429, { error: 'Job limit reached' });
        const pendingTotal = [...pending.values()].reduce((a, b) => a + b, 0);
        if (pendingTotal >= (options.publicAccess ? 2 : MAX_JOBS) || (!options.publicAccess && (pending.get(address) ?? 0) >= MAX_PER_CLIENT)) return send(res, 429, { error: 'Job limit reached' });
        pending.set(address, (pending.get(address) ?? 0) + 1);
        let input: ReturnType<typeof parseMemoryInput>;
        try { input = parseMemoryInput(await readBody(req)); } catch { res.setHeader('Connection', 'close'); return send(res, 400, { error: 'Invalid or oversized request' }); }
        finally { const count = (pending.get(address) ?? 1) - 1; if (count) pending.set(address, count); else pending.delete(address); }
        // Recheck after asynchronous request reading to prevent simultaneous admission races.
        if (jobs.size >= MAX_JOBS || (!options.publicAccess && [...jobs.values()].filter(j => j.owner === address).length >= MAX_PER_CLIENT) || (options.publicAccess && [...jobs.values()].filter(j => j.response.status === 'queued' || j.response.status === 'extracting' || j.response.status === 'analyzing').length >= 6)) return send(res, 429, { error: 'Job limit reached' });
        const id = randomBytes(18).toString('base64url'), token = randomBytes(32).toString('base64url');
        const job: Job = { id, token, owner: address, input, controller: new AbortController(), created: now(), updated: now(), response: { id, status: 'queued', progress: { completed: 0, total: 0 } } };
        jobs.set(id, job); send(res, 202, { id, token }); pump(); return;
      }
      const match = /^\/api\/memories\/jobs\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (match && (req.method === 'GET' || req.method === 'DELETE')) {
        const job = jobs.get(match[1]);
        if (!job || !equal(String(req.headers['x-memory-job-token'] ?? ''), job.token)) return send(res, 404, { error: 'Job not found' });
        if (req.method === 'DELETE') { job.controller.abort(); job.input = undefined; job.response.status = 'cancelled'; delete job.response.entries; delete job.response.error; job.updated = now(); }
        return send(res, 200, job.response);
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 404, { error: 'Not found' });
    let relative: string;
    try { relative = decodeURIComponent(pathname); } catch { return send(res, 400, { error: 'Invalid path' }); }
    if (relative.includes('\\') || relative.includes('\0') || relative.split('/').some(p => p === '..' || p === '.')) return send(res, 404, { error: 'Not found' });
    if (relative === '/pottery' || relative === '/pottery/') relative = '/index.html';
    else if (relative.startsWith('/pottery/')) relative = relative.slice('/pottery'.length);
    else if (relative === '/') relative = '/index.html';
    try {
      const root = await realpath(staticDir), file = await realpath(path.join(root, relative));
      if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) return send(res, 404, { error: 'Not found' });
      const contents = await readFile(file);
      const type: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
      res.writeHead(200, { 'Content-Type': type[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : contents);
    } catch { send(res, 404, { error: 'Not found' }); }
  })().catch(() => { if (!res.headersSent) send(res, 500, { error: 'Internal error' }); else res.destroy(); }); };
  return { handler, close() { clearInterval(timer); for (const job of jobs.values()) job.controller.abort(); jobs.clear(); } };
}
export function createServer(options: AppOptions = {}) { const app = createApp(options); const server = http.createServer(app.handler); server.headersTimeout = 15_000; server.requestTimeout = 35_000; server.maxConnections = 100; server.on('close', app.close); return server; }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const provider = process.env.MEMORY_ANALYSIS_PROVIDER;
  const apiKey = process.env.MEMORY_ANALYSIS_API_KEY;
  const publicAccess = process.env.MEMORY_ANALYSIS_PUBLIC === '1';
  const fallbackKey = process.env.MEMORY_ANALYSIS_FALLBACK_API_KEY;
  const budgetMode = process.env.MEMORY_ANALYSIS_BUDGET_MODE;
  if (publicAccess && (provider !== 'minimax' || !apiKey || !['disk', 'gateway'].includes(budgetMode ?? ''))) throw new Error('Public mode requires MiniMax and an explicit budget mode');
  if (publicAccess && budgetMode === 'gateway' && (process.env.MEMORY_ANALYSIS_QUOTA_DIR || process.env.MEMORY_ANALYSIS_DAILY_LIMIT)) throw new Error('Conflicting budget configuration');
  if (publicAccess && budgetMode === 'disk' && (!process.env.MEMORY_ANALYSIS_QUOTA_DIR || !process.env.MEMORY_ANALYSIS_DAILY_LIMIT)) throw new Error('Disk budget requires quota configuration');
  if (fallbackKey && (!publicAccess || provider !== 'minimax')) throw new Error('Fallback requires public MiniMax mode');
  const quota = publicAccess && budgetMode === 'disk' ? await openQuota(process.env.MEMORY_ANALYSIS_QUOTA_DIR!, Number(process.env.MEMORY_ANALYSIS_DAILY_LIMIT)) : undefined;
  const gatewayBudget = publicAccess && budgetMode === 'gateway';
  const modelClient = (provider === 'gpt' || provider === 'minimax') && apiKey ? (fallbackKey ? createFallbackModelClient({ provider, apiKey, quota, gatewayBudget, fallbackApiKey: fallbackKey, onStatus: status => console.info(`Model provider status: ${status}`) }) : createModelClient({ provider, apiKey, quota, gatewayBudget })) : undefined;
  const server = createServer({ modelClient, publicAccess, publicOrigin: process.env.MEMORY_ANALYSIS_PUBLIC_ORIGIN, accessCode: process.env.MEMORY_ANALYSIS_ACCESS_CODE, allowLocal: !publicAccess && process.env.MEMORY_ANALYSIS_ALLOW_LOCAL === '1' });
  server.on('close', () => { void quota?.close(); });
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  server.listen(port, '127.0.0.1', () => console.log(`Memory server listening on 127.0.0.1:${port}`));
}
