/**
 * One command for the whole local stack.
 *
 *   npm run dev:up     start Mongo, the API, the local model and the UI; wait until each answers
 *   npm run dev:down   stop what `dev:up` started
 *
 * Each service runs in its own process group, writes to .dev/logs/<name>.log and
 * records its PID and ownership marker in .dev/pids/<name>.pid. `dev:down` signals the whole group, so
 * shutdown can reach children even when the group leader has exited.
 *
 * Override: CODERAX_PREVIEW_HOST or VITE_ALLOWED_HOSTS, the hostname the preview
 * is served from.
 *
 * The model is optional: until `npm run dev:model -- --install` has downloaded
 * it, the stack still comes up and the UI reports no available model.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { binPath, ggufPath, port as modelPort, serverArgs } from './model-paths.mjs';
import { mongoPort } from './mongo-port.mjs';
import { groupState, hasToken, ownerKey } from './pid-record.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const devDir = path.join(repoRoot, '.dev');
const pidDir = path.join(devDir, 'pids');
const lockDir = path.join(devDir, 'stack.lock');
const logDir = path.join(devDir, 'logs');

const nodeBin = process.execPath;
const previewHost = (
  process.env.CODERAX_PREVIEW_HOST ??
  process.env.VITE_ALLOWED_HOSTS ??
  ''
).trim();

const apiHost = '127.0.0.1';
const apiPort = 3080;

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
    port: apiPort,
    timeoutMs: 90_000,
    probe: () => httpOk(`http://${apiHost}:${apiPort}/api/config`),
    env: {
      NODE_ENV: 'development',
      VERCEL: '1',
      CODERAX_LOCAL_DEV: '1',
      HOST: apiHost,
      PORT: String(apiPort),
    },
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
    previewHost,
    port: 3000,
    timeoutMs: 90_000,
    probe: () => httpOk('http://127.0.0.1:3000/'),
    env: {
      NODE_ENV: 'development',
      HOST: previewHost ? '0.0.0.0' : '127.0.0.1',
      BACKEND_HOST: apiHost,
      BACKEND_PORT: String(apiPort),
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
  throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pidFile = (name) => path.join(pidDir, `${name}.pid`);

function readRecord(name) {
  let raw;
  try {
    raw = fs.readFileSync(pidFile(name), 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  // Legacy records can identify a gone group, but cannot authorize signaling.
  let record;
  try {
    record = raw.startsWith('{') ? JSON.parse(raw) : { pid: Number(raw) };
  } catch {
    fail(`${name}: invalid process record; inspect ${pidFile(name)}`);
  }
  const { pid, token, previewHost: recordedPreviewHost } = record;
  if (!Number.isSafeInteger(pid) || pid <= 1 || (token != null && !/^[a-f0-9-]{36}$/.test(token))) {
    fail(`${name}: invalid process record; inspect ${pidFile(name)}`);
  }
  return { pid, token, previewHost: recordedPreviewHost };
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

async function startService(service) {
  const spec = service.command();
  const logPath = path.join(logDir, `${service.name}.log`);
  const fd = fs.openSync(logPath, 'w');
  const token = randomUUID();
  let child;
  try {
    child = spawn(
      nodeBin,
      [path.join(repoRoot, 'scripts/dev/launch.mjs'), spec.file, ...spec.args],
      {
        cwd: spec.cwd ?? repoRoot,
        env: { ...process.env, ...service.env, [ownerKey]: token },
        detached: true,
        stdio: ['ignore', fd, fd, 'ipc'],
      },
    );
  } finally {
    fs.closeSync(fd);
  }
  const spawned = new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  if (child.pid == null) {
    await spawned;
    fail(`${service.name}: spawned without a PID`);
  }
  // The launcher cannot start the service until the ownership record is published.
  const record = { pid: child.pid, token, previewHost: service.previewHost };
  const file = pidFile(service.name);
  const temporary = `${file}.${token}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
    await spawned;
    await new Promise((resolve, reject) => {
      child.send('start', (error) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  } finally {
    if (child.connected) {
      child.disconnect();
    }
    child.unref();
  }
  return record;
}

async function waitReady(service, { pid, token }) {
  const deadline = Date.now() + service.timeoutMs;
  while (Date.now() < deadline) {
    if (!hasToken(pid, token)) {
      return false;
    }
    if (service.probe ? await service.probe() : await portOpen(service.port)) {
      return hasToken(pid, token);
    }
    await sleep(500);
  }
  return false;
}

async function up() {
  fs.mkdirSync(pidDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const uiRecord = readRecord('ui');
  if (uiRecord && groupState(uiRecord) === 'owned' && uiRecord.previewHost !== previewHost) {
    fail('ui: running preview settings differ or are unknown; run npm run dev:down, then retry');
  }

  for (const service of services) {
    const recorded = readRecord(service.name);
    const state = recorded && groupState(recorded);
    if (state === 'unverified') {
      fail(
        `${service.name}: cannot verify process group ${recorded.pid}; inspect ${pidFile(service.name)}`,
      );
    }
    if (state === 'owned') {
      if (!hasToken(recorded.pid, recorded.token)) {
        fail(`${service.name}: process group ${recorded.pid} has no leader; run npm run dev:down`);
      }
      log(`${service.name} already running (pid ${recorded.pid})`);
      if (!(await waitReady(service, recorded))) {
        fail(
          `${service.name} (pid ${recorded.pid}) is running but never became ready; see .dev/logs/${service.name}.log`,
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

    const record = await startService(service);
    log(`starting ${service.name} (pid ${record.pid})`);
    if (!(await waitReady(service, record))) {
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

async function waitExit(record, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (groupState(record) === 'gone') {
      return true;
    }
    await sleep(250);
  }
  return groupState(record) === 'gone';
}

async function down() {
  let stopped = true;
  for (const service of [...services].reverse()) {
    try {
      const record = readRecord(service.name);
      if (record == null) {
        log(`${service.name}: not started by dev:up`);
        continue;
      }
      const { pid } = record;
      const state = groupState(record);
      if (state === 'gone') {
        clearPid(service.name);
        log(`${service.name}: already stopped (stale pid file removed)`);
        continue;
      }
      if (state !== 'owned') {
        throw new Error(`ownership of process group ${pid} could not be verified`);
      }
      signalGroup(pid, 'SIGTERM');
      if (!(await waitExit(record, 10_000))) {
        if (groupState(record) === 'owned') {
          signalGroup(pid, 'SIGKILL');
        }
        if (!(await waitExit(record, 2_000))) {
          throw new Error(`could not confirm exit of process group ${pid}`);
        }
      }
      clearPid(service.name);
      log(`${service.name}: stopped`);
    } catch (error) {
      console.error(
        `[dev] ${service.name}: shutdown incomplete: ${error.message}; inspect ${pidFile(service.name)}`,
      );
      stopped = false;
    }
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
      const record = readRecord(service.name);
      const pid = record?.pid;
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
      const ownership = groupState(record);
      if (ownership === 'gone') {
        return { service, pid, state: 'stale pid file (process group is gone)', ok: false };
      }
      if (ownership === 'unverified') {
        return { service, pid, state: 'process group ownership could not be verified', ok: false };
      }
      if (!hasToken(pid, record.token)) {
        return { service, pid, state: 'process group is running without its leader', ok: false };
      }
      if (service.available && !service.available()) {
        return { service, pid, state: 'not installed', ok: false };
      }
      const responding = service.probe ? await service.probe() : await portOpen(service.port);
      const ready = responding && hasToken(pid, record.token);
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
  if (action === 'up' || action === 'down') {
    fs.mkdirSync(devDir, { recursive: true });
    try {
      fs.mkdirSync(lockDir);
    } catch (error) {
      if (error.code === 'EEXIST') {
        fail('another lifecycle command owns .dev/stack.lock; see scripts/dev/README.md');
      }
      throw error;
    }
    const release = () => fs.rmdirSync(lockDir);
    const interrupt = (code) => {
      release();
      process.exit(code);
    };
    const onInterrupt = () => interrupt(130);
    const onTerminate = () => interrupt(143);
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    try {
      await (action === 'up' ? up() : down());
    } finally {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      release();
    }
  } else if (action === 'status') {
    await status();
  } else {
    fail('usage: node scripts/dev/stack.mjs <up|down|status>');
  }
} catch (error) {
  console.error(`[dev] ${error.message}`);
  process.exitCode = 1;
}
