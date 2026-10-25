import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyApiBundle } from './verify-coderax-api-bundle.mjs';
import { validateLiveURL, verifyLiveBackend, verifyRepositoryContracts, verifyVercelRuntimeDependency, verifyWorkspaceBuildTooling } from './verify-coderax-deployment.mjs';

const headers = (type, extras = {}) => ({
  get(name) {
    const values = { 'content-type': type, ...extras };
    return values[name.toLowerCase()] ?? null;
  },
});

test('Vercel routes the client and API through separate services', async () => {
  const result = await verifyRepositoryContracts();
  assert.equal(result.spaExcludesApi, true);
  assert.equal(result.frontendIncludesBuildDependencies, true);
  assert.equal(result.backendExcludesFrontendBuild, true);
});


test('CI rejects undeclared root tsdown resolution and missing workspace build tools', () => {
  const client = { devDependencies: { tsdown: '^0.22.2' } };
  const api = { devDependencies: { tsdown: '^0.22.2' } };
  const services = { services: {
    frontend: { installCommand: 'cd .. && npm ci --include=dev' },
    backend: { installCommand: 'npm ci --include=dev' },
  } };
  const lock = { packages: {
    '': { devDependencies: {} },
    'packages/client': { devDependencies: { tsdown: '^0.22.2' } },
    'packages/api': { devDependencies: { tsdown: '^0.22.2' } },
    'packages/client/node_modules/tsdown': { version: '0.22.2' },
    'packages/api/node_modules/tsdown': { version: '0.22.2' },
  } };
  const root = { devDependencies: {} };
  assert.doesNotThrow(() => verifyWorkspaceBuildTooling(root, lock, client, api, services));
  assert.throws(
    () => verifyWorkspaceBuildTooling({ devDependencies: { ...root.devDependencies, tsdown: '^0.22.2' } }, lock, client, api, services),
    /root tsdown manifest and lockfile/,
  );
  assert.throws(
    () => verifyWorkspaceBuildTooling(root, { packages: { ...lock.packages, 'packages/client/node_modules/tsdown': undefined } }, client, api, services),
    /packages.client tsdown package must be resolved/,
  );
  assert.throws(
    () => verifyWorkspaceBuildTooling(root, lock, client, api, { services: { ...services.services, backend: { installCommand: 'npm ci --omit=dev' } } }),
    /backend service must install workspace development/,
  );
});

test('Vercel backend tracing requires root runtime dependencies for API workspace peers', () => {
  const mathjs = '^15.2.0';
  const redis = '^4.2.0';
  const sdk = '^1.30.0';
  const root = { dependencies: { mathjs, 'rate-limit-redis': redis, '@modelcontextprotocol/sdk': sdk } };
  const lock = { packages: {
    '': { dependencies: { mathjs, 'rate-limit-redis': redis, '@modelcontextprotocol/sdk': sdk } },
    'node_modules/mathjs': { version: '15.2.0' },
    'node_modules/rate-limit-redis': { version: '4.2.0' },
    'node_modules/@modelcontextprotocol/sdk': { version: '1.30.0' },
  } };
  const api = { dependencies: { mathjs, 'rate-limit-redis': redis, '@modelcontextprotocol/sdk': sdk } };
  const backend = { dependencies: { mathjs, 'rate-limit-redis': redis, '@modelcontextprotocol/sdk': sdk } };

  assert.doesNotThrow(() => {
    verifyVercelRuntimeDependency(root, lock, api, backend, 'mathjs');
    verifyVercelRuntimeDependency(root, lock, api, backend, 'rate-limit-redis');
    verifyVercelRuntimeDependency(root, lock, api, backend, '@modelcontextprotocol/sdk');
  });
  assert.throws(
    () => verifyVercelRuntimeDependency({ dependencies: { mathjs } }, lock, api, backend, 'rate-limit-redis'),
    /Vercel root must declare rate-limit-redis/,
  );
  assert.throws(
    () => verifyVercelRuntimeDependency(root, { packages: {} }, api, backend, 'rate-limit-redis'),
    /root lockfile must include rate-limit-redis/,
  );
  assert.throws(
    () => verifyVercelRuntimeDependency(root, lock, { dependencies: { mathjs }, peerDependencies: { '@modelcontextprotocol/sdk': sdk } }, backend, '@modelcontextprotocol/sdk'),
    /@coderax\/api must declare @modelcontextprotocol\/sdk as a dependency/,
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
