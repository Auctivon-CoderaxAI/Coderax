#!/usr/bin/env node
/**
 * Coderax deployment preflight, intentionally independent of npm dependencies.
 * A successful Vite build is NOT proof that the Express API is deployed.
 *
 * Usage:
 *   node scripts/verify-coderax-deployment.mjs --repo-only
 *   node scripts/verify-coderax-deployment.mjs --live-url https://coderax-ten.vercel.app
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const validateLiveURL = (value) => {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:', 'live URL must use HTTPS');
  assert.equal(url.username, '', 'live URL cannot embed credentials');
  assert.equal(url.password, '', 'live URL cannot embed credentials');
  assert.equal(url.search, '', 'live URL cannot include query credentials');
  assert.equal(url.hash, '', 'live URL cannot contain a fragment');
  assert.equal(url.pathname, '/', 'live URL must be a deployment origin');
  assert.ok(
    url.hostname.endsWith('.vercel.app') && url.hostname.startsWith('coderax-'),
    'live URL must be a Coderax Vercel deployment',
  );
  return url.origin;
};

export async function verifyRepositoryContracts(root = repoRoot) {
  const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const clientPackage = JSON.parse(await readFile(path.join(root, 'client/package.json'), 'utf8'));
  const vercel = JSON.parse(await readFile(path.join(root, 'client/vercel.json'), 'utf8'));
  assert.equal(typeof rootPackage.scripts?.frontend, 'string', 'root frontend script missing');
  assert.equal(typeof clientPackage.scripts?.frontend, 'string', 'client frontend script missing');
  assert.equal(typeof clientPackage.scripts?.build, 'string', 'client build script missing');
  assert.ok(
    vercel.rewrites?.some((rule) =>
      typeof rule.source === 'string' &&
      rule.source.includes('?!api') &&
      rule.destination === '/index.html'),
    'SPA routing must not swallow /api requests',
  );
  const services = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(services.services?.frontend?.framework, 'vite', 'frontend service not configured');
  assert.ok(services.services?.frontend?.rewrites?.some((r) => r.source === '/(.*)' && r.destination === '/index.html'), 'Vite SPA deep-link fallback missing inside frontend service');
  assert.equal(services.services?.backend?.framework, 'express', 'Express API service not configured');
  assert.equal(services.services?.backend?.entrypoint, 'api/server/index.js', 'backend entrypoint missing');
  assert.ok(services.rewrites?.some((r) => r.source === '/api/(.*)' && r.destination?.service === 'backend'), '/api not routed to backend service');
  assert.ok(services.rewrites?.some((r) => r.source === '/readyz' && r.destination?.service === 'backend'), 'readiness not routed to backend service');
  assert.ok(services.rewrites?.some((r) => r.source === '/(.*)' && r.destination?.service === 'frontend'), 'frontend catch-all missing');

  return { rootFrontend: true, clientFrontend: true, spaExcludesApi: true };
}

const readBounded = async (response, maxBytes = 1_048_576) => {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new Error('Response exceeds size limit');
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > maxBytes) throw new Error('Response exceeds size limit');
  return body;
};

const check = async (origin, route, checkResponse, fetcher = fetch) => {
  const response = await fetcher(origin + route, {
    method: 'GET',
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok(response.status < 300 && response.status >= 200, route + ' returned HTTP ' + response.status);
  assert.ok(!response.headers.get('location'), route + ' unexpectedly redirected');
  return checkResponse(response, await readBounded(response));
};

export async function verifyLiveBackend(value, fetcher = fetch) {
  const origin = validateLiveURL(value);
  await check(origin, '/readyz', (_response, body) => {
    assert.equal(body.trim(), 'OK', '/readyz must confirm Express startup');
  }, fetcher);
  const config = await check(origin, '/api/config', (response, body) => {
    assert.match(response.headers.get('content-type') || '', /application[/]json/i, 'API served HTML instead of JSON');
    const payload = JSON.parse(body);
    assert.equal(typeof payload.appTitle, 'string', 'missing application startup configuration');
    return payload;
  }, fetcher);
  await check(origin, '/login', (response, body) => {
    assert.match(response.headers.get('content-type') || '', /text[/]html/i);
    assert.match(body, /<html/i, 'login SPA is not served');
  }, fetcher);
  return { origin, readiness: 'OK', apiConfig: 'JSON', spa: 'HTML', appTitle: config.appTitle };
}

async function main() {
  const flag = process.argv[2];
  try {
    const result = await verifyRepositoryContracts();
    if (flag === '--repo-only') {
      console.log(JSON.stringify({ ok: true, repo: result }));
      return;
    }
    if (flag !== '--live-url' || !process.argv[3] || process.argv.length !== 4) {
      throw new Error('Use --repo-only or --live-url https://coderax-*.vercel.app');
    }
    const live = await verifyLiveBackend(process.argv[3]);
    console.log(JSON.stringify({ ok: true, repo: result, live }));
  } catch (error) {
    console.error('[Coderax release gate] FAILED:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
