import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_FILE = 'config.json';
const CREDENTIALS_FILE = 'credentials.json';

/**
 * Credentials live in their own file so `config` can be inspected and shared
 * without exposing the token, and so `logout` is a single unlink.
 */
export function configDir(env = process.env) {
  return env.CODERAX_CONFIG_DIR || path.join(os.homedir(), '.coderax');
}

export const DEFAULTS = Object.freeze({
  baseUrl: '',
  chatPath: '/api/ask/agents',
  endpoint: 'agents',
  model: '',
  output: 'text',
});

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeSecure(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  // rename keeps the temp file's mode, but be explicit for umask edge cases.
  fs.chmodSync(file, 0o600);
}

export function loadConfig(env = process.env) {
  const stored = readJson(path.join(configDir(env), CONFIG_FILE));
  return { ...DEFAULTS, ...(stored ?? {}) };
}

export function saveConfig(config, env = process.env) {
  writeSecure(path.join(configDir(env), CONFIG_FILE), config);
}

export function loadCredentials(env = process.env) {
  const stored = readJson(path.join(configDir(env), CREDENTIALS_FILE));
  if (!stored?.token) {
    return null;
  }
  return stored;
}

export function saveCredentials(credentials, env = process.env) {
  writeSecure(path.join(configDir(env), CREDENTIALS_FILE), credentials);
}

export function clearCredentials(env = process.env) {
  const file = path.join(configDir(env), CREDENTIALS_FILE);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Environment wins over the config file so CI can inject settings without
 * rewriting a developer's local profile.
 */
export function resolveSettings({ env = process.env, flags = {} } = {}) {
  const config = loadConfig(env);
  const credentials = loadCredentials(env);
  const baseUrl = (
    flags.baseUrl
    || env.CODERAX_BASE_URL
    || config.baseUrl
    || ''
  ).replace(/\/+$/, '');
  return {
    config,
    baseUrl,
    token: env.CODERAX_TOKEN || credentials?.token || '',
    tokenSource: env.CODERAX_TOKEN
      ? 'environment'
      : credentials?.token
        ? 'credentials file'
        : 'none',
    chatPath: flags.chatPath || env.CODERAX_CHAT_PATH || config.chatPath,
    endpoint: flags.endpoint || env.CODERAX_ENDPOINT || config.endpoint,
    model: flags.model || env.CODERAX_MODEL || config.model,
    account: credentials?.account ?? null,
  };
}

/** Never print a whole token, not even in `--json` output. */
export function maskToken(token) {
  if (!token) {
    return null;
  }
  if (token.length <= 8) {
    return '*'.repeat(token.length);
  }
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
