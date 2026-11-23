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
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { binPath, ggufPath, port as modelPort, serverArgs } from './model-paths.mjs';
import { mongoPort } from './mongo-port.mjs';

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
const previewEnabled = Boolean(previewHost);

// Express loads this file with dotenv, giving the inherited environment precedence.
function apiEnvironment() {
  const envPath = path.join(repoRoot, '.env');
  const { parse } = createRequire(path.join(repoRoot, 'api/package.json'))('dotenv');
  let fileEnv = {};
  try {
    fileEnv = parse(fs.readFileSync(envPath));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  return { ...fileEnv, ...process.env };
}

let environment;
const getApiEnvironment = () => (environment ??= apiEnvironment());

function apiBinding() {
  const env = getApiEnvironment();
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT ?? 3080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail('dev:up requires API PORT to be an integer from 1 to 65535');
  }
  // Wildcard addresses listen on loopback too, which is the destination we need.
  const wildcardHosts = new Map([
    ['0.0.0.0', '127.0.0.1'],
    ['::', '::1'],
  ]);
  const connectHost = wildcardHosts.get(host) ?? host;
  const urlHost = net.isIPv6(connectHost) ? `[${connectHost}]` : connectHost;
  return { host, port, connectHost, probeUrl: `http://${urlHost}:${port}/api/config` };
}

let binding;
const getApiBinding = () => (binding ??= apiBinding());

function managedMongoUri() {
  const port = mongoPort();
  const uri = getApiEnvironment().MONGO_URI ?? `mongodb://127.0.0.1:${port}/Coderax`;
  const target = /^mongodb:\/\/127\.0\.0\.1(?::(\d+))?(?=\/|$)/.exec(uri);
  if (!target || Number(target[1] ?? 27017) !== port) {
    fail(`dev:up requires MONGO_URI to target only the managed MongoDB at 127.0.0.1:${port}`);
  }
  return uri;
}

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
    get port() {
      return getApiBinding().port;
    },
    get probeHost() {
      return getApiBinding().connectHost;
    },
    timeoutMs: 90_000,
    probe: () => httpOk(getApiBinding().probeUrl),
    get env() {
      const { host, port } = getApiBinding();
      return {
        NODE_ENV: 'development',
        VERCEL: '1',
        CODERAX_LOCAL_DEV: '1',
        HOST: host,
        PORT: String(port),
        MONGO_URI: managedMongoUri(),
        ...(previewEnabled ? { TRUST_TENANT_HEADER: 'false' } : {}),
      };
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
    port: 3000,
    timeoutMs: 90_000,
    probe: () => httpOk('http://127.0.0.1:3000/'),
    get env() {
      const { connectHost, port } = getApiBinding();
      return {
        NODE_ENV: 'development',
        HOST: previewEnabled ? '0.0.0.0' : '127.0.0.1',
        PORT: '3000',
        BACKEND_HOST: connectHost,
        BACKEND_PORT: String(port),
        VITE_ALLOWED_HOSTS: previewHost,
      };
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
  const { pid, token, preview } = record;
  if (!Number.isSafeInteger(pid) || pid <= 1 || (token != null && !/^[a-f0-9-]{36}$/.test(token))) {
    fail(`${name}: invalid process record; inspect ${pidFile(name)}`);
  }
  return { pid, token, preview };
}

const ownerKey = 'CODERAX_DEV_GROUP_OWNER';

function hasToken(pid, token) {
  const marker = `${ownerKey}=${token}`;
  if (process.platform === 'linux') {
    try {
      return fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(marker);
    } catch (error) {
      if (['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(error.code)) {
        return false;
      }
      throw error;
    }
  }
  // BSD ps can display the initial environment for same-user processes.
  try {
    return execFileSync('ps', ['eww', '-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
    })
      .trim()
      .split(/\s+/)
      .includes(marker);
  } catch (error) {
    if (error.status === 1) {
      return false;
    }
    throw error;
  }
}

function groupState({ pid, token }) {
  if (!groupAlive(pid)) {
    return 'gone';
  }
  if (!token) {
    return 'unverified';
  }
  const rows = execFileSync('ps', ['-ax', '-o', 'pid=', '-o', 'pgid=', '-o', 'stat='], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  let sawMember = false;
  let sawLiveMember = false;
  for (const row of rows) {
    const [member, group, state] = row.trim().split(/\s+/);
    if (Number(group) !== pid) {
      continue;
    }
    sawMember = true;
    if (state?.startsWith('Z')) {
      continue;
    }
    sawLiveMember = true;
    if (hasToken(Number(member), token)) {
      return 'owned';
    }
  }
  // A zombie cannot serve traffic or react to signals. An invisible live group,
  // however, may still own a service; keep its record until it can be verified.
  if (sawMember && !sawLiveMember) {
    return 'gone';
  }
  return groupAlive(pid) ? 'unverified' : 'gone';
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

async function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
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
  // The detached process waits for the ownership record before it can serve.
  // If the supervisor dies first, the pipe closes and the shell exits on EOF.
  // exec preserves the recorded group leader and the service receives no stdin.
  const child = spawn(
    '/bin/sh',
    ['-c', 'read -r start && exec "$@" </dev/null', 'dev-stack', spec.file, ...spec.args],
    {
      cwd: spec.cwd ?? repoRoot,
      env: { ...process.env, ...service.env, [ownerKey]: token },
      detached: true,
      stdio: ['pipe', fd, fd],
    },
  );
  fs.closeSync(fd);
  const gate = child.stdin;
  // The write callback handles failure; the stream can also emit an error.
  gate.on('error', () => {});
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  const record = {
    pid: child.pid,
    token,
    ...(['api', 'ui'].includes(service.name) ? { preview: previewEnabled } : {}),
  };
  const file = pidFile(service.name);
  const temporary = `${file}.${token}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
    await new Promise((resolve, reject) => {
      gate.end('start\n', (error) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    gate.destroy();
    if (groupState(record) === 'owned') {
      signalGroup(record.pid, 'SIGTERM');
    }
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return record;
}

async function waitReady(service, { pid, token }, signal) {
  const deadline = Date.now() + service.timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (!hasToken(pid, token)) {
      return false;
    }
    if (service.probe ? await service.probe() : await portOpen(service.port, service.probeHost)) {
      signal.throwIfAborted();
      return hasToken(pid, token);
    }
    await sleep(500);
  }
  return false;
}

async function up(signal) {
  if (previewEnabled && getApiEnvironment().TRUST_TENANT_HEADER?.trim().toLowerCase() === 'true') {
    fail('dev:up network preview requires TRUST_TENANT_HEADER to be disabled');
  }
  managedMongoUri();
  getApiBinding();
  fs.mkdirSync(pidDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  if (!previewEnabled) {
    log('UI is local only; set CODERAX_PREVIEW_HOST to opt in to network preview');
  }

  for (const name of ['api', 'ui']) {
    const record = readRecord(name);
    if (record && groupState(record) === 'owned' && record.preview !== previewEnabled) {
      fail(`${name}: run npm run dev:down before upgrading or changing preview mode`);
    }
  }

  for (const service of services) {
    signal.throwIfAborted();
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
      if (!(await waitReady(service, recorded, signal))) {
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

    if (await portOpen(service.port, service.probeHost)) {
      fail(
        `port ${service.port} is already in use by a process dev:up did not start; stop it, then retry`,
      );
    }

    signal.throwIfAborted();
    const record = await startService(service);
    log(`starting ${service.name} (pid ${record.pid})`);
    if (!(await waitReady(service, record, signal))) {
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
    if (groupState(record) !== 'owned') {
      return true;
    }
    await sleep(250);
  }
  return groupState(record) !== 'owned';
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
        throw new Error('ownership could not be verified');
      }
      signalGroup(pid, 'SIGTERM');
      if (!(await waitExit(record, 10_000))) {
        if (groupState(record) === 'owned') {
          signalGroup(pid, 'SIGKILL');
        }
        if (!(await waitExit(record, 2_000))) {
          throw new Error('still exists after SIGKILL');
        }
      }
      if (groupState(record) === 'unverified') {
        throw new Error('ownership could no longer be verified');
      }
      clearPid(service.name);
      log(`${service.name}: stopped`);
    } catch (error) {
      console.error(`[dev] ${service.name}: could not stop: ${error.message}; PID record kept`);
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
        const busy = await portOpen(service.port, service.probeHost);
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
      const responding = service.probe
        ? await service.probe()
        : await portOpen(service.port, service.probeHost);
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
    const interruption = new AbortController();
    let interruptExitCode;
    const interrupt = (signal) => {
      interruptExitCode ??= signal === 'SIGINT' ? 130 : 143;
      interruption.abort(
        new Error(`received ${signal}; run npm run dev:down to stop recorded services`),
      );
    };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    try {
      await (action === 'up' ? up(interruption.signal) : down());
    } finally {
      fs.rmdirSync(lockDir);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      if (interruptExitCode != null) {
        process.exitCode = interruptExitCode;
      }
    }
  } else if (action === 'status') {
    await status();
  } else {
    fail('usage: node scripts/dev/stack.mjs <up|down|status>');
  }
} catch (error) {
  console.error(`[dev] ${error.message}`);
  process.exitCode ||= 1;
}
