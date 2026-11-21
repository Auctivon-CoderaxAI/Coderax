#!/usr/bin/env node
/**
 * Local environment supervisor.
 *
 *   npm run dev:up       start Mongo, the model, the API and Vite; wait for each
 *   npm run dev:down     stop them in reverse order
 *   npm run dev:status   show recorded PIDs, ports and readiness
 *
 * PIDs live in .dev/run/<name>.json, logs in .dev/logs/<name>.log.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, rmdirSync, writeFileSync } from 'node:fs';

import {
  DEV_DIR,
  LOG_DIR,
  ROOT,
  bootId,
  clearRecord,
  isAlive,
  listenerPid,
  loadEnv,
  logPath,
  logTail,
  npmCommand,
  pidStartTime,
  readProcessStat,
  readRecord,
  signal,
  tcpOpen,
  waitFor,
  writeRecord,
} from './lib.mjs';
import { assertMongoEndpoint, createServices, mongoUri, ports } from './services.mjs';

const command = process.argv[2] ?? 'status';

class ServiceError extends Error {
  constructor(service, message) {
    super(message);
    this.service = service;
  }
}

function envTemplate() {
  const secret = () => crypto.randomBytes(48).toString('hex');
  return `# Local development defaults written by \`npm run dev:up\` on first run.
# Restart the supervisor after changing ports.
HOST=127.0.0.1
PORT=3080
DEV_VITE_PORT=3090
DEV_MONGO_PORT=27017
DEV_MODEL_PORT=8080
DEV_MODEL_ID=qwen2.5-1.5b-instruct

MONGO_URI=mongodb://127.0.0.1:27017/Coderax
DOMAIN_CLIENT=http://localhost:3090
DOMAIN_SERVER=http://localhost:3080

# Vite serves the client shell in development, so the API boots without client/dist.
SERVE_CLIENT=false
# Hosts the Vite dev server may answer for (comma separated); set this to a preview hostname.
VITE_ALLOWED_HOSTS=
# dev = Vite dev server with HMR. preview = build client/dist and serve it with
# 'vite preview'; use preview where a proxy rejects Vite's many module requests.
DEV_CLIENT_MODE=dev

ALLOW_EMAIL_LOGIN=true
ALLOW_REGISTRATION=true
ALLOW_SOCIAL_LOGIN=false
# The client's only entry screen is passwordless guest access ('/connect'); without
# this it reports "Coderax is unavailable" even though the stack is healthy.
ENABLE_GUEST_ACCESS=true
# One API process in this environment; the schedule engine refuses to arm otherwise.
SCHEDULES_SINGLE_PROCESS=true

JWT_SECRET=${secret()}
JWT_REFRESH_SECRET=${secret()}
CREDS_KEY=${crypto.randomBytes(32).toString('hex')}
CREDS_IV=${crypto.randomBytes(16).toString('hex')}

# The supervisor creates this user (email verified) when it does not exist yet.
# The password is generated per install and stays in this file.
DEV_USER_EMAIL=dev@coderax.local
DEV_USER_PASSWORD=${crypto.randomBytes(18).toString('base64url')}
DEV_USER_USERNAME=dev
`;
}

function configTemplate(env) {
  const modelPort = ports(env).model;
  const modelId = env.DEV_MODEL_ID || 'qwen2.5-1.5b-instruct';
  return `# Local llama.cpp endpoint written by \`npm run dev:up\` on first run.
version: 1.3.17
endpoints:
  custom:
    - name: 'llamacpp'
      apiKey: 'local'
      baseURL: 'http://127.0.0.1:${modelPort}/v1'
      models:
        default:
          - '${modelId}'
        fetch: true
      titleConvo: false
      modelDisplayLabel: 'llama.cpp (local)'
`;
}

function ensureEnv() {
  const file = path.join(ROOT, '.env');
  if (existsSync(file)) {
    return loadEnv();
  }
  writeFileSync(file, envTemplate());
  console.log('▸ wrote .env with local development defaults');
  return loadEnv();
}

function ensureConfig(env) {
  const file = path.join(ROOT, 'coderax.yaml');
  if (existsSync(file)) {
    return;
  }
  writeFileSync(file, configTemplate(env));
  console.log(`▸ wrote coderax.yaml with the local llama.cpp endpoint`);
}

const BUILD_OUTPUTS = [
  'packages/data-provider/dist',
  'packages/data-schemas/dist',
  'packages/api/dist',
  'packages/client/dist',
];

function ensureBuild() {
  const missing = BUILD_OUTPUTS.filter((output) => !existsSync(path.join(ROOT, output)));
  if (missing.length === 0) {
    return;
  }
  console.log(`▸ building workspace packages (missing: ${missing.join(', ')})`);
  const result = spawnSync(npmCommand(), ['run', 'build:packages'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      '`npm run build:packages` failed; fix the build before starting the environment',
    );
  }
}

function ensureClientBuild(env) {
  if (env.DEV_CLIENT_MODE !== 'preview' || env.DEV_SKIP_CLIENT_BUILD === '1') {
    return;
  }
  console.log('▸ building the client for the preview');
  const result = spawnSync(npmCommand(), ['run', 'build:client'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error('`npm run build:client` failed; fix the build before starting the preview');
  }
}

function modelPaths(env) {
  const dir = env.DEV_MODEL_DIR || path.join(DEV_DIR, 'model');
  return {
    dir,
    bin: env.LLAMA_SERVER_BIN || path.join(dir, 'bin', 'llama-server'),
    gguf: env.LLAMA_MODEL_PATH || path.join(dir, 'qwen2.5-1.5b-q4.gguf'),
  };
}

function ensureModel(env) {
  const { bin, gguf } = modelPaths(env);
  const missing = [!existsSync(bin) && bin, !existsSync(gguf) && gguf].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Local model artifacts are missing:\n  ${missing.join(
        '\n  ',
      )}\nFetch them with \`npm run dev:model:setup\` (about 1 GB plus a llama.cpp build).`,
    );
  }
}

function ensureDevUser(env) {
  if (env.DEV_SKIP_USER === '1') {
    return;
  }
  const email = env.DEV_USER_EMAIL || 'dev@coderax.local';
  const username = env.DEV_USER_USERNAME || 'dev';
  const password = env.DEV_USER_PASSWORD;
  if (!password || password === 'coderax-dev') {
    console.warn('! skipping dev user setup: set a unique DEV_USER_PASSWORD in .env');
    return;
  }
  const result = spawnSync(
    process.execPath,
    ['config/create-user.js', email, 'Dev User', username, password, '--email-verified=true'],
    { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status === 0) {
    console.log(`✔ dev user ${email} created`);
  } else if (/already exists/i.test(output)) {
    console.log(`• dev user ${email} already exists`);
  } else {
    const detail = output.trim().split('\n').slice(-2).join(' ');
    console.warn(`! could not create dev user ${email}: ${detail || `exit ${result.status}`}`);
  }
}

const commandLine = (service) => [service.command, ...service.args].join(' ');

const currentBoot = pidStartTime(process.pid) ? bootId() : null;

// Record only listener and access settings, never credentials or the full environment.
function accessSettings(service) {
  const settings = (keys) => keys.map((key) => service.env[key] ?? null);
  if (service.name === 'api') {
    const { hostname, port } = new URL(service.env.MONGO_URI);
    return JSON.stringify([
      ...settings(['HOST', 'ENABLE_GUEST_ACCESS', 'ALLOW_REGISTRATION', 'ALLOW_EMAIL_LOGIN']),
      hostname,
      port || '27017',
    ]);
  }
  if (service.name === 'vite') {
    return JSON.stringify(settings(['HOST', 'BACKEND_HOST', 'BACKEND_PORT', 'VITE_ALLOWED_HOSTS']));
  }
  return JSON.stringify(service.name === 'model' ? settings(['DEV_MODEL_HOST']) : []);
}

function recordFor(service, pid) {
  return {
    service: service.name,
    pid,
    pidStart: currentBoot ? pidStartTime(pid) : null,
    bootId: currentBoot,
    port: service.port,
    probeHost: service.probeHost,
    command: commandLine(service),
    accessSettings: accessSettings(service),
    cwd: service.cwd,
    startedAt: new Date().toISOString(),
    log: logPath(service.name),
  };
}

function ownsPid(record) {
  return Boolean(
    record?.pidStart &&
      currentBoot &&
      record.bootId === currentBoot &&
      pidStartTime(record.pid) === record.pidStart &&
      isAlive(record.pid),
  );
}

function isStaleRecord(record) {
  if (!currentBoot) {
    return false;
  }
  if (record.bootId && currentBoot !== record.bootId) {
    return true;
  }
  const stat = readProcessStat(record.pid);
  return Boolean(
    stat &&
      (stat.state === 'Z' || (record.bootId && record.pidStart && stat.start !== record.pidStart)),
  );
}

/** Returns true when this call started the service. */
async function startService(service) {
  const record = readRecord(service.name);
  if (ownsPid(record)) {
    if (
      record.command !== commandLine(service) ||
      record.port !== service.port ||
      record.accessSettings !== accessSettings(service)
    ) {
      console.log(`▸ ${service.name} configuration changed; restarting`);
      if (!(await stopService(service))) {
        throw new ServiceError(service, `could not stop ${service.name} before restarting it`);
      }
    } else {
      if (await service.ready()) {
        console.log(`• ${service.name} already running (pid ${record.pid})`);
        return false;
      }
      process.stdout.write(`▸ ${service.name} pid ${record.pid} is alive; waiting for readiness `);
      const ready = await waitFor(service.ready, { timeoutMs: service.timeoutMs });
      console.log(ready ? 'ready' : 'FAILED');
      if (!ready) {
        throw new ServiceError(service, `${service.name} (pid ${record.pid}) never became ready`);
      }
      return false;
    }
  }
  if (readRecord(service.name) && !(await stopService(service))) {
    throw new ServiceError(service, `could not clear the previous ${service.name} service`);
  }

  if (await tcpOpen(service.port, service.probeHost)) {
    const holder = listenerPid(service.port);
    throw new ServiceError(
      service,
      `port ${service.port} is already in use by a process dev:up did not start` +
        (holder ? ` (pid ${holder})` : '') +
        `; stop it or change the port in .env`,
    );
  }

  mkdirSync(LOG_DIR, { recursive: true });
  const log = logPath(service.name);
  const handle = openSync(log, 'w');
  let spawnError = null;
  let child;
  try {
    child = spawn(service.command, service.args, {
      cwd: service.cwd,
      env: { ...process.env, ...service.env },
      detached: true,
      stdio: ['ignore', handle, handle],
    });
  } finally {
    closeSync(handle);
  }
  child.once('error', (error) => {
    spawnError = error;
  });
  if (!child.pid) {
    throw new ServiceError(
      service,
      `${service.name} did not start: ${spawnError?.message ?? 'no pid'}`,
    );
  }
  child.unref();
  writeRecord(service.name, recordFor(service, child.pid));
  process.stdout.write(`▸ ${service.name} starting (pid ${child.pid}) `);

  const deadline = Date.now() + service.timeoutMs;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnError || child.exitCode !== null) {
      break;
    }
    if (await service.ready().catch(() => false)) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  console.log(ready ? 'ready' : 'FAILED');
  if (!ready) {
    await stopService(service);
    let reason = '';
    if (spawnError) {
      reason = `: ${spawnError.message}`;
    } else if (child.exitCode !== null) {
      reason = `: process exited with code ${child.exitCode}`;
    }
    throw new ServiceError(
      service,
      `${service.name} did not become ready within ${Math.round(
        service.timeoutMs / 1000,
      )}s${reason}`,
    );
  }
  return true;
}

// A detached child is a session and group leader. Once it exits, an owned
// listener in that same session can still establish ownership of the group.
function ownsListeningGroup(record) {
  if (!currentBoot || record.bootId !== currentBoot || !record.pidStart) {
    return false;
  }
  const leader = readProcessStat(record.pid);
  if (leader && leader.start !== record.pidStart) {
    return false;
  }
  const listener = readProcessStat(listenerPid(record.port));
  return (
    listener?.group === record.pid &&
    listener.session === record.pid &&
    listener.state !== 'Z' &&
    Number(listener.start) >= Number(record.pidStart)
  );
}

async function stopService(service) {
  const record = readRecord(service.name);
  if (!record) {
    console.log(`• ${service.name}: no PID recorded`);
    return true;
  }
  const stopped = async () =>
    (!isAlive(record.pid) || isStaleRecord(record)) &&
    !(await tcpOpen(record.port, record.probeHost));
  if (ownsPid(record) || ownsListeningGroup(record)) {
    process.stdout.write(`▸ stopping ${service.name} (pid ${record.pid}) `);
    signal(record.pid, 'SIGTERM');
    if (!(await waitFor(stopped, { timeoutMs: 10_000 }))) {
      if (ownsPid(record) || ownsListeningGroup(record)) {
        process.stdout.write('SIGKILL ');
        signal(record.pid, 'SIGKILL');
      }
      await waitFor(stopped, { timeoutMs: 5000 });
    }
  }
  if (!(await stopped())) {
    console.error(
      `! ${service.name}: could not confirm shutdown on port ${record.port}; keeping PID record ${record.pid}`,
    );
    return false;
  }
  clearRecord(service.name);
  console.log(`• ${service.name}: stopped`);
  return true;
}

async function status(services, env) {
  const rows = [];
  let allReady = true;
  for (const service of services) {
    const record = readRecord(service.name);
    const alive = ownsPid(record);
    const ready = await service.ready().catch(() => false);
    const holder = !alive && !ready ? listenerPid(service.port) : null;
    let state = 'stopped';
    if (record && !alive && (await tcpOpen(record.port, record.probeHost))) {
      state = 'shutdown unconfirmed';
      allReady = false;
    } else if (ready) {
      state = alive ? 'ready' : 'untracked';
    } else if (alive) {
      state = 'starting';
    }
    let pidLabel = '-';
    if (alive) {
      pidLabel = String(record.pid);
    } else if (record) {
      pidLabel = `${isAlive(record.pid) ? 'unverified' : 'stale'} ${record.pid}`;
    }
    if (!ready) {
      allReady = false;
    }
    rows.push({
      service: service.name,
      pid: pidLabel,
      port: String(service.port),
      state,
      detail: holder ? `port held by pid ${holder}` : service.detail,
    });
  }

  const width = (key) => Math.max(key.length, ...rows.map((row) => String(row[key]).length));
  const columns = ['service', 'pid', 'port', 'state'];
  const widths = Object.fromEntries(columns.map((key) => [key, width(key)]));
  console.log(columns.map((key) => key.padEnd(widths[key])).join('  ') + '  detail');
  for (const row of rows) {
    console.log(
      columns.map((key) => String(row[key]).padEnd(widths[key])).join('  ') + `  ${row.detail}`,
    );
  }
  console.log(`\nlogs: ${LOG_DIR}`);
  if (env.DOMAIN_CLIENT) {
    console.log(`app:  ${env.DOMAIN_CLIENT}`);
  }
  return allReady;
}

async function up() {
  if (!currentBoot) {
    console.warn(
      '! Process identity is unavailable; stop services manually using the reported PIDs.',
    );
  }
  const env = ensureEnv();
  assertMongoEndpoint(env);
  env.MONGO_URI = mongoUri(env);
  ensureConfig(env);
  ensureBuild();
  ensureClientBuild(env);
  ensureModel(env);

  const services = createServices(env);
  mkdirSync(DEV_DIR, { recursive: true });
  const started = [];
  try {
    for (const service of services) {
      if (await startService(service)) {
        started.push(service);
      }
    }
  } catch (error) {
    console.error(`\n✖ ${error.message}`);
    if (error.service) {
      console.error(logTail(logPath(error.service.name), 20));
    }
    for (const service of started.reverse()) {
      await stopService(service);
    }
    process.exitCode = 1;
    return;
  }

  ensureDevUser(env);
  console.log('');
  await status(services, env);
  console.log('\n✔ local environment is up');
}

function modelSetup() {
  /* Running through this entry point gives the script the same .env values
     dev:up resolves, so it installs where dev:up looks for the artifacts. */
  const env = loadEnv();
  const result = spawnSync('bash', [path.join('scripts', 'dev', 'fetch-model.sh')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  process.exit(result.status ?? 1);
}

async function down() {
  const env = loadEnv();
  const services = createServices(env);
  for (const service of [...services].reverse()) {
    if (!(await stopService(service))) {
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) {
    console.log('\n✔ local environment is down');
  }
}

function usage() {
  console.log(`Usage: node scripts/dev/index.mjs <up|down|status|model:setup>

  up           start Mongo, the model, the API and the client; poll readiness and record PIDs
  down         stop them in reverse order (SIGTERM, then SIGKILL after 10s)
  status       show recorded PIDs, ports and readiness (exit 1 unless all are ready)
  model:setup  download the GGUF and build llama-server at the .env paths`);
}

async function withLifecycleLock(run) {
  mkdirSync(DEV_DIR, { recursive: true });
  const lock = path.join(DEV_DIR, 'lifecycle.lock');
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
    throw new Error(
      'dev:up or dev:down already holds .dev/lifecycle.lock. Remove it only if neither command is running.',
    );
  }
  const release = () => rmdirSync(lock);
  const interrupt = (code) => {
    // Detached services remain recorded for a later dev:down.
    release();
    process.exit(code);
  };
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    await run();
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    release();
  }
}

const main = async () => {
  if (command === 'up' || command === 'down') {
    await withLifecycleLock(command === 'up' ? up : down);
  } else if (command === 'status') {
    const env = loadEnv();
    const services = createServices(env);
    const ready = await status(services, env);
    process.exit(ready ? 0 : 1);
  } else if (command === 'model:setup') {
    modelSetup();
  } else {
    usage();
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exit(1);
});
