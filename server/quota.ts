import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export type RequestQuota = { reserve(): Promise<void>; close(): Promise<void> };

// The worker itself holds the flock and performs all state operations. If it
// dies, it cannot write after another process acquires the lock. This assumes a
// private local filesystem with working flock, rename and fsync semantics;
// GPFS deployment requires administrator confirmation and cross-node testing.
export async function openQuota(directory: string, limit: number, now: () => number = Date.now): Promise<RequestQuota> {
  if (!path.isAbsolute(directory) || !Number.isSafeInteger(limit) || limit < 1 || limit > 3000) throw new Error('Invalid quota configuration');
  let created = false;
  try { await mkdir(directory, { mode: 0o700 }); created = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const s = await dir.stat();
    if (!s.isDirectory() || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) throw new Error('Quota directory must be private');
    const lock = await open(path.join(directory, 'lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    try { const s = await lock.stat(); if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) throw new Error('Invalid quota lock'); } finally { await lock.close(); }
  } finally { await dir.close(); }
  const child = spawn('flock', ['-n', '-F', path.join(directory, 'lock'), process.execPath, '--experimental-strip-types', fileURLToPath(import.meta.url), '--quota-worker', directory, String(limit), created ? '1' : '0', String(now())], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let ready = false, closed = false, nextId = 0;
  const pending = new Map<number, { resolve(): void; reject(error: Error): void }>();
  let startupResolve: () => void, startupReject: (error: Error) => void;
  const startup = new Promise<void>((resolve, reject) => { startupResolve = resolve; startupReject = reject; });
  const fail = () => {
    const error = new Error('Quota unavailable');
    if (!ready) startupReject(error);
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  };
  child.on('error', fail); child.on('exit', fail); child.on('disconnect', fail);
  child.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const m = message as { type?: string; id?: number; ok?: boolean; exhausted?: boolean };
    if (m.type === 'ready') { ready = true; startupResolve(); return; }
    if (m.type !== 'result' || typeof m.id !== 'number') return;
    const item = pending.get(m.id); if (!item) return; pending.delete(m.id);
    if (m.ok) item.resolve(); else item.reject(new Error(m.exhausted ? 'Daily quota exhausted' : 'Quota unavailable'));
  });
  try { await startup; } catch (error) { child.kill(); throw error; }
  return {
    reserve() {
      if (closed || !child.connected) return Promise.reject(new Error('Quota unavailable'));
      const id = ++nextId;
      return new Promise<void>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.send({ type: 'reserve', id, time: now() }, error => { if (error) { const item = pending.get(id); pending.delete(id); item?.reject(new Error('Quota unavailable')); } });
      });
    },
    async close() {
      if (closed) return; closed = true;
      if (child.connected) child.disconnect();
      await new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', () => resolve()); });
    }
  };
}

async function quotaWorker(directory: string, limit: number, created: boolean, initialTime: number) {
  const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const statePath = path.join(directory, 'state.json');
  async function save(day: string, count: number) {
    const tmp = path.join(directory, `.state-${randomBytes(16).toString('hex')}`);
    let file;
    try {
      file = await open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await file.writeFile(JSON.stringify({ day, count })); await file.sync(); await file.close(); file = undefined;
      await rename(tmp, statePath); await dir.sync();
    } finally { if (file) await file.close(); await unlink(tmp).catch(() => {}); }
  }
  async function load() {
    const handle = await open(statePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const s = await handle.stat();
      if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o077) || s.size > 256 || (process.getuid && s.uid !== process.getuid())) throw new Error('Invalid quota state');
      const value: unknown = JSON.parse(await handle.readFile('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'count,day') throw new Error('Invalid quota state');
      const { day, count } = value as { day: unknown; count: unknown };
      if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 3000) throw new Error('Invalid quota state');
      return { day, count: count as number };
    } finally { await handle.close(); }
  }
  // A new directory may be left uninitialized by a crash; existing directories
  // are never reset automatically, even when their state is missing.
  if (created) await save(new Date(initialTime).toISOString().slice(0, 10), 0);
  await load();
  process.send?.({ type: 'ready' });
  let failed = false, sequence = Promise.resolve();
  process.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const m = message as { type?: string; id?: number; time?: number };
    if (m.type !== 'reserve' || !Number.isSafeInteger(m.id)) return;
    sequence = sequence.then(async () => {
      let exhausted = false;
      try {
        if (failed || typeof m.time !== 'number' || !Number.isFinite(m.time)) throw new Error('Quota unavailable');
        const day = new Date(m.time).toISOString().slice(0, 10), state = await load();
        if (day < state.day) throw new Error('Quota clock moved backwards');
        const count = day === state.day ? state.count : 0;
        if (count >= limit) { exhausted = true; throw new Error('Quota exhausted'); }
        await save(day, count + 1);
        process.send?.({ type: 'result', id: m.id, ok: true });
      } catch { if (!exhausted) failed = true; process.send?.({ type: 'result', id: m.id, ok: false, exhausted }); }
    });
  });
  process.on('disconnect', () => { void sequence.finally(async () => { await dir.close(); process.exit(0); }); });
}

if (process.argv[2] === '--quota-worker') {
  void quotaWorker(process.argv[3], Number(process.argv[4]), process.argv[5] === '1', Number(process.argv[6])).catch(() => process.exit(1));
}
