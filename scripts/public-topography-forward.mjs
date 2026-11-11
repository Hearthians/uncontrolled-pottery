import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';

const root = resolve(import.meta.dirname, '..');
const script = join(root, 'scripts/public-topography-forward.mjs');
const runtime = join(root, '.runtime/public-memory-topography');
const pidFile = join(runtime, 'supervisor.pid');
const logFile = join(runtime, 'service.log');
const port = 5196;
const base = '/pottery/memory-topography/';
const localUrl = `http://127.0.0.1:${port}${base}`;
const publicUrl = `https://gfyh.fun${base}`;
function currentPid() {
  try {
    const pid = Number(readFileSync(pidFile, 'utf8'));
    const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    return args.includes(script) && args.includes('supervise') ? pid : null;
  } catch { return null; }
}
function status() { console.log(JSON.stringify({ pid: currentPid(), localUrl, publicUrl, logFile }, null, 2)); }
const action = process.argv[2] ?? 'status';
if (action === 'supervise') {
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  if (currentPid()) process.exit(0);
  if (existsSync(pidFile)) unlinkSync(pidFile);
  const lock = openSync(pidFile, 'wx', 0o600);
  writeFileSync(lock, String(process.pid)); closeSync(lock);
  const children = new Map(), timers = new Set();
  let stopping = false;
  function launch(name, command, args) {
    if (stopping) return;
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    children.set(name, child);
    console.log(`${new Date().toISOString()} ${name} started PID ${child.pid}`);
    child.on('error', error => console.error(`${name}: ${error.message}`));
    child.on('close', (code, signal) => {
      children.delete(name);
      console.log(`${new Date().toISOString()} ${name} exited ${code ?? signal}`);
      if (!stopping) {
        const timer = setTimeout(() => { timers.delete(timer); launch(name, command, args); }, 3000);
        timers.add(timer);
      }
    });
  }
  function stop() {
    if (stopping) return;
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
    for (const child of children.values()) child.kill('SIGTERM');
    if (currentPid() === process.pid) unlinkSync(pidFile);
  }
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  launch('preview', process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview',
    `--base=${base}`, '--outDir=.runtime/public-memory-topography/site', '--host=127.0.0.1', `--port=${port}`, '--strictPort']);
  launch('tunnel', 'ssh', ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    '-R', `127.0.0.1:15176:127.0.0.1:${port}`, 'lizd@gfyh.fun']);
} else if (action === 'start') {
  if (!existsSync(join(runtime, 'site/index.html'))) throw new Error('Build the English topography preview first');
  if (!currentPid()) {
    await new Promise((resolve, reject) => {
      const probe = createServer(); probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    const log = openSync(logFile, 'a', 0o600);
    const child = spawn(process.execPath, [script, 'supervise'], { cwd: root, detached: true, stdio: ['ignore', log, log] });
    child.unref(); closeSync(log);
  }
  const expected = readFileSync(join(runtime, 'site/index.html'), 'utf8');
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(localUrl, { signal: AbortSignal.timeout(1000) });
      if (currentPid() && response.ok && await response.text() === expected) { ready = true; break; }
    } catch {}
    await delay(200);
  }
  status();
  if (!ready) throw new Error('Preview did not become ready; inspect the service log');
} else if (action === 'stop') {
  const pid = currentPid();
  if (pid) process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 30 && currentPid(); i++) await delay(100);
  status();
} else if (action === 'status') status();
else throw new Error('Usage: public-topography-forward.mjs start|status|stop');
