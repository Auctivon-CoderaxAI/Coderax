#!/usr/bin/env node
/**
 * Owner-only access gate for a running Coderax deployment.
 *
 * Checks, without credentials, that:
 *   - the public startup config still disables registration and guest access,
 *   - password-only owner sign-in is enabled, and
 *   - every private surface (Chat, Work, projects, files, memory, agents,
 *     schedules and model inference) refuses an anonymous request.
 *
 * Usage:
 *   node scripts/verify-coderax-access.mjs --base-url https://coderax.nnabdelshahid.workers.dev
 *
 * This contacts the deployment but never creates a session, guest account or
 * model run.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTECTED_GET_PATHS = [
  '/api/user',
  '/api/convos',
  '/api/projects',
  '/api/memories',
  '/api/files',
  '/api/models',
  '/api/agents',
  '/api/schedules',
  '/api/studio',
  '/api/workflows',
  '/api/search',
  '/api/presets',
];

/** Chat, Work and the OpenAI-compatible agent surface must refuse anonymous inference. */
export const PROTECTED_POST_PATHS = [
  '/api/work/chat',
  '/api/agents/chat',
  '/api/agents/v1/chat/completions',
];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The base URL must be a plain HTTPS origin, or loopback HTTP for local checks. */
export function validateAccessURL(value) {
  const url = new URL(value);
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  assert.ok(
    url.protocol === 'https:' || (url.protocol === 'http:' && loopback),
    'base URL must use HTTPS unless it targets a loopback host',
  );
  assert.equal(url.username, '', 'base URL cannot embed credentials');
  assert.equal(url.password, '', 'base URL cannot embed credentials');
  assert.equal(url.search, '', 'base URL cannot include a query string');
  assert.equal(url.hash, '', 'base URL cannot contain a fragment');
  assert.equal(url.pathname, '/', 'base URL must be a deployment origin');
  return url.origin;
}

const anonymousRequest = (fetcher, url, init = {}) =>
  fetcher(url, {
    redirect: 'manual',
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
    ...init,
  });

const denied = (status) => status === 401 || status === 403;

/**
 * Fail unless the deployment is owner-only and refuses anonymous access.
 * `fetcher` is injectable so the contract can be tested without a deployment.
 */
export async function verifyOwnerOnly(value, fetcher = fetch) {
  const origin = validateAccessURL(value);
  const checks = [];

  const configResponse = await anonymousRequest(fetcher, `${origin}/api/config`);
  assert.equal(configResponse.status, 200, 'anonymous /api/config must return 200');
  const config = JSON.parse(await configResponse.text());
  assert.equal(typeof config.appTitle, 'string', 'startup config is missing appTitle');
  assert.notEqual(config.registrationEnabled, true, 'public registration must be disabled');
  assert.equal(config.passwordLoginEnabled, true, 'password-only owner sign-in must be enabled');
  assert.notEqual(config.guestAccessEnabled, true, 'guest access must be disabled');
  checks.push({ name: 'startup config', status: 'pass' });

  for (const route of PROTECTED_GET_PATHS) {
    const response = await anonymousRequest(fetcher, origin + route);
    assert.ok(
      denied(response.status),
      `${route} returned HTTP ${response.status} to an anonymous request`,
    );
    assert.equal(response.headers.get('location'), null, `${route} redirected anonymously`);
    checks.push({ name: `anonymous ${route}`, status: 'pass', http: response.status });
  }

  for (const route of PROTECTED_POST_PATHS) {
    const response = await anonymousRequest(fetcher, origin + route, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{}',
    });
    assert.ok(
      denied(response.status),
      `${route} returned HTTP ${response.status} to an anonymous request`,
    );
    checks.push({ name: `anonymous ${route}`, status: 'pass', http: response.status });
  }

  return { ok: true, origin, checks };
}

export function parseArgs(argv) {
  const options = { baseUrl: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base-url') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--') || value.trim() === '') {
        throw new Error('--base-url needs an HTTPS origin');
      }
      index += 1;
      options.baseUrl = value;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  if (!options.help && options.baseUrl === null) {
    throw new Error('choose --base-url <origin>');
  }
  return options;
}

export const USAGE = `Usage:
  node scripts/verify-coderax-access.mjs --base-url <https-origin>

Fails unless the deployment disables registration and guest access, enables
password-only owner sign-in, and refuses anonymous access to Chat, Work,
projects, files, memory, agents, schedules and model inference. It creates no
session and runs no model.`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  try {
    const report = await verifyOwnerOnly(options.baseUrl);
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(
      '[Coderax access gate] FAILED:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
