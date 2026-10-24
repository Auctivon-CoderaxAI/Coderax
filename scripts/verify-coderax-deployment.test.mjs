import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyApiBundle } from './verify-coderax-api-bundle.mjs';
import { validateLiveURL, verifyLiveBackend, verifyRepositoryContracts, verifyVercelRuntimeDependency } from './verify-coderax-deployment.mjs';

const headers = (type, extras = {}) => ({
  get(name) {
    const values = { 'content-type': type, ...extras };
    return values[name.toLowerCase()] ?? null;
  },
});

test('backend service builds its client shell and preserves API paths', async () => {
  const result = await verifyRepositoryContracts();
  assert.equal(result.spaExcludesApi, true);
  assert.equal(result.frontendIncludesBuildDependencies, true);
  assert.equal(result.backendIncludesClientBuild, true);
});

test('Vercel backend tracing requires a lockfile-backed root mathjs runtime dependency', () => {
  const version = '^15.2.0';
  const root = { dependencies: { mathjs: version } };
  const lock = { packages: { '': { dependencies: { mathjs: version } }, 'node_modules/mathjs': { version: '15.2.0' } } };
  const api = { dependencies: { mathjs: version } };
  const backend = { dependencies: { mathjs: version } };

  assert.doesNotThrow(() => verifyVercelRuntimeDependency(root, lock, api, backend));
  assert.throws(
    () => verifyVercelRuntimeDependency({ dependencies: {} }, lock, api, backend),
    /Vercel root must declare mathjs/,
  );
  assert.throws(
    () => verifyVercelRuntimeDependency(root, { packages: {} }, api, backend),
    /root lockfile must include mathjs/,
  );
});

test('compiled API bundle rejects unresolved mathjs even after a successful build', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'coderax-bundle-'));
  const dist = path.join(root, 'packages/api/dist');
  try {
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, 'index.cjs'), 'const math = require("mathjs");');
    await assert.rejects(verifyApiBundle(root), /still requires external mathjs/);
    await writeFile(path.join(dist, 'index.cjs'), 'exports.math = (n) => n;');
    assert.deepEqual(await verifyApiBundle(root), { filesScanned: 1, externalMathjs: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('only Coderax HTTPS Vercel origins are accepted as deployment checks', () => {
  assert.equal(validateLiveURL('https://coderax-ten.vercel.app'), 'https://coderax-ten.vercel.app');
  assert.throws(() => validateLiveURL('https://evil.example/'));
  assert.throws(() => validateLiveURL('http://coderax-ten.vercel.app/'));
  assert.throws(() => validateLiveURL('https://coderax-ten.vercel.app/?token=secret'));
});

test('rejects the broken configuration where /api/config is served as HTML', async () => {
  const fakeFetch = async (url) => {
    const isHealth = url.endsWith('/readyz');
    return {
      status: 200,
      headers: headers(isHealth ? 'text/plain' : 'text/html'),
      text: async () => isHealth ? 'OK' : '<html><body>Vite fallback</body></html>',
    };
  };
  await assert.rejects(
    verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch),
    /API served HTML instead of JSON/,
  );
});

test('rejects a green Vercel static deployment without an Express /readyz endpoint', async () => {
  const fakeFetch = async () => ({
    status: 404,
    headers: headers('text/plain'),
    text: async () => 'Not found',
  });
  await assert.rejects(
    verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch),
    /readyz returned HTTP 404/,
  );
});

test('accepts a real-shaped Express readiness, startup config and Vite shell', async () => {
  const fakeFetch = async (url) => ({
    status: 200,
    headers: headers(url.endsWith('/api/config') ? 'application/json' : url.endsWith('/login') ? 'text/html' : 'text/plain'),
    text: async () => url.endsWith('/readyz') ? 'OK' : url.endsWith('/api/config')
      ? JSON.stringify({ appTitle: 'Coderax' }) : '<html><body>Coderax</body></html>',
  });
  const result = await verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch);
  assert.equal(result.apiConfig, 'JSON');
  assert.equal(result.appTitle, 'Coderax');
});
