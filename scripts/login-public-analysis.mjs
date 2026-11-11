import { spawn } from 'node:child_process';
import { readFileSync, openSync, closeSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = join(homedir(), 'work/uncontrolled-pottery');
const service = join(root, '.runtime/public-analysis-service');
const pidFile = join(service, 'login-supervisor.pid');
const logFile = join(service, 'logs/login-service.log');
const node = join(homedir(), '.local/bin/node');
const action = process.argv[2];
function isOurs(pid) {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').includes(join(service, 'login-public-analysis.mjs')); } catch { return false; }
}
if (action === 'start') {
  if (existsSync(pidFile)) throw new Error('Supervisor PID file exists; inspect it before starting');
  const log = openSync(logFile, 'a', 0o600);
  const child = spawn(node, [join(service, 'login-public-analysis.mjs'), 'supervise'], { cwd: service, detached: true, stdio: ['ignore', log, log] });
  child.unref(); closeSync(log);
  console.log(`Starting supervisor PID ${child.pid}; log ${logFile}`);
} else if (action === 'supervise') {
  const fd = openSync(pidFile, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
  const env = { ...process.env, MEMORY_ANALYSIS_PROVIDER: 'minimax', MEMORY_ANALYSIS_PUBLIC: '1', MEMORY_ANALYSIS_PUBLIC_ORIGIN: 'https://gfyh.fun', MEMORY_ANALYSIS_BUDGET_MODE: 'gateway', PORT: '5188', MEMORY_ANALYSIS_API_KEY: readFileSync(join(root, '.runtime/public-analysis-secrets/minimax.key'), 'utf8').trim(), MEMORY_ANALYSIS_FALLBACK_API_KEY: readFileSync(join(root, '.runtime/public-analysis-secrets/gpt.key'), 'utf8').trim() };
  let stopping = false; const children = new Map(); const timers = new Set();
  function launch(name, command, args, childEnv = process.env) {
    if (stopping) return;
    const child = spawn(command, args, { cwd: service, env: childEnv, stdio: 'inherit' }); children.set(name, child);
    console.log(`${new Date().toISOString()} ${name} started PID ${child.pid}`);
    child.on('error', () => console.error(`${name} failed to start`));
    child.on('close', (code, signal) => { children.delete(name); console.log(`${new Date().toISOString()} ${name} exited code=${code} signal=${signal}`); if (!stopping) { const timer = setTimeout(() => { timers.delete(timer); launch(name, command, args, childEnv); }, 3000); timers.add(timer); } });
  }
  function stop() { if (stopping) return; stopping = true; for (const t of timers) clearTimeout(t); for (const c of children.values()) c.kill('SIGTERM'); try { unlinkSync(pidFile); } catch {} }
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  launch('analysis', node, ['--experimental-strip-types', join(service, 'server/index.ts')], env);
  launch('tunnel', 'ssh', ['-N', '-T', '-i', join(homedir(), '.ssh/id_ed25519_hpc_peers'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-R', '127.0.0.1:15174:127.0.0.1:5188', 'lizd@gfyh.fun']);
} else if (action === 'status') {
  const pid = Number(readFileSync(pidFile, 'utf8')); if (!isOurs(pid)) throw new Error('Supervisor is not running'); console.log(`Supervisor PID ${pid}; log ${logFile}`);
} else throw new Error('Usage: login-public-analysis.mjs start|status');
