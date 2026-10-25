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
  assert.equal(result.backendIncludesRateLimitRedis, true);
});

test('Vercel clean installs resolve root and workspace build tools', () => {
  const tools = { '@tsdown/css': '^0.22.2', tsdown: '^0.22.2', typescript: '^5.9.3', vite: '8.2.2' };
  const root = { devDependencies: tools };
  const client = { devDependencies: { tsdown: '^0.22.2' } };
  const api = { devDependencies: { tsdown: '^0.22.2' } };
  const frontend = { devDependencies: { 'cross-env': '^7.0.3' } };
  const lock = { packages: {
    '': { devDependencies: tools },
    client: { devDependencies: { 'cross-env': '^7.0.3' } },
    'node_modules/@tsdown/css': { version: '0.22.2' },
    'node_modules/cross-env': { version: '7.0.3' },
    'node_modules/tsdown': { version: '0.22.14' },
    'node_modules/typescript': { version: '5.9.3' },
    'node_modules/vite': { version: '8.2.2' },
    'packages/client': { devDependencies: { tsdown: '^0.22.2' } },
    'packages/api': { devDependencies: { tsdown: '^0.22.2' } },
    'packages/client/node_modules/tsdown': { version: '0.22.2' },
    'packages/api/node_modules/tsdown': { version: '0.22.2' },
  } };
  const services = { services: {
    frontend: { installCommand: 'cd .. && npm ci --include=dev' },
    backend: { installCommand: 'npm ci --include=dev' },
  } };

  assert.doesNotThrow(() => verifyWorkspaceBuildTooling(root, lock, client, api, services, frontend));
  assert.throws(
    () => verifyWorkspaceBuildTooling(root, { packages: { ...lock.packages, 'node_modules/tsdown': undefined } }, client, api, services, frontend),
    /root lockfile must resolve tsdown/,
  );
  assert.throws(
    () => verifyWorkspaceBuildTooling({ devDependencies: { tsdown: '^0.22.2', typescript: '^5.9.3' } }, lock, client, api, services, frontend),
    /Vercel root must declare @tsdown\/css/,
  );
  assert.throws(
    () => verifyWorkspaceBuildTooling(root, lock, { devDependencies: {} }, api, services, frontend),
    /packages\/client must declare tsdown/,
  );
  assert.throws(
    () => verifyWorkspaceBuildTooling(root, lock, client, api, { services: { ...services.services, backend: { installCommand: 'npm ci --include=dev --workspaces --include-workspace-root' } } }, frontend),
    /backend service must let npm ci resolve the repository's declared workspaces/,
  );
  assert.throws(
    () => verifyWorkspaceBuildTooling(root, lock, client, api, services, { devDependencies: {} }),
    /client frontend workspace must declare cross-env/,
  );
});

test('Vercel backend tracing requires lockfile-backed mathjs and rate-limit-redis runtime dependencies', () => {
  const version = '^15.2.0';
  const redisVersion = '^4.2.0';
  const root = { dependencies: { mathjs: version, 'rate-limit-redis': redisVersion } };
  const lock = { packages: { '': { dependencies: { mathjs: version, 'rate-limit-redis': redisVersion } }, 'node_modules/mathjs': { version: '15.2.0' }, 'node_modules/rate-limit-redis': { version: '4.2.0' } } };
  const api = { dependencies: { mathjs: version, 'rate-limit-redis': redisVersion }, peerDependencies: {} };
  const backend = { dependencies: { mathjs: version, 'rate-limit-redis': redisVersion } };

  assert.doesNotThrow(() => verifyVercelRuntimeDependency(root, lock, api, backend));
  assert.throws(
    () => verifyVercelRuntimeDependency({ dependencies: {} }, lock, api, backend),
    /Vercel root must declare mathjs/,
  );
  assert.throws(
    () => verifyVercelRuntimeDependency(root, { packages: {} }, api, backend),
    /root lockfile must include mathjs/,
  );
  assert.throws(
    () => verifyVercelRuntimeDependency(root, lock, { ...api, dependencies: { mathjs: version, 'rate-limit-redis': undefined } }, backend),
    /rate-limit-redis as a runtime dependency/,
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
