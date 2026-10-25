import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyApiBundle } from './verify-coderax-api-bundle.mjs';
import { validateLiveURL, verifyDataSchemasModelsExport, verifyLiveBackend, verifyRepositoryContracts, verifyVercelApiRuntimeDependencies, verifyVercelBackendBootstrapDependencies, verifyVercelBackendWorkspaceDependencies, verifyVercelEntrypointDependency, verifyVercelRuntimeDependency, verifyWorkspaceBuildTooling } from './verify-coderax-deployment.mjs';

const headers = (type, extras = {}) => ({
  get(name) {
    const values = { 'content-type': type, ...extras };
    return values[name.toLowerCase()] ?? null;
  },
});

test('database startup tolerates an absent optional Mongoose telemetry export', async () => {
  const filename = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../api/db/connect.js');
  const source = await readFile(filename, 'utf8');

  for (const hasTelemetry of [false, true]) for (const hasLogger of [false, true]) {
    const warnings = [];
    let called = false;
    let mongoOptions;
    const mongoose = {
      connection: { on() {} },
      set() {},
      async connect(_uri, options) {
        mongoOptions = options;
        return mongoose;
      },
    };
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module,
      global: {},
      console: { warn(message) { warnings.push(message); }, error() {}, info() {} },
      process: { env: { MONGO_URI: 'mongodb://localhost/coderax-test', MONGO_AUTO_INDEX: ' true ', MONGO_AUTO_CREATE: 'false' } },
      require(name) {
        if (name === 'dotenv') return { config() {} };
        if (name === 'mongoose') return mongoose;
        if (name === '@coderax/data-schemas') {
          return hasLogger ? { logger: { warn(message) { warnings.push(message); }, error() {}, info() {} } } : {};
        }
        if (name === '@coderax/api') return {
          optionalEnabled: () => undefined,
          ...(hasTelemetry ? { instrumentMongooseQueryMetrics(value) {
            assert.equal(value, mongoose);
            called = true;
          } } : {}),
        };
        throw new Error('Unexpected import: ' + name);
      },
    }, { filename });

    assert.equal(typeof module.exports.connectDb, 'function');
    await module.exports.connectDb();
    assert.equal(mongoOptions.autoIndex, true);
    assert.equal(mongoOptions.autoCreate, false);
    assert.equal(called, hasTelemetry);
    assert.equal(warnings.length, hasTelemetry ? 0 : 1);
  }
});

test('Vercel routes the client and API through separate services', async () => {
  const result = await verifyRepositoryContracts();
  assert.equal(result.spaExcludesApi, true);
  assert.equal(result.frontendIncludesBuildDependencies, true);
  assert.equal(result.backendExcludesFrontendBuild, true);
});


test('Vercel packages CommonJS module-alias source files needed by Express', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const vercelPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vercel.json');
  const config = JSON.parse(await readFile(vercelPath, 'utf8'));
  assert.equal(config.services.backend.entrypoint, 'api/server/index.js');
  assert.equal(
    config.services.backend.functions?.['api/server/index.js']?.includeFiles,
    '{api/**/*,packages/api/dist/**/*,packages/data-provider/dist/**/*,packages/data-schemas/dist/**/*}',
  );
  assert.equal(config.rewrites.find((item) => item.source === '/readyz')?.destination?.service, 'backend');
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
    api: { dependencies: { mathjs, 'rate-limit-redis': redis, '@modelcontextprotocol/sdk': sdk } },
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
    () => verifyVercelRuntimeDependency(root, { packages: { ...lock.packages, api: { dependencies: {} } } }, api, backend, 'helmet'),
    /@coderax\/api must declare helmet/,
  );
  assert.throws(
    () => verifyVercelRuntimeDependency(root, lock, { dependencies: { mathjs }, peerDependencies: { '@modelcontextprotocol/sdk': sdk } }, backend, '@modelcontextprotocol/sdk'),
    /@coderax\/api must declare @modelcontextprotocol\/sdk as a dependency/,
  );
});

test('Vercel traces every direct API runtime dependency from the root and server workspace', () => {
  const api = { dependencies: { mathjs: '^15.2.0', helmet: '^8.3.0' } };
  const backend = { dependencies: { mathjs: '^15.2.0', helmet: '^8.3.0' } };
  const root = { dependencies: { mathjs: '^15.2.0', helmet: '^8.3.0' } };
  const lock = { packages: {
    '': { dependencies: root.dependencies },
    api: { dependencies: backend.dependencies },
    'node_modules/mathjs': { version: '15.2.0' },
    'node_modules/helmet': { version: '8.3.0' },
  } };
  assert.deepEqual(verifyVercelApiRuntimeDependencies(root, lock, api, backend), ['helmet', 'mathjs']);
  assert.throws(
    () => verifyVercelApiRuntimeDependencies({ dependencies: { mathjs: '^15.2.0' } }, lock, api, backend),
    /Vercel root must declare helmet/,
  );
  assert.throws(
    () => verifyVercelApiRuntimeDependencies(root, { packages: { ...lock.packages, api: { dependencies: { mathjs: '^15.2.0' } } } }, api, backend),
    /Express lockfile must include helmet/,
  );
});

test('Vercel root traces third-party dependencies imported by the backend bootstrap', () => {
  const dependencies = { eventsource: '^3.0.2' };
  const root = { dependencies };
  const backend = { dependencies };
  const lock = { packages: {
    '': { dependencies },
    api: { dependencies },
    'node_modules/eventsource': { version: '3.0.2' },
  } };
  assert.deepEqual(
    verifyVercelBackendBootstrapDependencies(root, lock, backend, "const { EventSource } = require('eventsource');"),
    ['eventsource'],
  );
  assert.throws(
    () => verifyVercelBackendBootstrapDependencies({ dependencies: {} }, lock, backend, "require('eventsource');"),
    /Vercel root must declare bootstrap dependency eventsource/,
  );
  assert.throws(
    () => verifyVercelBackendBootstrapDependencies(root, { packages: { ...lock.packages, api: { dependencies: {} } } }, backend, "require('eventsource');"),
    /Express lockfile must include bootstrap dependency eventsource/,
  );
});

test('Vercel statically traces EventSource imported by the Express entrypoint', () => {
  assert.equal(verifyVercelEntrypointDependency("global.EventSource = require('eventsource').EventSource;", 'eventsource'), 'eventsource');
  assert.throws(
    () => verifyVercelEntrypointDependency("require('~/config');", 'eventsource'),
    /must directly import eventsource/,
  );
});

test('Vercel root resolves every local workspace used by the Express backend', () => {
  const dependencies = {
    '@coderax/api': '*',
    '@coderax/data-schemas': '*',
    'coderax-data-provider': '*',
  };
  const root = { dependencies };
  const backend = { dependencies };
  const lock = { packages: {
    '': { dependencies },
    api: { dependencies },
    'node_modules/@coderax/api': { resolved: 'packages/api', link: true },
    'node_modules/@coderax/data-schemas': { resolved: 'packages/data-schemas', link: true },
    'node_modules/coderax-data-provider': { resolved: 'packages/data-provider', link: true },
    'packages/api': { version: '1.0.0' },
    'packages/data-schemas': { version: '1.0.0' },
    'packages/data-provider': { version: '1.0.0' },
  } };
  assert.deepEqual(
    verifyVercelBackendWorkspaceDependencies(root, lock, backend),
    ['@coderax/api', '@coderax/data-schemas', 'coderax-data-provider'],
  );
  assert.throws(
    () => verifyVercelBackendWorkspaceDependencies({ dependencies: {} }, lock, backend),
    /Vercel root must declare workspace dependency @coderax\/api/,
  );
  assert.throws(
    () => verifyVercelBackendWorkspaceDependencies(root, { packages: { ...lock.packages, 'node_modules/@coderax/data-schemas': { resolved: 'packages/data-schemas' } } }, backend),
    /must resolve as an npm workspace link/,
  );
});

test('data-schemas exposes the dedicated models entry to CommonJS and ESM consumers', () => {
  const dataSchemas = { exports: { './models': {
    require: { default: './dist/createModels.cjs', types: './dist/createModels.d.cts' },
    import: { default: './dist/createModels.mjs', types: './dist/createModels.d.mts' },
  } } };
  assert.equal(verifyDataSchemasModelsExport(dataSchemas), true);
  assert.throws(() => verifyDataSchemasModelsExport({ exports: {} }), /CommonJS models export is missing/);
  assert.throws(
    () => verifyDataSchemasModelsExport({ exports: { './models': { require: { default: './dist/index.cjs' } } } }),
    /CommonJS models export is missing/,
  );
});

test('compiled API bundle rejects missing mathjs, SDK and eventsource imports', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'coderax-bundle-'));
  const dist = path.join(root, 'packages/api/dist');
  try {
    await mkdir(dist, { recursive: true });
    await mkdir(path.join(root, 'api'), { recursive: true });
    await writeFile(path.join(root, 'packages/api/package.json'), JSON.stringify({ dependencies: { helmet: '^8.3.0' }, peerDependencies: { 'custom-runtime-addon': '^1.0.0' } }));
    await writeFile(path.join(root, 'api/package.json'), JSON.stringify({ dependencies: {} }));
    await writeFile(path.join(dist, 'index.cjs'), 'const math = require("mathjs");');
    await assert.rejects(verifyApiBundle(root), /still requires external mathjs/);
    await writeFile(path.join(dist, 'index.cjs'), 'const sdk = require("@modelcontextprotocol/sdk/types.js");');
    await assert.rejects(verifyApiBundle(root), /still requires external MCP SDK/);
    await writeFile(path.join(dist, 'index.cjs'), 'const source = require("eventsource");');
    await assert.rejects(verifyApiBundle(root), /external MCP SDK transport dependency/);
    await writeFile(path.join(dist, 'index.cjs'), 'const parser = require("eventsource-parser");');
    await assert.rejects(verifyApiBundle(root), /external MCP SDK transport dependency/);
    await writeFile(path.join(dist, 'index.cjs'), 'const passkey = require("@simplewebauthn/server");');
    await assert.rejects(verifyApiBundle(root), /external WebAuthn server/);
    for (const dependency of ['@hexagon/base64', '@levischuck/tiny-cbor', '@peculiar/asn1-schema', '@peculiar/x509', 'reflect-metadata']) {
      await writeFile(path.join(dist, 'index.cjs'), `const missing = require("${dependency}");`);
      await assert.rejects(verifyApiBundle(root), /external WebAuthn runtime dependency/);
    }
    for (const dependency of ['helmet', 'express-rate-limit', 'croner', '@langchain/langgraph-checkpoint-mongodb', 'rate-limit-redis']) {
      await writeFile(path.join(dist, 'index.cjs'), `const missing = require("${dependency}");`);
      await assert.rejects(verifyApiBundle(root), /external @coderax\/api production dependency/);
    }
    await writeFile(path.join(dist, 'index.cjs'), 'const missing = require("custom-runtime-addon");');
    await assert.rejects(verifyApiBundle(root), /external Vercel-untraced dependency custom-runtime-addon/);
    await writeFile(path.join(dist, 'index.cjs'), 'exports.math = (n) => n;');
    assert.deepEqual(await verifyApiBundle(root), {
      filesScanned: 1,
      externalMathjs: false,
      externalMcpSdk: false,
      externalMcpTransitive: false,
      externalWebauthn: false,
      externalWebauthnRuntime: false,
      externalDirectRuntime: false,
      externalVercelUntracedRuntimeDependencies: [],
    });
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
