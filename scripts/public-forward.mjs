import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), "..");
const runtime = join(root, ".runtime", `public-forward-${hostname()}`);
const lockFile = join(runtime, "supervisor.pid");
const stateFile = join(runtime, "state.json");
const logFile = join(runtime, "service.log");
const url = "https://gfyh.fun/pottery/";
const previewPort = 5187;
mkdirSync(runtime, { recursive: true, mode: 0o700 });

function isSupervisor(pid) {
  try {
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    return args.includes(script) && args.includes("supervise");
  } catch {
    return false;
  }
}

function currentPid() {
  try {
    const pid = Number(readFileSync(lockFile, "utf8").trim());
    return Number.isSafeInteger(pid) && pid > 1 && isSupervisor(pid)
      ? pid
      : null;
  } catch {
    return null;
  }
}

function status() {
  const pid = currentPid();
  if (!pid) {
    console.log(`Stopped on ${hostname()}. Log: ${logFile}`);
    return false;
  }
  let state;
  try {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {}
  console.log(
    state?.pid === pid
      ? JSON.stringify(state, null, 2)
      : `Starting (PID ${pid})`,
  );
  console.log(`URL: ${url}\nLog: ${logFile}`);
  return true;
}

async function supervise() {
  let lock;
  try {
    lock = openSync(lockFile, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (currentPid() || Date.now() - statSync(lockFile).mtimeMs < 5000) return;
    unlinkSync(lockFile);
    lock = openSync(lockFile, "wx", 0o600);
  }
  writeFileSync(lock, `${process.pid}\n`);
  closeSync(lock);

  const state = {
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    children: {},
  };
  const children = new Map();
  const timers = new Set();
  let stopping = false;
  function persist() {
    writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(`${stateFile}.tmp`, stateFile);
  }
  function log(message) {
    console.log(`${new Date().toISOString()} ${message}`);
  }
  function launch(name, command, args) {
    if (stopping) return;
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    children.set(name, child);
    state.children[name] = {
      pid: child.pid,
      starts: (state.children[name]?.starts || 0) + 1,
      startedAt: new Date().toISOString(),
    };
    persist();
    log(`${name} started (PID ${child.pid})`);
    child.on("error", (error) => log(`${name}: ${error.message}`));
    child.on("close", (code, signal) => {
      children.delete(name);
      state.children[name].pid = null;
      state.children[name].lastExit = { code, signal };
      persist();
      log(`${name} exited (code ${code}, signal ${signal})`);
      if (!stopping) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          launch(name, command, args);
        }, 3000);
        timers.add(timer);
      }
    });
  }
  async function stop() {
    if (stopping) return;
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
    for (const child of children.values()) child.kill("SIGTERM");
    for (let i = 0; i < 30 && children.size; i++) await delay(100);
    for (const child of children.values()) child.kill("SIGKILL");
    for (let i = 0; i < 20 && children.size; i++) await delay(100);
    unlinkSync(lockFile);
    log("Supervisor stopped");
    process.exit(0);
  }
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  persist();
  launch("preview", process.execPath, [
    join(root, "node_modules/vite/bin/vite.js"),
    "preview",
    "--base=/pottery/",
    "--outDir=dist-public",
    "--host=127.0.0.1",
    `--port=${previewPort}`,
    "--strictPort",
  ]);
  launch("tunnel", "ssh", [
    "-N", "-T",
    "-i", join(homedir(), ".ssh/id_ed25519_hpc_peers"),
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ConnectionAttempts=1",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-R", `127.0.0.1:15173:127.0.0.1:${previewPort}`,
    "lizd@gfyh.fun",
  ]);
}

const action = process.argv[2] || "status";
if (action === "supervise") {
  await supervise();
} else if (action === "start") {
  if (!existsSync(join(root, "dist-public/index.html"))) {
    throw new Error("Run npm run build:public before starting the service.");
  }
  if (!currentPid()) {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(previewPort, "127.0.0.1", () => probe.close(resolve));
    });
    const log = openSync(logFile, "a", 0o600);
    const child = spawn(process.execPath, [script, "supervise"], {
      cwd: root,
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    closeSync(log);
    for (let i = 0; i < 50 && !currentPid(); i++) await delay(100);
  }
  const expected = readFileSync(join(root, "dist-public/index.html"), "utf8");
  let ready = false;
  for (let i = 0; i < 50 && !ready; i++) {
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      const preview = state.children.preview;
      const tunnel = state.children.tunnel;
      if (
        state.pid === currentPid() &&
        preview?.pid && tunnel?.pid &&
        existsSync(`/proc/${preview.pid}`) &&
        existsSync(`/proc/${tunnel.pid}`) &&
        Date.now() - Date.parse(tunnel.startedAt) >= 1000
      ) {
        const response = await fetch(`http://127.0.0.1:${previewPort}/pottery/`, {
          signal: AbortSignal.timeout(1000),
        });
        ready = response.ok && (await response.text()) === expected;
      }
    } catch {}
    if (!ready) await delay(200);
  }
  status();
  if (!ready) throw new Error(`Service did not become ready. Inspect ${logFile}`);
} else if (action === "stop") {
  const pid = currentPid();
  if (pid) {
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 80 && isSupervisor(pid); i++) await delay(100);
    if (isSupervisor(pid)) throw new Error(`Supervisor ${pid} did not stop.`);
  }
  status();
} else if (action === "status") {
  if (!status()) process.exitCode = 1;
} else {
  throw new Error("Usage: node scripts/public-forward.mjs start|stop|status");
}
