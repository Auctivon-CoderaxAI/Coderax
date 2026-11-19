#!/usr/bin/env node
/**
 * Deployment-backed Coderax smoke.
 *
 * Required:
 *   CODERAX_BASE_URL=https://coderax.example
 *   CODERAX_SMOKE_TOKEN=<session token>            (or)
 *   CODERAX_SMOKE_EMAIL + CODERAX_SMOKE_PASSWORD
 *
 * Optional:
 *   CODERAX_SMOKE_MODEL=<model id>                 assert the model is offered
 *   CODERAX_SMOKE_REQUIRE_AGENTS=1                 fail when /api/agents is absent
 *
 * This is an API smoke, not the browser suite. Streaming chat and upload are
 * covered by `npm run e2e:deployed`; this proves the deployment is reachable,
 * authenticates, exposes its catalogs, and never echoes a bearer token.
 */
import { writeFileSync } from 'node:fs';

const baseUrl = process.env.CODERAX_BASE_URL?.trim();
if (!baseUrl) {
  console.error('CODERAX_BASE_URL is required');
  process.exit(2);
}
let origin;
try {
  origin = new URL(baseUrl);
} catch {
  console.error('CODERAX_BASE_URL must be an absolute URL');
  process.exit(2);
}
if (!['http:', 'https:'].includes(origin.protocol)) {
  console.error('CODERAX_BASE_URL must use http or https');
  process.exit(2);
}
origin.pathname = origin.pathname.replace(/\/?$/, '/');

const token = process.env.CODERAX_SMOKE_TOKEN?.trim() || '';
const email = process.env.CODERAX_SMOKE_EMAIL?.trim() || '';
const password = process.env.CODERAX_SMOKE_PASSWORD || '';
const requiredModel = process.env.CODERAX_SMOKE_MODEL?.trim() || '';
const requireAgents = process.env.CODERAX_SMOKE_REQUIRE_AGENTS === '1';
const timeoutMs = Number(process.env.CODERAX_SMOKE_TIMEOUT_MS || 15000);

if (!token && !(email && password)) {
  console.error('Set CODERAX_SMOKE_TOKEN or CODERAX_SMOKE_EMAIL/CODERAX_SMOKE_PASSWORD');
  process.exit(2);
}

function urlFor(path) {
  return new URL(path.replace(/^\//, ''), origin).toString();
}

async function request(path, { method = 'GET', body, bearer = token, allow = [200] } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(urlFor(path), {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!allow.includes(response.status)) {
      const detail =
        typeof payload === 'string' ? payload.slice(0, 300) : JSON.stringify(payload).slice(0, 300);
      throw new Error(`HTTP ${response.status} from ${path}: ${detail}`);
    }
    return { status: response.status, body: payload, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

const checks = [];
let failures = 0;
async function check(name, operation, { optional = false } = {}) {
  const started = Date.now();
  try {
    const detail = await operation();
    checks.push({ name, status: 'pass', durationMs: Date.now() - started, detail });
  } catch (error) {
    if (optional) {
      checks.push({
        name,
        status: 'skip',
        durationMs: Date.now() - started,
        detail: error.message,
      });
      return;
    }
    failures += 1;
    checks.push({ name, status: 'fail', durationMs: Date.now() - started, detail: error.message });
  }
}

let sessionToken = token;
async function resolveToken() {
  if (sessionToken) return 'provided';
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    bearer: '',
    allow: [200, 201],
  });
  sessionToken = response.body?.token || response.body?.accessToken;
  if (!sessionToken) throw new Error('login succeeded without returning a token');
  return 'password login';
}

await check('health', async () => {
  for (const path of ['/health', '/api/health']) {
    try {
      const response = await request(path, { bearer: '', allow: [200, 204] });
      return { path, status: response.status };
    } catch {
      // try the next liveness path
    }
  }
  throw new Error('neither /health nor /api/health returned 200');
});

await check('public config', async () => {
  const response = await request('/api/config', { bearer: '', allow: [200] });
  return { keys: Object.keys(response.body ?? {}).length };
});

await check('login', resolveToken);

await check('authenticated user', async () => {
  const response = await request('/api/user', { allow: [200] });
  const user = response.body?.user ?? response.body;
  if (!user || (typeof user !== 'object' && typeof user !== 'string'))
    throw new Error('user response is empty');
  return { id: user.id ?? user._id ?? 'present', email: user.email ?? 'redacted' };
});

await check('models catalog', async () => {
  const response = await request('/api/models', { allow: [200] });
  const models = Array.isArray(response.body) ? response.body : response.body?.models;
  if (!Array.isArray(models) || models.length === 0) throw new Error('models catalog is empty');
  const ids = models.map((model) => model?.id ?? model?.name ?? model?.model).filter(Boolean);
  if (requiredModel && !ids.includes(requiredModel)) {
    throw new Error(`configured model ${requiredModel} is not offered`);
  }
  return { count: ids.length, requiredModel: requiredModel || null };
});

await check(
  'agents catalog',
  async () => {
    const response = await request('/api/agents', { allow: [200] });
    const agents = Array.isArray(response.body) ? response.body : response.body?.agents;
    if (!Array.isArray(agents)) throw new Error('agents response is not a list');
    return { count: agents.length };
  },
  { optional: !requireAgents },
);

await check(
  'endpoint catalog',
  async () => {
    const response = await request('/api/endpoints', { allow: [200] });
    const endpoints = Array.isArray(response.body) ? response.body : response.body?.endpoints;
    if (!Array.isArray(endpoints)) throw new Error('endpoints response is not a list');
    return { count: endpoints.length };
  },
  { optional: true },
);

await check(
  'OpenAPI discovery',
  async () => {
    for (const path of ['/api/agents/openapi.json', '/api/openapi.json', '/openapi.json']) {
      try {
        const response = await request(path, { allow: [200] });
        if (response.body?.openapi || response.body?.paths) {
          return {
            path,
            version: response.body.openapi ?? 'unknown',
            paths: Object.keys(response.body.paths ?? {}).length,
          };
        }
      } catch {
        // try the next discovery path
      }
    }
    throw new Error('no OpenAPI document was reachable');
  },
  { optional: true },
);

await check('invalid bearer is rejected without echoing it', async () => {
  const invalid = `smoke-invalid-${Date.now()}`;
  let response;
  try {
    response = await request('/api/user', { bearer: invalid, allow: [401, 403] });
  } catch (error) {
    throw new Error(`invalid token was not rejected with 401/403 (${error.message})`);
  }
  const serialized = JSON.stringify(response.body ?? '');
  if (serialized.includes(invalid))
    throw new Error('error response echoed the supplied bearer token');
  return { status: response.status };
});

const report = {
  ok: failures === 0,
  baseUrl: origin.origin,
  checkedAt: new Date().toISOString(),
  failures,
  checks,
};
const output = JSON.stringify(report, null, 2);
console.log(output);
if (process.env.CODERAX_SMOKE_REPORT) {
  writeFileSync(process.env.CODERAX_SMOKE_REPORT, `${output}\n`);
}
if (failures > 0) process.exitCode = 1;
