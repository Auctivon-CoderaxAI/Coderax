import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyApiBundle } from './verify-coderax-api-bundle.mjs';
import {
  assertAuthenticatedOrigin,
  buildVerificationReport,
  findMissingBuildTestFiles,
  parseArgs,
  resolveAuthenticatedE2eCredentials,
  resolveAuthenticatedOrigins,
  validateLiveURL,
  verifyAuthenticatedE2e,
  verifyDataSchemasModelsExport,
  verifyLiveBackend,
  verifyRepositoryContracts,
  verifyVercelAliasRuntimeDependencies,
  verifyVercelApiRuntimeDependencies,
  verifyVercelBackendBootstrapDependencies,
  verifyVercelBackendWorkspaceDependencies,
  verifyVercelClientShellAvailability,
  verifyVercelEntrypointRuntimeDependency,
  verifyVercelEntrypointDependency,
  verifyVercelOpenIdClientEsmCompatibility,
  verifyVercelRuntimeDependency,
  verifyWorkspaceBuildTooling,
} from './verify-coderax-deployment.mjs';

const contentTypeFor = (url) => {
  if (url.endsWith('/api/config')) return 'application/json';
  if (url.endsWith('/login')) return 'text/html';
  return 'text/plain';
};

const headers = (type, extras = {}) => ({
  get(name) {
    const values = { 'content-type': type, ...extras };
    return values[name.toLowerCase()] ?? null;
  },
});

test('client shell availability requires both independent guards', () => {
  const current = [
    "  const clientShellEnabled = process.env.SERVE_CLIENT !== 'false';",
    "  const indexPath = path.join(appConfig.paths.dist, 'index.html');",
    '  const clientShellAvailable = !process.env.VERCEL || fs.existsSync(indexPath);',
    '  const serveClientShell = clientShellEnabled && clientShellAvailable;',
    "  let indexHTML = serveClientShell ? fs.readFileSync(indexPath, 'utf8') : '';",
  ].join('\n');

  assert.doesNotThrow(() => verifyVercelClientShellAvailability(current));

  // The obsolete circular form was the assertion that broke against the split
  // guards; keeping it would make the verifier accept code that cannot boot.
  assert.throws(
    () =>
      verifyVercelClientShellAvailability(
        current.replace(
          'const clientShellAvailable = !process.env.VERCEL || fs.existsSync(indexPath);',
          'const clientShellAvailable = serveClientShell && (!process.env.VERCEL || fs.existsSync(indexPath));',
        ),
      ),
    /tolerate missing assets on Vercel/,
  );
  assert.throws(
    () =>
      verifyVercelClientShellAvailability(
        current.replace(
          'const serveClientShell = clientShellEnabled && clientShellAvailable;',
          'const serveClientShell = clientShellAvailable;',
        ),
      ),
    /must require SERVE_CLIENT and an available shell/,
  );
  assert.throws(
    () =>
      verifyVercelClientShellAvailability(
        current.replace("process.env.SERVE_CLIENT !== 'false'", 'false'),
      ),
    /must honor SERVE_CLIENT=false/,
  );
  assert.throws(
    () =>
      verifyVercelClientShellAvailability(
        current.replace(
          "let indexHTML = serveClientShell ? fs.readFileSync(indexPath, 'utf8') : '';",
          "let indexHTML = fs.readFileSync(indexPath, 'utf8');",
        ),
      ),
    /only be read when both guards allow serving it/,
  );
});

test('database startup tolerates an absent optional Mongoose telemetry export', async () => {
  const filename = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../api/db/connect.js',
  );
  const source = await readFile(filename, 'utf8');

  for (const hasTelemetry of [false, true])
    for (const hasLogger of [false, true]) {
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
      vm.runInNewContext(
        source,
        {
          module,
          global: {},
          console: {
            warn(message) {
              warnings.push(message);
            },
            error() {},
            info() {},
          },
          process: {
            env: {
              MONGO_URI: 'mongodb://localhost/coderax-test',
              MONGO_AUTO_INDEX: ' true ',
              MONGO_AUTO_CREATE: 'false',
            },
          },
          require(name) {
            if (name === 'dotenv') return { config() {} };
            if (name === 'mongoose') return mongoose;
            if (name === '@coderax/data-schemas') {
              return hasLogger
                ? {
                    logger: {
                      warn(message) {
                        warnings.push(message);
                      },
                      error() {},
                      info() {},
                    },
                  }
                : {};
            }
            if (name === '@coderax/api')
              return {
                optionalEnabled: () => undefined,
                ...(hasTelemetry
                  ? {
                      instrumentMongooseQueryMetrics(value) {
                        assert.equal(value, mongoose);
                        called = true;
                      },
                    }
                  : {}),
              };
            throw new Error('Unexpected import: ' + name);
          },
        },
        { filename },
      );

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

test('Vercel build commands name only test files that exist', () => {
  const services = {
    services: {
      frontend: {
        root: 'client',
        buildCommand:
          'cd .. && npm run frontend && cd client && npm run test:ci -- --runInBand src/routes/__tests__/Gone.spec.tsx src/Kept.spec.tsx',
      },
      backend: {
        root: '.',
        buildCommand:
          'npm run build:api && cd packages/api && npm run test:ci -- src/work/models.spec.ts && cd ../.. && node --test api/server/routes/__tests__/workChat.test.js scripts/verify-coderax-deployment.test.mjs',
      },
    },
  };
  const present = new Set([
    'client/src/Kept.spec.tsx',
    'packages/api/src/work/models.spec.ts',
    'api/server/routes/__tests__/workChat.test.js',
    'scripts/verify-coderax-deployment.test.mjs',
  ]);

  assert.deepEqual(
    findMissingBuildTestFiles(services, (file) => present.has(file)),
    ['frontend: client/src/routes/__tests__/Gone.spec.tsx'],
  );
  assert.deepEqual(
    findMissingBuildTestFiles(services, () => true),
    [],
  );
});

test('Vercel uses a narrow authenticated proxy instead of booting the database API', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const vercelPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vercel.json');
  const config = JSON.parse(await readFile(vercelPath, 'utf8'));
  assert.equal(config.services.backend.entrypoint, 'api/proxy.js');
  assert.equal(config.services.backend.functions?.['api/proxy.js']?.maxDuration, 300);
  assert.equal(
    config.services.backend.functions?.['api/proxy.js']?.includeFiles,
    '{api/proxy.js,packages/api/dist/proxy.cjs,packages/api/dist/proxy.bundle.cjs,packages/api/dist/rolldown-runtime-*.cjs}',
  );
  const apiPackagePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../packages/api/package.json',
  );
  const apiPackage = JSON.parse(await readFile(apiPackagePath, 'utf8'));
  assert.match(apiPackage.scripts.build, /normalize-cjs-runtime\.mjs dist\/proxy\.cjs/);
  assert.equal(
    config.rewrites.find((item) => item.source === '/readyz')?.destination?.service,
    'backend',
  );
});

test('CI rejects undeclared root tsdown resolution and missing workspace build tools', () => {
  const client = { devDependencies: { tsdown: '^0.22.2' } };
  const api = { devDependencies: { tsdown: '^0.22.2' } };
  const services = {
    services: {
      frontend: { installCommand: 'cd .. && npm ci --include=dev' },
      backend: { installCommand: 'npm ci --include=dev' },
    },
  };
  const lock = {
    packages: {
      '': { devDependencies: {} },
      'packages/client': { devDependencies: { tsdown: '^0.22.2' } },
      'packages/api': { devDependencies: { tsdown: '^0.22.2' } },
      'packages/client/node_modules/tsdown': { version: '0.22.2' },
      'packages/api/node_modules/tsdown': { version: '0.22.2' },
    },
  };
  const root = { devDependencies: {} };
  assert.doesNotThrow(() => verifyWorkspaceBuildTooling(root, lock, client, api, services));
  assert.throws(
    () =>
      verifyWorkspaceBuildTooling(
        { devDependencies: { ...root.devDependencies, tsdown: '^0.22.2' } },
        lock,
        client,
        api,
        services,
      ),
    /root tsdown manifest and lockfile/,
  );
  assert.throws(
    () =>
      verifyWorkspaceBuildTooling(
        root,
        { packages: { ...lock.packages, 'packages/client/node_modules/tsdown': undefined } },
        client,
        api,
        services,
      ),
    /packages.client tsdown package must be resolved/,
  );
  assert.throws(
    () =>
      verifyWorkspaceBuildTooling(root, lock, client, api, {
        services: { ...services.services, backend: { installCommand: 'npm ci --omit=dev' } },
      }),
    /backend service must install workspace development/,
  );
});

test('Vercel backend tracing requires root runtime dependencies for API workspace peers', () => {
  const mathjs = '^15.2.0';
  const redis = '^4.2.0';
  const sdk = '^1.30.0';
  const root = {
    dependencies: { mathjs, 'rate-limit-redis': redis, '@modelcontextprotocol/sdk': sdk },
  };
  const lock = {
    packages: {
      '': { dependencies: { mathjs, 'rate-limit-redis': redis, '@modelcontextprotocol/sdk': sdk } },
      api: {
        dependencies: { mathjs, 'rate-limit-redis': redis, '@modelcontextprotocol/sdk': sdk },
      },
      'node_modules/mathjs': { version: '15.2.0' },
      'node_modules/rate-limit-redis': { version: '4.2.0' },
      'node_modules/@modelcontextprotocol/sdk': { version: '1.30.0' },
    },
  };
  const api = {
    dependencies: { mathjs, 'rate-limit-redis': redis, '@modelcontextprotocol/sdk': sdk },
  };
  const backend = {
    dependencies: { mathjs, 'rate-limit-redis': redis, '@modelcontextprotocol/sdk': sdk },
  };

  assert.doesNotThrow(() => {
    verifyVercelRuntimeDependency(root, lock, api, backend, 'mathjs');
    verifyVercelRuntimeDependency(root, lock, api, backend, 'rate-limit-redis');
    verifyVercelRuntimeDependency(root, lock, api, backend, '@modelcontextprotocol/sdk');
  });
  assert.throws(
    () =>
      verifyVercelRuntimeDependency(
        { dependencies: { mathjs } },
        lock,
        api,
        backend,
        'rate-limit-redis',
      ),
    /Vercel root must declare rate-limit-redis/,
  );
  assert.throws(
    () => verifyVercelRuntimeDependency(root, { packages: {} }, api, backend, 'rate-limit-redis'),
    /root lockfile must include rate-limit-redis/,
  );
  assert.throws(
    () =>
      verifyVercelRuntimeDependency(
        root,
        { packages: { ...lock.packages, api: { dependencies: {} } } },
        api,
        backend,
        'helmet',
      ),
    /@coderax\/api must declare helmet/,
  );
  assert.throws(
    () =>
      verifyVercelRuntimeDependency(
        root,
        lock,
        { dependencies: { mathjs }, peerDependencies: { '@modelcontextprotocol/sdk': sdk } },
        backend,
        '@modelcontextprotocol/sdk',
      ),
    /@coderax\/api must declare @modelcontextprotocol\/sdk as a dependency/,
  );
});

test('Vercel traces every direct API runtime dependency from the root and server workspace', () => {
  const api = { dependencies: { mathjs: '^15.2.0', helmet: '^8.3.0' } };
  const backend = { dependencies: { mathjs: '^15.2.0', helmet: '^8.3.0' } };
  const root = { dependencies: { mathjs: '^15.2.0', helmet: '^8.3.0' } };
  const lock = {
    packages: {
      '': { dependencies: root.dependencies },
      api: { dependencies: backend.dependencies },
      'node_modules/mathjs': { version: '15.2.0' },
      'node_modules/helmet': { version: '8.3.0' },
    },
  };
  assert.deepEqual(verifyVercelApiRuntimeDependencies(root, lock, api, backend), [
    'helmet',
    'mathjs',
  ]);
  assert.throws(
    () =>
      verifyVercelApiRuntimeDependencies(
        { dependencies: { mathjs: '^15.2.0' } },
        lock,
        api,
        backend,
      ),
    /Vercel root must declare helmet/,
  );
  assert.throws(
    () =>
      verifyVercelApiRuntimeDependencies(
        root,
        { packages: { ...lock.packages, api: { dependencies: { mathjs: '^15.2.0' } } } },
        api,
        backend,
      ),
    /Express lockfile must include helmet/,
  );
});

test('Vercel root traces third-party dependencies imported by the backend bootstrap', () => {
  const dependencies = { eventsource: '^3.0.2' };
  const root = { dependencies };
  const backend = { dependencies };
  const lock = {
    packages: {
      '': { dependencies },
      api: { dependencies },
      'node_modules/eventsource': { version: '3.0.2' },
    },
  };
  assert.deepEqual(
    verifyVercelBackendBootstrapDependencies(
      root,
      lock,
      backend,
      "const { EventSource } = require('eventsource');",
    ),
    ['eventsource'],
  );
  assert.throws(
    () =>
      verifyVercelBackendBootstrapDependencies(
        { dependencies: {} },
        lock,
        backend,
        "require('eventsource');",
      ),
    /Vercel root must declare bootstrap dependency eventsource/,
  );
  assert.throws(
    () =>
      verifyVercelBackendBootstrapDependencies(
        root,
        { packages: { ...lock.packages, api: { dependencies: {} } } },
        backend,
        "require('eventsource');",
      ),
    /Express lockfile must include bootstrap dependency eventsource/,
  );
});

test('Vercel statically traces EventSource imported by the Express entrypoint', () => {
  assert.equal(
    verifyVercelEntrypointDependency(
      "global.EventSource = require('eventsource').EventSource;",
      'eventsource',
    ),
    'eventsource',
  );
  assert.equal(
    verifyVercelEntrypointDependency("require('lodash/partialRight');", 'lodash/partialRight'),
    'lodash/partialRight',
  );
  assert.throws(
    () => verifyVercelEntrypointDependency("require('~/config');", 'eventsource'),
    /must directly import eventsource/,
  );
});

test('Vercel traces module-alias dependencies from the backend entrypoint', () => {
  const dependencies = { eventsource: '^3.0.2', lodash: '^4.17.23' };
  const root = { dependencies };
  const backend = { dependencies };
  const lock = {
    packages: {
      '': { dependencies },
      api: { dependencies },
      'node_modules/eventsource': { version: '3.0.2' },
      'node_modules/lodash': { version: '4.17.23' },
    },
  };

  assert.deepEqual(
    verifyVercelEntrypointRuntimeDependency(
      root,
      lock,
      backend,
      "require('lodash/partialRight');",
      'lodash/partialRight',
    ),
    'lodash',
  );
  assert.throws(
    () =>
      verifyVercelEntrypointRuntimeDependency(
        { dependencies: { eventsource: dependencies.eventsource } },
        lock,
        backend,
        "require('lodash/partialRight');",
        'lodash/partialRight',
      ),
    /Vercel root must declare entrypoint dependency lodash/,
  );
});

test('Vercel file markers trace alias-hidden packages without loading them', () => {
  const dependencies = {
    nodemailer: '^10.0.2',
    'zod-to-json-schema': '^3.25.1',
  };
  const backend = { dependencies };
  const lock = {
    packages: {
      api: { dependencies },
      'node_modules/nodemailer': { version: '10.0.2' },
      'node_modules/zod-to-json-schema': { version: '3.25.1' },
    },
  };
  const source = ["require.resolve('nodemailer');", "require.resolve('zod-to-json-schema');"].join(
    '\n',
  );

  assert.deepEqual(verifyVercelAliasRuntimeDependencies(lock, backend, source), [
    'nodemailer',
    'zod-to-json-schema',
  ]);
  assert.throws(
    () =>
      verifyVercelAliasRuntimeDependencies(
        { packages: { api: { dependencies } } },
        backend,
        source,
      ),
    /lockfile must resolve alias-hidden dependency nodemailer/,
  );
});

test('Vercel traces @librechat/agents subpaths used by module-aliased backend files', async () => {
  const traceFile = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../api/server/vercel-trace-dependencies.js',
  );
  const source = await readFile(traceFile, 'utf8');
  const resolve = createRequire(import.meta.url).resolve;
  const specifiers = [
    '@librechat/agents',
    '@librechat/agents/langchain/messages',
    '@librechat/agents/langchain/prompts',
    '@librechat/agents/langchain/tools',
    '@librechat/agents/langchain/utils/env',
    '@librechat/agents/openai',
  ];

  for (const specifier of specifiers) {
    assert.ok(source.includes(`require.resolve('${specifier}')`), `Vercel must trace ${specifier}`);
    assert.doesNotThrow(() => resolve(specifier), `Express dependencies must resolve ${specifier}`);
  }
});

test('Vercel CommonJS backend loads the ESM OpenID client dynamically', () => {
  const sources = {
    'api/strategies/openidStrategy.js': 'loadOpenIdClient()',
    'api/server/routes/oauth.js': 'loadOpenIdClient()',
  };
  const loader = "import('openid-client'); import('openid-client/passport');";

  assert.deepEqual(
    verifyVercelOpenIdClientEsmCompatibility(sources, loader),
    Object.keys(sources).sort(),
  );
  assert.throws(
    () =>
      verifyVercelOpenIdClientEsmCompatibility(
        { ...sources, 'api/server/routes/oauth.js': "require('openid-client')" },
        loader,
      ),
    /cannot synchronously require the ESM-only openid-client package/,
  );
  assert.throws(
    () => verifyVercelOpenIdClientEsmCompatibility(sources, "require('openid-client')"),
    /OpenID loader must use import\(\)/,
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
  const lock = {
    packages: {
      '': { dependencies },
      api: { dependencies },
      'node_modules/@coderax/api': { resolved: 'packages/api', link: true },
      'node_modules/@coderax/data-schemas': { resolved: 'packages/data-schemas', link: true },
      'node_modules/coderax-data-provider': { resolved: 'packages/data-provider', link: true },
      'packages/api': { version: '1.0.0' },
      'packages/data-schemas': { version: '1.0.0' },
      'packages/data-provider': { version: '1.0.0' },
    },
  };
  assert.deepEqual(verifyVercelBackendWorkspaceDependencies(root, lock, backend), [
    '@coderax/api',
    '@coderax/data-schemas',
    'coderax-data-provider',
  ]);
  assert.throws(
    () => verifyVercelBackendWorkspaceDependencies({ dependencies: {} }, lock, backend),
    /Vercel root must declare workspace dependency @coderax\/api/,
  );
  assert.throws(
    () =>
      verifyVercelBackendWorkspaceDependencies(
        root,
        {
          packages: {
            ...lock.packages,
            'node_modules/@coderax/data-schemas': { resolved: 'packages/data-schemas' },
          },
        },
        backend,
      ),
    /must resolve as an npm workspace link/,
  );
});

test('data-schemas exposes the dedicated models entry to CommonJS and ESM consumers', () => {
  const dataSchemas = {
    exports: {
      './models': {
        require: { default: './dist/createModels.cjs', types: './dist/createModels.d.cts' },
        import: { default: './dist/createModels.mjs', types: './dist/createModels.d.mts' },
      },
    },
  };
  assert.equal(verifyDataSchemasModelsExport(dataSchemas), true);
  assert.throws(
    () => verifyDataSchemasModelsExport({ exports: {} }),
    /CommonJS models export is missing/,
  );
  assert.throws(
    () =>
      verifyDataSchemasModelsExport({
        exports: { './models': { require: { default: './dist/index.cjs' } } },
      }),
    /CommonJS models export is missing/,
  );
});

test('compiled API bundle rejects missing mathjs, SDK and eventsource imports', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'coderax-bundle-'));
  const dist = path.join(root, 'packages/api/dist');
  try {
    await mkdir(dist, { recursive: true });
    await mkdir(path.join(root, 'api'), { recursive: true });
    await writeFile(
      path.join(root, 'packages/api/package.json'),
      JSON.stringify({
        dependencies: { helmet: '^8.3.0' },
        peerDependencies: { 'custom-runtime-addon': '^1.0.0' },
      }),
    );
    await writeFile(path.join(root, 'api/package.json'), JSON.stringify({ dependencies: {} }));
    await writeFile(path.join(dist, 'index.cjs'), 'const math = require("mathjs");');
    await assert.rejects(verifyApiBundle(root), /still requires external mathjs/);
    await writeFile(
      path.join(dist, 'index.cjs'),
      'const sdk = require("@modelcontextprotocol/sdk/types.js");',
    );
    await assert.rejects(verifyApiBundle(root), /still requires external MCP SDK/);
    await writeFile(path.join(dist, 'index.cjs'), 'const source = require("eventsource");');
    await assert.rejects(verifyApiBundle(root), /external MCP SDK transport dependency/);
    await writeFile(path.join(dist, 'index.cjs'), 'const parser = require("eventsource-parser");');
    await assert.rejects(verifyApiBundle(root), /external MCP SDK transport dependency/);
    await writeFile(
      path.join(dist, 'index.cjs'),
      'const passkey = require("@simplewebauthn/server");',
    );
    await assert.rejects(verifyApiBundle(root), /external WebAuthn server/);
    for (const dependency of [
      '@hexagon/base64',
      '@levischuck/tiny-cbor',
      '@peculiar/asn1-schema',
      '@peculiar/x509',
      'reflect-metadata',
    ]) {
      await writeFile(path.join(dist, 'index.cjs'), `const missing = require("${dependency}");`);
      await assert.rejects(verifyApiBundle(root), /external WebAuthn runtime dependency/);
    }
    for (const dependency of [
      'helmet',
      'express-rate-limit',
      'croner',
      '@langchain/langgraph-checkpoint-mongodb',
      'rate-limit-redis',
    ]) {
      await writeFile(path.join(dist, 'index.cjs'), `const missing = require("${dependency}");`);
      await assert.rejects(verifyApiBundle(root), /external @coderax\/api production dependency/);
    }
    await writeFile(
      path.join(dist, 'index.cjs'),
      'const missing = require("custom-runtime-addon");',
    );
    await assert.rejects(
      verifyApiBundle(root),
      /external Vercel-untraced dependency custom-runtime-addon/,
    );
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
  assert.equal(validateLiveURL('https://coderaxai.vercel.app'), 'https://coderaxai.vercel.app');
  assert.throws(() => validateLiveURL('https://coderaxai.vercel.app.evil.example/'));
  assert.throws(() => validateLiveURL('https://xcoderaxai.vercel.app/'));
  assert.throws(() => validateLiveURL('https://evil.example/'));
  assert.throws(() => validateLiveURL('http://coderax-ten.vercel.app/'));
  assert.throws(() => validateLiveURL('https://coderax-ten.vercel.app/?token=secret'));
});

test('authenticated E2E sends credentials only to exact allowlisted origins', async () => {
  assert.throws(
    () => assertAuthenticatedOrigin('https://coderax-ten.vercel.app', {}),
    /not allowlisted/,
  );
  assert.equal(assertAuthenticatedOrigin('https://coderaxai.vercel.app', {}), undefined);
  assert.equal(
    assertAuthenticatedOrigin('https://coderax-ten.vercel.app', {
      CODERAX_AUTHENTICATED_ORIGINS: 'https://coderax-ten.vercel.app',
    }),
    undefined,
  );
  assert.ok(
    resolveAuthenticatedOrigins({
      CODERAX_AUTHENTICATED_ORIGINS:
        'https://coderax-ten.vercel.app, https://coderax-owner.vercel.app',
    }).has('https://coderax-owner.vercel.app'),
  );
  assert.throws(
    () =>
      resolveAuthenticatedOrigins({
        CODERAX_AUTHENTICATED_ORIGINS: 'https://coderax-ten.vercel.app/',
      }),
    /exact HTTPS origins/,
  );
  assert.throws(
    () =>
      resolveAuthenticatedOrigins({
        CODERAX_AUTHENTICATED_ORIGINS: 'http://coderax-ten.vercel.app',
      }),
    /exact HTTPS origins/,
  );

  let ran = false;
  await assert.rejects(
    verifyAuthenticatedE2e('https://coderax-ten.vercel.app', {
      env: { CODERAX_SMOKE_TOKEN: 'token' },
      run: async () => {
        ran = true;
      },
    }),
    /not allowlisted/,
  );
  assert.equal(ran, false, 'the smoke must not run for an origin that is not allowlisted');
});

test('rejects the broken configuration where /api/config is served as HTML', async () => {
  const fakeFetch = async (url) => {
    const isHealth = url.endsWith('/readyz');
    return {
      status: 200,
      headers: headers(isHealth ? 'text/plain' : 'text/html'),
      text: async () => (isHealth ? 'OK' : '<html><body>Vite fallback</body></html>'),
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

const deployedCommit = '6673992ff2e08664f2869da4fda822c964ea58f1';

test('accepts a real-shaped deployment that identifies its full commit', async () => {
  const fakeFetch = async (url) => ({
    status: 200,
    headers: headers(contentTypeFor(url)),
    text: async () => {
      if (url.endsWith('/readyz')) return 'OK';
      if (url.endsWith('/api/config')) {
        return JSON.stringify({ appTitle: 'Coderax', buildInfo: { commit: deployedCommit } });
      }
      return '<html><body>Coderax</body></html>';
    },
  });
  const result = await verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch);
  assert.equal(result.apiConfig, 'JSON');
  assert.equal(result.appTitle, 'Coderax');
  assert.equal(result.deployedCommit, deployedCommit);
  assert.equal(result.expectedCommit, null);
  assert.equal(result.backendRevisionVerified, true);
});

test('rejects a live deployment whose commit cannot be identified', async () => {
  const fakeFetch = (buildInfo) => async (url) => ({
    status: 200,
    headers: headers(contentTypeFor(url)),
    text: async () => {
      if (url.endsWith('/readyz')) return 'OK';
      if (url.endsWith('/api/config')) {
        return JSON.stringify({ appTitle: 'Coderax', ...(buildInfo ? { buildInfo } : {}) });
      }
      return '<html><body>Coderax</body></html>';
    },
  });

  await assert.rejects(
    verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch()),
    /deployed commit cannot be identified/,
  );
  await assert.rejects(
    verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch({ commit: '6673992f' })),
    /deployed commit cannot be identified/,
  );
  await assert.rejects(
    verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch({ commit: null })),
    /deployed commit cannot be identified/,
  );
});

test('keeps repository, deployment and authenticated E2E verification distinct', () => {
  assert.deepEqual(buildVerificationReport({ repository: 'verified' }), {
    repository: 'verified',
    deployment: 'not-run',
    authenticatedE2E: 'not-run',
  });
  assert.deepEqual(
    buildVerificationReport({
      repository: 'verified',
      deployment: 'verified',
      authenticatedE2E: 'verified',
    }),
    { repository: 'verified', deployment: 'verified', authenticatedE2E: 'verified' },
  );
  assert.throws(
    () => buildVerificationReport({ repository: 'verified', authenticatedE2E: 'verified' }),
    /authenticated E2E verification requires deployment verification/,
  );
  assert.throws(
    () => buildVerificationReport({ repository: 'failed', deployment: 'verified' }),
    /status must be "verified" or "not-run"/,
  );
});

test('verification modes cannot be conflated on the command line', () => {
  assert.equal(parseArgs(['--repo-only']).mode, 'repository');
  assert.equal(parseArgs(['--live-url', 'https://coderax-ten.vercel.app']).mode, 'deployment');
  assert.equal(
    parseArgs([
      '--live-url',
      'https://coderax-ten.vercel.app',
      '--expected-backend-revision',
      deployedCommit,
    ]).expectedBackendRevision,
    deployedCommit,
  );
  assert.equal(
    parseArgs(['--live-url', 'https://coderax-ten.vercel.app', '--authenticated-e2e'])
      .authenticatedE2e,
    true,
  );
  assert.throws(() => parseArgs([]), /choose --repo-only or --live-url/);
  assert.throws(
    () => parseArgs(['--repo-only', '--authenticated-e2e']),
    /deployment flags need --live-url/,
  );
  assert.throws(() => parseArgs(['--authenticated-e2e']), /needs --live-url/);
  assert.throws(
    () =>
      parseArgs([
        '--live-url',
        'https://coderax-ten.vercel.app',
        '--expected-backend-revision',
        '6673992f',
      ]),
    /must be a full 40-character commit/,
  );
  assert.throws(() => parseArgs(['--unknown']), /unknown argument/);
});

test('authenticated E2E verification fails closed without credentials', async () => {
  assert.throws(
    () => resolveAuthenticatedE2eCredentials({}),
    /requires CODERAX_SMOKE_TOKEN or both .*CODERAX_SMOKE_EMAIL.*CODERAX_SMOKE_PASSWORD/,
  );
  assert.throws(
    () => resolveAuthenticatedE2eCredentials({ CODERAX_SMOKE_EMAIL: 'owner@example.test' }),
    /missing CODERAX_SMOKE_PASSWORD/,
  );
  assert.deepEqual(resolveAuthenticatedE2eCredentials({ CODERAX_SMOKE_TOKEN: 'token' }), {
    method: 'token',
  });
  assert.deepEqual(
    resolveAuthenticatedE2eCredentials({
      CODERAX_SMOKE_EMAIL: 'owner@example.test',
      CODERAX_SMOKE_PASSWORD: 'secret',
    }),
    { method: 'password' },
  );

  let ran = false;
  await assert.rejects(
    verifyAuthenticatedE2e('https://coderaxai.vercel.app', {
      env: {},
      run: async () => {
        ran = true;
      },
    }),
    /No authenticated verification was performed/,
  );
  assert.equal(ran, false, 'the smoke must not run without credentials');

  const result = await verifyAuthenticatedE2e('https://coderaxai.vercel.app', {
    env: { CODERAX_SMOKE_TOKEN: 'token' },
    run: async (origin, env) => {
      assert.equal(origin, 'https://coderaxai.vercel.app');
      assert.equal(env.CODERAX_BASE_URL, origin);
      assert.equal(env.CODERAX_SMOKE_TOKEN, 'token');
    },
  });
  assert.deepEqual(result, {
    status: 'verified',
    method: 'token',
    origin: 'https://coderaxai.vercel.app',
  });
});

test('requires a matching backend-reported revision when the gate is requested', async () => {
  const expected = deployedCommit;
  const old = '71fbdbaa2dfed54055b92357d375db41e593a90f';
  const fakeFetch = (commit) => async (url) => ({
    status: 200,
    headers: headers(contentTypeFor(url)),
    text: async () => {
      if (url.endsWith('/readyz')) return 'OK';
      if (url.endsWith('/api/config')) {
        return JSON.stringify({
          appTitle: 'Coderax',
          ...(commit === undefined ? {} : { buildInfo: { commit } }),
        });
      }
      return '<html><body>Coderax</body></html>';
    },
  });
  await assert.rejects(
    verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch(old), expected),
    /does not match expected revision/,
  );
  await assert.rejects(
    verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch(), expected),
    /missing a full backend-reported buildInfo.commit/,
  );
  await assert.rejects(
    verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch('6673992f'), expected),
    /missing a full backend-reported buildInfo.commit/,
  );
  await assert.rejects(
    verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch(expected), '6673992f'),
    /expected backend revision must be a full 40-character commit/,
  );
  assert.equal(
    (await verifyLiveBackend('https://coderax-ten.vercel.app', fakeFetch(expected), expected))
      .backendRevisionVerified,
    true,
  );
});
