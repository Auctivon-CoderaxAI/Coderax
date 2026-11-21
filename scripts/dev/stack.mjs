/**
 * One command for the whole local stack.
 *
 *   npm run dev:up     start Mongo, the API, the local model and the UI; wait until each answers
 *   npm run dev:down   stop what `dev:up` started
 *
 * Each service runs in its own process group, writes to .dev/logs/<name>.log and
 * records its PID in .dev/pids/<name>.pid. `dev:down` signals the whole group, so
 * shutdown can reach children even when the group leader has exited.
 *
 * Override: CODERAX_PREVIEW_HOST or VITE_ALLOWED_HOSTS, the hostname the preview
 * is served from.
 *
 * The model is optional: until `npm run dev:model -- --install` has downloaded
 * it, the stack still comes up and the UI reports no available model.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { binPath, ggufPath, port as modelPort, serverArgs } from './model-paths.mjs';
import { mongoPort } from './mongo-port.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const devDir = path.join(repoRoot, '.dev');
const pidDir = path.join(devDir, 'pids');
const logDir = path.join(devDir, 'logs');

const nodeBin = process.execPath;
const previewHost = (
  process.env.CODERAX_PREVIEW_HOST ??
  process.env.VITE_ALLOWED_HOSTS ??
  ''
).trim();

const services = [
  {
    name: 'mongo',
    get port() {
      return mongoPort();
    },
    timeoutMs: 30_000,
    command: () => ({ file: nodeBin, args: [path.join(repoRoot, 'scripts/dev/mongo.mjs')] }),
  },
  {
    name: 'api',
    port: 3080,
    timeoutMs: 90_000,
    probe: () => httpOk('http://127.0.0.1:3080/api/config'),
    env: { NODE_ENV: 'development', VERCEL: '1', CODERAX_LOCAL_DEV: '1' },
    command: () => ({
      file: nodeBin,
      args: [path.join(repoRoot, 'node_modules/nodemon/bin/nodemon.js'), 'api/server/index.js'],
    }),
  },
  {
    name: 'model',
    port: modelPort,
    timeoutMs: 180_000,
    probe: () => httpOk(`http://127.0.0.1:${modelPort}/v1/models`),
    available: () => fs.existsSync(binPath) && fs.existsSync(ggufPath),
    skipped: 'no local model installed; run `npm run dev:model -- --install` once',
    command: () => ({ file: binPath, args: serverArgs }),
  },
  {
    name: 'ui',
    port: 3000,
    timeoutMs: 90_000,
    probe: () => httpOk('http://127.0.0.1:3000/'),
    env: {
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: '3000',
      VITE_ALLOWED_HOSTS: previewHost,
    },
    command: () => ({
      file: nodeBin,
      args: [path.join(repoRoot, 'node_modules/vite/bin/vite.js')],
      cwd: path.join(repoRoot, 'client'),
    }),
  },
];

function log(message) {
  console.log(`[dev] ${message}`);
}

function fail(message) {
  console.error(`[dev] ${message}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pidFile = (name) => path.join(pidDir, `${name}.pid`);

function readPid(name) {
  try {
    const pid = Number(fs.readFileSync(pidFile(name), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false;
    }
    if (error.code === 'EPERM') {
      return true;
    }
    throw error;
  }
}

function clearPid(name) {
  fs.rmSync(pidFile(name), { force: true });
}

async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1_000, () => done(false));
  });
}

async function httpOk(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function tail(file, lines = 15) {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(no log yet)';
  }
}

function startService(service) {
  const spec = service.command();
  const logPath = path.join(logDir, `${service.name}.log`);
  const fd = fs.openSync(logPath, 'w');
  const child = spawn(spec.file, spec.args, {
    cwd: spec.cwd ?? repoRoot,
    env: { ...process.env, ...service.env },
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  fs.closeSync(fd);
  fs.writeFileSync(pidFile(service.name), String(child.pid));
  return child.pid;
}

async function waitReady(service, pid) {
  const deadline = Date.now() + service.timeoutMs;
  while (Date.now() < deadline) {
    if (service.probe ? await service.probe() : await portOpen(service.port)) {
      return true;
    }
    if (pid != null && !alive(pid)) {
      return false;
    }
    await sleep(500);
  }
  return false;
}

async function up() {
  fs.mkdirSync(pidDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  if (!previewHost) {
    log(
      'VITE_ALLOWED_HOSTS is empty — set CODERAX_PREVIEW_HOST to the preview hostname or the panel will 403',
    );
  }

  for (const service of services) {
    const recorded = readPid(service.name);
    if (recorded != null && groupAlive(recorded)) {
      if (!alive(recorded)) {
        fail(`${service.name}: process group ${recorded} has no leader; run npm run dev:down`);
      }
      log(`${service.name} already running (pid ${recorded})`);
      if (!(await waitReady(service, recorded))) {
        fail(
          `${service.name} (pid ${recorded}) is running but never became ready; see .dev/logs/${service.name}.log`,
        );
      }
      continue;
    }
    clearPid(service.name);

    if (service.available && !service.available()) {
      log(`skipping ${service.name}: ${service.skipped}`);
      continue;
    }

    if (await portOpen(service.port)) {
      fail(
        `port ${service.port} is already in use by a process dev:up did not start; stop it, then retry`,
      );
    }

    const pid = startService(service);
    log(`starting ${service.name} (pid ${pid})`);
    if (!(await waitReady(service, pid))) {
      console.error(
        `\n--- .dev/logs/${service.name}.log ---\n${tail(path.join(logDir, `${service.name}.log`))}\n`,
      );
      fail(`${service.name} did not become ready within ${service.timeoutMs / 1000}s`);
    }
    log(`${service.name} ready on port ${service.port}`);
  }
  log('stack is up');
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

async function waitExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupAlive(pid)) {
      return true;
    }
    await sleep(250);
  }
  return !groupAlive(pid);
}

async function down() {
  let stopped = true;
  for (const service of [...services].reverse()) {
    const pid = readPid(service.name);
    if (pid == null) {
      log(`${service.name}: not started by dev:up`);
      continue;
    }
    if (!groupAlive(pid)) {
      clearPid(service.name);
      log(`${service.name}: already stopped (stale pid file removed)`);
      continue;
    }
    try {
      signalGroup(pid, 'SIGTERM');
      if (!(await waitExit(pid, 10_000))) {
        signalGroup(pid, 'SIGKILL');
        if (!(await waitExit(pid, 2_000))) {
          throw new Error('still exists after SIGKILL');
        }
      }
    } catch (error) {
      console.error(
        `[dev] ${service.name}: could not stop process group ${pid}: ${error.message}; PID record kept`,
      );
      stopped = false;
      continue;
    }
    clearPid(service.name);
    log(`${service.name}: stopped`);
  }
  if (stopped) {
    log('stack is down');
  } else {
    process.exitCode = 1;
  }
}

async function status() {
  const rows = await Promise.all(
    services.map(async (service) => {
      const pid = readPid(service.name);
      if (pid == null) {
        if (service.available && !service.available()) {
          return {
            service,
            pid,
            state: 'not installed (npm run dev:model -- --install)',
            ok: false,
          };
        }
        const busy = await portOpen(service.port);
        return {
          service,
          pid,
          state: busy ? `port ${service.port} is held by another process` : 'not started',
          ok: false,
        };
      }
      if (!groupAlive(pid)) {
        return { service, pid, state: 'stale pid file (process group is gone)', ok: false };
      }
      if (!alive(pid)) {
        return { service, pid, state: 'process group is running without its leader', ok: false };
      }
      if (service.available && !service.available()) {
        return { service, pid, state: 'not installed', ok: false };
      }
      const ready = service.probe ? await service.probe() : await portOpen(service.port);
      return { service, pid, state: ready ? 'ready' : 'running, not ready', ok: ready };
    }),
  );

  for (const { service, pid, state } of rows) {
    const name = service.name.padEnd(6);
    const pidText = String(pid ?? '-').padEnd(8);
    console.log(`[dev] ${name} pid ${pidText} port ${String(service.port).padEnd(5)} ${state}`);
  }
  process.exitCode = rows.every((row) => row.ok) ? 0 : 1;
}

const action = process.argv[2];
try {
  if (action === 'up') {
    await up();
  } else if (action === 'down') {
    await down();
  } else if (action === 'status') {
    await status();
  } else {
    fail('usage: node scripts/dev/stack.mjs <up|down|status>');
  }
} catch (error) {
  fail(error.message);
}
