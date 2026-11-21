import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEV_DIR = path.join(ROOT, '.dev');
export const RUN_DIR = path.join(DEV_DIR, 'run');
export const LOG_DIR = path.join(DEV_DIR, 'logs');

export const npmCommand = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm');

/** Minimal KEY=value reader: comments, blank lines and optional surrounding quotes. */
export function parseEnv(text) {
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    const quoted =
      value.length > 1 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/** `.env` values, with the real process environment taking precedence. */
export function loadEnv() {
  const file = path.join(ROOT, '.env');
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  return { ...fromFile, ...process.env };
}

export const logPath = (name) => path.join(LOG_DIR, `${name}.log`);
const recordPath = (name) => path.join(RUN_DIR, `${name}.json`);

export function readRecord(name) {
  try {
    return JSON.parse(readFileSync(recordPath(name), 'utf8'));
  } catch {
    return null;
  }
}

export function writeRecord(name, record) {
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(recordPath(name), `${JSON.stringify(record, null, 2)}\n`);
}

export function clearRecord(name) {
  rmSync(recordPath(name), { force: true });
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Signal the child's process group so npm and spawned children stop too. */
export function signal(pid, name) {
  try {
    process.kill(-pid, name);
    return true;
  } catch (error) {
    if (error.code !== 'ESRCH') {
      return false;
    }
  }
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
}

export function tcpOpen(port, host = '127.0.0.1', timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export async function httpOk(url, timeoutMs = 1500) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitFor(check, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export function logTail(file, lines = 12) {
  if (!existsSync(file)) {
    return '(no log yet)';
  }
  return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
}

/** Best-effort PID of the process listening on a port, for orphan diagnostics. */
export function listenerPid(port) {
  try {
    const output = execFileSync('ss', ['-ltnp'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of output.split('\n')) {
      if (!line.includes(`:${port} `)) {
        continue;
      }
      const match = line.match(/pid=(\d+)/);
      if (match) {
        return Number(match[1]);
      }
    }
  } catch {
    return null;
  }
  return null;
}
