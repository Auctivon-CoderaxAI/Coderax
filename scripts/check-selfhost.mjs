#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function validateLoopbackOrigin(raw) {
  const url = new URL(raw);
  assert.equal(url.protocol, 'http:', 'The local release probe must use plain HTTP loopback');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Probe must use the local machine, not an untrusted remote URL');
  assert.equal(url.pathname, '/', 'Pass the service origin without a path');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return url.origin;
}

async function request(fetcher, origin, pathname, expectedType) {
  const response = await fetcher(origin + pathname, {
    method: 'GET',
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, `${pathname} returned HTTP ${response.status}`);
  assert.equal(response.headers.get('location'), null, `${pathname} unexpectedly redirected`);
  assert.match(response.headers.get('content-type') ?? '', expectedType, `${pathname} has the wrong content type`);
  const body = await response.text();
  assert.ok(Buffer.byteLength(body) <= 1024 * 1024, `${pathname} response exceeded 1 MiB`);
  return body;
}

export async function verifySelfHost(origin, fetcher = fetch) {
  const base = validateLoopbackOrigin(origin);
  const ready = await request(fetcher, base, '/readyz', /text\/plain/i);
  assert.equal(ready.trim(), 'OK', 'The full Express startup and readyz must be healthy');
  const configText = await request(fetcher, base, '/api/config', /application\/json/i);
  const config = JSON.parse(configText);
  assert.equal(typeof config.appTitle, 'string', '/api/config is not the actual Coderax API');
  assert.ok(config.appTitle.length > 0);
  const html = await request(fetcher, base, '/login', /text\/html/i);
  assert.match(html, /<html\b/i, 'The React SPA was not served by Express');
  return { ready: true, api: true, spa: true, appTitle: config.appTitle };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) {
      throw new Error('Usage: node scripts/check-selfhost.mjs http://127.0.0.1:3080');
    }
    console.log(JSON.stringify({ status: 'PASS', ...(await verifySelfHost(process.argv[2])) }));
  } catch (error) {
    console.error('Coderax self-host preflight FAIL:', error.message);
    process.exitCode = 1;
  }
}
