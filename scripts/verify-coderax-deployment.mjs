#!/usr/bin/env node
/**
 * Coderax deployment preflight, intentionally independent of npm dependencies.
 * A successful Vite build is NOT proof that the Express API is deployed.
 *
 * Usage:
 *   node scripts/verify-coderax-deployment.mjs --repo-only
 *   node scripts/verify-coderax-deployment.mjs --live-url https://coderax-ten.vercel.app [--expected-backend-revision <full-commit>]
 *   node scripts/verify-coderax-deployment.mjs --live-url https://coderax-ten.vercel.app --authenticated-e2e
 *
 * Repository verification, deployment verification and authenticated E2E
 * verification are separate levels. --repo-only never contacts a deployment;
 * --live-url always requires the deployment to identify its full commit; and
 * --authenticated-e2e fails closed when the deployment smoke credentials are
 * absent.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
  const isPreviewAlias =
    url.hostname.startsWith('coderax-') && url.hostname.endsWith('.vercel.app');
  // coderaxai.vercel.app is the project's assigned production alias. It does
  // not match the coderax-<preview> pattern, but it is an owner-controlled
  // origin, so preflight must be able to verify it.
  const isProductionAlias = url.hostname === 'coderaxai.vercel.app';
  assert.ok(isPreviewAlias || isProductionAlias, 'live URL must be a Coderax Vercel deployment');
  return url.origin;
};

// A name that looks like a Coderax preview project is not proof of ownership,
// and Vercel derives preview hostnames from project names. Authenticated smoke
// runs send real credentials, so the destination must be an exact allowlisted
// origin; an operator adds a preview origin explicitly when it is theirs.
const DEFAULT_AUTHENTICATED_ORIGINS = ['https://coderaxai.vercel.app'];

/** Resolve the exact HTTPS origins allowed to receive authenticated E2E credentials. */
export function resolveAuthenticatedOrigins(env = process.env) {
  const configured =
    typeof env.CODERAX_AUTHENTICATED_ORIGINS === 'string'
      ? env.CODERAX_AUTHENTICATED_ORIGINS.split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  const origins = new Set(DEFAULT_AUTHENTICATED_ORIGINS);
  for (const value of configured) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('CODERAX_AUTHENTICATED_ORIGINS must list exact HTTPS origins');
    }
    if (url.protocol !== 'https:' || url.origin !== value) {
      throw new Error('CODERAX_AUTHENTICATED_ORIGINS must list exact HTTPS origins');
    }
    origins.add(value);
  }
  return origins;
}

/** Refuse to send credentials to an origin that is not explicitly owner-controlled. */
export function assertAuthenticatedOrigin(origin, env = process.env) {
  if (!resolveAuthenticatedOrigins(env).has(origin)) {
    throw new Error(
      `authenticated E2E verification is restricted to explicit owner-controlled origins; ${origin} is not allowlisted. ` +
        'Set CODERAX_AUTHENTICATED_ORIGINS to the exact HTTPS origin.',
    );
  }
}

/**
 * Vercel Services traces the backend entrypoint from the repository root.
 * Keep a runtime dependency used by @coderax/api visible to the root tracer,
 * rather than relying solely on npm workspace hoisting.
 */
export function verifyVercelRuntimeDependency(rootPackage, lock, apiPackage, backendPackage, name) {
  const required = apiPackage.dependencies?.[name];
  assert.equal(typeof required, 'string', `@coderax/api must declare ${name} as a dependency`);
  assert.equal(
    backendPackage.dependencies?.[name],
    required,
    `Express ${name} version must match @coderax/api`,
  );
  assert.equal(
    rootPackage.dependencies?.[name],
    required,
    `Vercel root must declare ${name} for function tracing`,
  );
  assert.equal(
    lock.packages?.['']?.dependencies?.[name],
    required,
    `root lockfile must include ${name} for npm ci`,
  );
  assert.equal(
    lock.packages?.api?.dependencies?.[name],
    required,
    `Express lockfile must include ${name} for npm ci`,
  );
  assert.ok(lock.packages?.[`node_modules/${name}`]?.version, `lockfile must resolve ${name}`);
}

/** Keep every API runtime dependency visible to Vercel's root function tracer. */
export function verifyVercelApiRuntimeDependencies(rootPackage, lock, apiPackage, backendPackage) {
  const dependencies = Object.keys(apiPackage.dependencies ?? {}).sort();
  assert.ok(dependencies.length > 0, '@coderax/api runtime dependencies are missing');
  for (const name of dependencies) {
    verifyVercelRuntimeDependency(rootPackage, lock, apiPackage, backendPackage, name);
  }
  return dependencies;
}

/** Keep third-party imports used by the backend bootstrap visible to Vercel's
 * root tracer. Workspace imports are verified separately below.
 */
export function verifyVercelBackendBootstrapDependencies(
  rootPackage,
  lock,
  backendPackage,
  source,
) {
  const imports = [...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1])
    .filter((name) => !name.startsWith('.') && !name.startsWith('node:'))
    .filter((name) => !['@coderax/api', 'coderax-data-provider'].includes(name));

  for (const name of imports) {
    const required = backendPackage.dependencies?.[name];
    assert.equal(typeof required, 'string', `Express must declare bootstrap dependency ${name}`);
    assert.equal(
      rootPackage.dependencies?.[name],
      required,
      `Vercel root must declare bootstrap dependency ${name}`,
    );
    assert.equal(
      lock.packages?.['']?.dependencies?.[name],
      required,
      `root lockfile must include bootstrap dependency ${name}`,
    );
    assert.equal(
      lock.packages?.api?.dependencies?.[name],
      required,
      `Express lockfile must include bootstrap dependency ${name}`,
    );
    assert.ok(
      lock.packages?.[`node_modules/${name}`]?.version,
      `lockfile must resolve bootstrap dependency ${name}`,
    );
  }
  return [...new Set(imports)].sort();
}

/** Keep dependencies hidden behind module-alias visible to Vercel's static
 * function tracer by importing them directly from the Express entrypoint.
 */
export function verifyVercelEntrypointDependency(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    source,
    new RegExp(`\\brequire\\s*\\(\\s*['"]${escaped}['"]\\s*\\)`),
    `Vercel function entrypoint must directly import ${name} so it is traced`,
  );
  return name;
}

/** Keep a dependency hidden behind module-alias traceable from the Vercel root. */
export function verifyVercelEntrypointRuntimeDependency(
  rootPackage,
  lock,
  backendPackage,
  source,
  specifier,
) {
  verifyVercelEntrypointDependency(source, specifier);
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  const required = backendPackage.dependencies?.[name];
  assert.equal(typeof required, 'string', `Express must declare entrypoint dependency ${name}`);
  assert.equal(
    rootPackage.dependencies?.[name],
    required,
    `Vercel root must declare entrypoint dependency ${name}`,
  );
  assert.equal(
    lock.packages?.['']?.dependencies?.[name],
    required,
    `root lockfile must include entrypoint dependency ${name}`,
  );
  assert.equal(
    lock.packages?.api?.dependencies?.[name],
    required,
    `Express lockfile must include entrypoint dependency ${name}`,
  );
  assert.ok(
    lock.packages?.[`node_modules/${name}`]?.version,
    `lockfile must resolve entrypoint dependency ${name}`,
  );
  return name;
}

/** Verify package markers for dependencies that Vercel cannot reach through
 * module-alias. The marker uses require.resolve so tracing does not eagerly
 * initialize optional providers and authentication integrations.
 */
export function verifyVercelAliasRuntimeDependencies(lock, backendPackage, source) {
  const specifiers = [...source.matchAll(/\brequire\.resolve\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (match) => match[1],
  );
  assert.ok(specifiers.length > 0, 'Vercel alias-hidden runtime dependency markers are missing');
  for (const specifier of specifiers) {
    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    const required = backendPackage.dependencies?.[name];
    assert.equal(
      typeof required,
      'string',
      `Express must declare alias-hidden runtime dependency ${name}`,
    );
    assert.equal(
      lock.packages?.api?.dependencies?.[name],
      required,
      `Express lockfile must include alias-hidden dependency ${name}`,
    );
    assert.ok(
      lock.packages?.[`api/node_modules/${name}`]?.version ||
        lock.packages?.[`node_modules/${name}`]?.version,
      `lockfile must resolve alias-hidden dependency ${name}`,
    );
  }
  return [
    ...new Set(
      specifiers.map((specifier) =>
        specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0],
      ),
    ),
  ].sort();
}

/** openid-client v6 is ESM; backend CommonJS modules must reach it through import(). */
export function verifyVercelOpenIdClientEsmCompatibility(sources, loaderSource) {
  const directRequire = /\brequire\s*\(\s*['"]openid-client(?:\/passport)?['"]\s*\)/;
  for (const [filename, source] of Object.entries(sources)) {
    assert.doesNotMatch(
      source,
      directRequire,
      `${filename} cannot synchronously require the ESM-only openid-client package`,
    );
  }
  assert.match(
    loaderSource,
    /\bimport\s*\(\s*['"]openid-client['"]\s*\)/,
    'OpenID loader must use import()',
  );
  assert.match(
    loaderSource,
    /\bimport\s*\(\s*['"]openid-client\/passport['"]\s*\)/,
    'OpenID Passport loader must use import()',
  );
  return Object.keys(sources).sort();
}

/** Make the local packages consumed by Express visible from the Vercel root. */
export function verifyVercelBackendWorkspaceDependencies(rootPackage, lock, backendPackage) {
  const workspaces = {
    '@coderax/api': 'packages/api',
    '@coderax/data-schemas': 'packages/data-schemas',
    'coderax-data-provider': 'packages/data-provider',
  };
  for (const [name, workspace] of Object.entries(workspaces)) {
    const required = backendPackage.dependencies?.[name];
    assert.equal(typeof required, 'string', `Express must declare workspace dependency ${name}`);
    assert.equal(
      rootPackage.dependencies?.[name],
      required,
      `Vercel root must declare workspace dependency ${name}`,
    );
    assert.equal(
      lock.packages?.['']?.dependencies?.[name],
      required,
      `root lockfile must include workspace ${name}`,
    );
    assert.equal(
      lock.packages?.api?.dependencies?.[name],
      required,
      `Express lockfile must include workspace ${name}`,
    );
    assert.equal(
      lock.packages?.[`node_modules/${name}`]?.link,
      true,
      `${name} must resolve as an npm workspace link`,
    );
    assert.ok(lock.packages?.[workspace], `lockfile is missing workspace ${workspace}`);
  }
  return Object.keys(workspaces);
}

/** Ensure model bootstrap has a dedicated CommonJS/ESM workspace export. */
export function verifyDataSchemasModelsExport(dataSchemasPackage) {
  const modelExport = dataSchemasPackage.exports?.['./models'];
  assert.equal(
    modelExport?.require?.default,
    './dist/createModels.cjs',
    'data-schemas CommonJS models export is missing',
  );
  assert.equal(
    modelExport?.require?.types,
    './dist/createModels.d.cts',
    'data-schemas CommonJS models types are missing',
  );
  assert.equal(
    modelExport?.import?.default,
    './dist/createModels.mjs',
    'data-schemas ESM models export is missing',
  );
  assert.equal(
    modelExport?.import?.types,
    './dist/createModels.d.mts',
    'data-schemas ESM models types are missing',
  );
  return true;
}

/** Validate installed workspace build tools rather than declaring untraced root
 * versions. A root tsdown range without a root lockfile package breaks npm ci.
 */
const buildTestFile = /\.(?:spec|test)\.[cm]?[jt]sx?$/;

/**
 * Lists test files named by a Vercel service build command that are absent from
 * the repository; Jest exits non-zero when an explicit path matches nothing.
 */
export function findMissingBuildTestFiles(services, exists) {
  const missing = [];
  for (const [name, service] of Object.entries(services.services ?? {})) {
    let cwd = service.root ?? '.';
    for (const step of (service.buildCommand ?? '').split('&&')) {
      const [command, ...args] = step.trim().split(/\s+/);
      if (command === 'cd') {
        cwd = path.posix.join(cwd, args[0] ?? '.');
        continue;
      }
      for (const arg of args) {
        const file = path.posix.join(cwd, arg);
        if (buildTestFile.test(arg) && !exists(file)) {
          missing.push(`${name}: ${file}`);
        }
      }
    }
  }
  return missing;
}

export function verifyWorkspaceBuildTooling(
  rootPackage,
  lock,
  clientPackage,
  apiPackage,
  services,
) {
  for (const name of ['tsdown', 'typescript']) {
    if (rootPackage.devDependencies?.[name] !== undefined) {
      assert.equal(
        lock.packages?.['']?.devDependencies?.[name],
        rootPackage.devDependencies[name],
        `root ${name} manifest and lockfile must match for npm ci`,
      );
      assert.ok(
        lock.packages?.[`node_modules/${name}`]?.version,
        `root ${name} is not resolved: pin and regenerate the lockfile or use workspace dependencies`,
      );
    }
  }

  for (const [workspace, pkg] of [
    ['packages/client', clientPackage],
    ['packages/api', apiPackage],
  ]) {
    assert.equal(typeof pkg.devDependencies?.tsdown, 'string', `${workspace} must declare tsdown`);
    assert.equal(
      lock.packages?.[workspace]?.devDependencies?.tsdown,
      pkg.devDependencies.tsdown,
      `${workspace} tsdown must match the npm lockfile`,
    );
    assert.ok(
      lock.packages?.[`${workspace}/node_modules/tsdown`]?.version ||
        lock.packages?.['node_modules/tsdown']?.version,
      `${workspace} tsdown package must be resolved in the npm lockfile`,
    );
  }

  for (const [name, service] of Object.entries({
    frontend: services.services?.frontend,
    backend: services.services?.backend,
  })) {
    assert.match(
      service?.installCommand ?? '',
      /npm ci --include=dev/,
      `${name} service must install workspace development build tools`,
    );
  }
}
/**
 * The shell has two independent guards: SERVE_CLIENT=false disables it outright,
 * and a Vercel service without built client assets must still boot the API. The
 * served shell is their conjunction; reading index.html before that check would
 * crash the API on a frontend-only deployment.
 */
export function verifyVercelClientShellAvailability(source) {
  assert.match(
    source,
    /\bconst\s+clientShellEnabled\s*=\s*process\.env\.SERVE_CLIENT\s*!==\s*'false'\s*;/,
    'Client shell must honor SERVE_CLIENT=false',
  );
  assert.match(
    source,
    /\bconst\s+indexPath\s*=\s*path\.join\([^;]*?['"]index\.html['"]\s*\)\s*;/,
    'Client shell must resolve its index.html path',
  );
  assert.match(
    source,
    /\bconst\s+clientShellAvailable\s*=\s*!\s*process\.env\.VERCEL\s*\|\|\s*fs\.existsSync\(\s*indexPath\s*\)\s*;/,
    'Client shell availability must tolerate missing assets on Vercel',
  );
  assert.match(
    source,
    /\bconst\s+serveClientShell\s*=\s*clientShellEnabled\s*&&\s*clientShellAvailable\s*;/,
    'Serving the client shell must require SERVE_CLIENT and an available shell',
  );
  assert.match(
    source,
    /\blet\s+indexHTML\s*=\s*serveClientShell\s*\?\s*fs\.readFileSync\(\s*indexPath\s*,\s*['"]utf8['"]\s*\)\s*:\s*['"]{2}\s*;/,
    'Client shell HTML must only be read when both guards allow serving it',
  );
}

export async function verifyRepositoryContracts(root = repoRoot) {
  const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const clientPackage = JSON.parse(await readFile(path.join(root, 'client/package.json'), 'utf8'));
  const workspaceClientPackage = JSON.parse(
    await readFile(path.join(root, 'packages/client/package.json'), 'utf8'),
  );
  const apiPackage = JSON.parse(
    await readFile(path.join(root, 'packages/api/package.json'), 'utf8'),
  );
  const dataSchemasPackage = JSON.parse(
    await readFile(path.join(root, 'packages/data-schemas/package.json'), 'utf8'),
  );
  const backendPackage = JSON.parse(await readFile(path.join(root, 'api/package.json'), 'utf8'));
  const backendSource = await readFile(path.join(root, 'api/server/index.js'), 'utf8');
  const backendAliasTraceSource = await readFile(
    path.join(root, 'api/server/vercel-trace-dependencies.js'),
    'utf8',
  );
  const backendBootstrapSource = await readFile(path.join(root, 'api/config/index.js'), 'utf8');
  const openIdRuntimePaths = [
    'api/strategies/openidStrategy.js',
    'api/server/routes/oauth.js',
    'api/server/routes/admin/auth.js',
    'api/server/services/OpenIDSessionRefresh.js',
    'api/server/services/OboTokenService.js',
    'api/server/services/GraphApiService.js',
    'api/server/utils/openIdClient.js',
  ];
  const openIdRuntimeSources = Object.fromEntries(
    await Promise.all(
      openIdRuntimePaths.map(async (filename) => [
        filename,
        await readFile(path.join(root, filename), 'utf8'),
      ]),
    ),
  );
  const openIdLoaderSource = await readFile(
    path.join(root, 'packages/api/src/auth/openid/client.ts'),
    'utf8',
  );
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  verifyVercelEntrypointDependency(backendSource, './vercel-trace-dependencies');
  const backendAliasRuntimeDependencies = verifyVercelAliasRuntimeDependencies(
    lock,
    backendPackage,
    backendAliasTraceSource,
  );
  const openIdClientEsmSafeSources = verifyVercelOpenIdClientEsmCompatibility(
    openIdRuntimeSources,
    openIdLoaderSource,
  );
  const backendEntrypointDependencies = [
    verifyVercelEntrypointRuntimeDependency(
      rootPackage,
      lock,
      backendPackage,
      backendSource,
      'eventsource',
    ),
    verifyVercelEntrypointRuntimeDependency(
      rootPackage,
      lock,
      backendPackage,
      backendSource,
      'lodash/partialRight',
    ),
  ];
  const apiRuntimeDependencies = verifyVercelApiRuntimeDependencies(
    rootPackage,
    lock,
    apiPackage,
    backendPackage,
  );
  const backendBootstrapDependencies = verifyVercelBackendBootstrapDependencies(
    rootPackage,
    lock,
    backendPackage,
    backendBootstrapSource,
  );
  const backendWorkspaceDependencies = verifyVercelBackendWorkspaceDependencies(
    rootPackage,
    lock,
    backendPackage,
  );
  verifyDataSchemasModelsExport(dataSchemasPackage);
  const vercel = JSON.parse(await readFile(path.join(root, 'client/vercel.json'), 'utf8'));
  assert.equal(typeof rootPackage.scripts?.frontend, 'string', 'root frontend script missing');
  assert.equal(typeof clientPackage.scripts?.frontend, 'string', 'client frontend script missing');
  assert.equal(typeof clientPackage.scripts?.build, 'string', 'client build script missing');
  verifyVercelClientShellAvailability(backendSource);
  assert.ok(
    vercel.rewrites?.some(
      (rule) =>
        typeof rule.source === 'string' &&
        rule.source.includes('?!api') &&
        rule.destination === '/index.html',
    ),
    'SPA routing must not swallow /api requests',
  );
  const services = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.deepEqual(
    findMissingBuildTestFiles(services, (file) => existsSync(path.join(root, file))),
    [],
    'Vercel build commands must only name test files that exist',
  );
  assert.equal(services.services?.frontend?.framework, 'vite', 'frontend service not configured');
  assert.ok(
    services.services?.frontend?.rewrites?.some(
      (r) => r.source === '/(.*)' && r.destination === '/index.html',
    ),
    'Vite SPA deep-link fallback missing inside frontend service',
  );
  assert.match(
    services.services?.frontend?.installCommand ?? '',
    /npm ci --include=dev/,
    'frontend service must install the build toolchain used by the client package',
  );
  assert.equal(
    services.services?.backend?.framework,
    'express',
    'Express API proxy service not configured',
  );
  assert.equal(
    services.services?.backend?.entrypoint,
    'api/proxy.js',
    'backend proxy entrypoint missing',
  );
  assert.ok(
    Number.isInteger(services.services?.backend?.functions?.['api/proxy.js']?.maxDuration) &&
      services.services.backend.functions['api/proxy.js'].maxDuration >= 60 &&
      services.services.backend.functions['api/proxy.js'].maxDuration <= 300,
    'backend proxy must allow streaming within the Vercel Hobby function limit',
  );
  assert.equal(
    services.services?.backend?.functions?.['api/proxy.js']?.includeFiles,
    '{api/proxy.js,packages/api/dist/proxy.cjs,packages/api/dist/proxy.bundle.cjs,packages/api/dist/rolldown-runtime-*.cjs}',
    'Vercel backend must include the small proxy entrypoint and compiled TypeScript handler',
  );
  const proxySource = await readFile(path.join(root, 'api/proxy.js'), 'utf8');
  const proxyHandlerSource = await readFile(path.join(root, 'packages/api/src/proxy.ts'), 'utf8');
  const apiPackageSource = await readFile(path.join(root, 'packages/api/package.json'), 'utf8');
  assert.match(
    apiPackageSource,
    /normalize-cjs-runtime\.mjs dist\/proxy\.cjs/,
    'API build must normalize the proxy CommonJS entrypoint for Vercel',
  );
  assert.match(
    proxySource,
    /require\(['"]@coderax\/api\/proxy['"]\)/,
    'Express wiring must load the TypeScript API workspace export',
  );
  assert.match(
    apiPackageSource,
    /"\.\/proxy"\s*:/,
    'API workspace must export the compiled proxy entry',
  );
  assert.match(
    proxyHandlerSource,
    /CODERAX_API_ORIGIN/,
    'proxy must require a configured API origin',
  );
  assert.match(
    proxyHandlerSource,
    /CODERAX_PROXY_SECRET/,
    'proxy must require a private origin secret',
  );
  assert.match(proxyHandlerSource, /function isApiPath/, 'proxy must allowlist forwarded routes');
  assert.match(
    proxyHandlerSource,
    /response\.on\('error'/,
    'proxy must handle upstream response stream errors',
  );
  assert.doesNotMatch(
    proxySource + proxyHandlerSource,
    /api\/server\/index/,
    'Vercel proxy must not start the database-backed API locally',
  );
  assert.match(
    services.services?.backend?.buildCommand ?? '',
    /npm run build:api/,
    'Vercel must build the TypeScript proxy workspace before bundling',
  );
  assert.doesNotMatch(
    services.services?.backend?.buildCommand ?? '',
    /\bnpm run build:client(?:-package)?\b/,
    'backend service must not build frontend assets owned by the frontend service',
  );
  verifyWorkspaceBuildTooling(rootPackage, lock, workspaceClientPackage, apiPackage, services);
  assert.ok(
    services.rewrites?.some(
      (r) => r.source === '/api/(.*)' && r.destination?.service === 'backend',
    ),
    '/api not routed to backend service',
  );
  assert.ok(
    services.rewrites?.some((r) => r.source === '/readyz' && r.destination?.service === 'backend'),
    'readiness not routed to backend service',
  );
  assert.ok(
    services.rewrites?.some((r) => r.source === '/(.*)' && r.destination?.service === 'frontend'),
    'frontend catch-all missing',
  );

  return {
    rootFrontend: true,
    clientFrontend: true,
    spaExcludesApi: true,
    frontendIncludesBuildDependencies: true,
    backendExcludesFrontendBuild: true,
    backendApiProxy: true,
    apiRuntimeDependencyCount: apiRuntimeDependencies.length,
    backendBootstrapDependencies,
    backendEntrypointDependencies,
    backendAliasRuntimeDependencies,
    openIdClientEsmSafeSources: openIdClientEsmSafeSources.length,
    backendWorkspaceDependencies: backendWorkspaceDependencies.length,
    dataSchemasModelsExport: true,
  };
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
  assert.ok(
    response.status < 300 && response.status >= 200,
    route + ' returned HTTP ' + response.status,
  );
  assert.ok(!response.headers.get('location'), route + ' unexpectedly redirected');
  return checkResponse(response, await readBounded(response));
};

export async function verifyLiveBackend(value, fetcher = fetch, expectedBackendRevision) {
  if (expectedBackendRevision !== undefined) {
    assert.match(
      expectedBackendRevision,
      /^[a-f0-9]{40}$/i,
      'expected backend revision must be a full 40-character commit',
    );
  }
  const origin = validateLiveURL(value);
  await check(
    origin,
    '/readyz',
    (_response, body) => {
      assert.equal(body.trim(), 'OK', '/readyz must confirm Express startup');
    },
    fetcher,
  );
  const config = await check(
    origin,
    '/api/config',
    (response, body) => {
      assert.match(
        response.headers.get('content-type') || '',
        /application[/]json/i,
        'API served HTML instead of JSON',
      );
      const payload = JSON.parse(body);
      assert.equal(typeof payload.appTitle, 'string', 'missing application startup configuration');
      return payload;
    },
    fetcher,
  );
  const actual = config.buildInfo?.commit;
  assert.ok(
    typeof actual === 'string' && /^[a-f0-9]{40}$/i.test(actual),
    '/api/config is missing a full backend-reported buildInfo.commit; the deployed commit cannot be identified',
  );
  const deployedCommit = actual.toLowerCase();
  if (expectedBackendRevision !== undefined) {
    assert.equal(
      deployedCommit,
      expectedBackendRevision.toLowerCase(),
      'backend-reported buildInfo.commit does not match expected revision',
    );
  }
  await check(
    origin,
    '/login',
    (response, body) => {
      assert.match(response.headers.get('content-type') || '', /text[/]html/i);
      assert.match(body, /<html/i, 'login SPA is not served');
    },
    fetcher,
  );
  return {
    origin,
    readiness: 'OK',
    apiConfig: 'JSON',
    spa: 'HTML',
    appTitle: config.appTitle,
    deployedCommit,
    expectedCommit: expectedBackendRevision?.toLowerCase() ?? null,
    backendRevisionVerified: true,
  };
}

export const USAGE = `Usage:
  node scripts/verify-coderax-deployment.mjs --repo-only
  node scripts/verify-coderax-deployment.mjs --live-url <https-origin> [--expected-backend-revision <full-commit>]
  node scripts/verify-coderax-deployment.mjs --live-url <https-origin> --authenticated-e2e

Verification levels (they are not interchangeable):
  --repo-only   Repository contracts only. Contacts no deployment.
  --live-url    Deployment verification: /readyz, /api/config, the SPA and the
                full backend-reported commit. Fails when the deployed commit
                cannot be identified.
  --authenticated-e2e
                Also run the authenticated deployment smoke. Requires
                CODERAX_SMOKE_TOKEN or CODERAX_SMOKE_EMAIL and
                CODERAX_SMOKE_PASSWORD, and an origin listed exactly in
                CODERAX_AUTHENTICATED_ORIGINS (the production alias is
                always allowed). Missing credentials fail the run.

  --expected-backend-revision <full-commit>
                Require /api/config to report this exact commit.
  --help, -h    Show this message.`;

export function parseArgs(argv) {
  const options = {
    mode: null,
    liveUrl: null,
    expectedBackendRevision: null,
    authenticatedE2e: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--repo-only') {
      if (options.mode !== null) throw new Error('choose exactly one verification mode');
      options.mode = 'repository';
    } else if (argument === '--live-url') {
      if (options.mode !== null) throw new Error('choose exactly one verification mode');
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--') || value.trim() === '') {
        throw new Error('--live-url needs an HTTPS origin');
      }
      index += 1;
      options.mode = 'deployment';
      options.liveUrl = value;
    } else if (argument === '--expected-backend-revision') {
      if (options.expectedBackendRevision !== null) {
        throw new Error('--expected-backend-revision can only be given once');
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--') || value.trim() === '') {
        throw new Error('--expected-backend-revision needs a full commit');
      }
      index += 1;
      options.expectedBackendRevision = value;
    } else if (argument === '--authenticated-e2e') {
      if (options.authenticatedE2e) throw new Error('--authenticated-e2e can only be given once');
      options.authenticatedE2e = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  if (options.help) {
    return options;
  }
  if (
    options.mode === 'repository' &&
    (options.expectedBackendRevision || options.authenticatedE2e)
  ) {
    throw new Error(
      '--repo-only verifies repository contracts only; deployment flags need --live-url',
    );
  }
  if (options.authenticatedE2e && options.liveUrl === null) {
    throw new Error('--authenticated-e2e needs --live-url');
  }
  if (options.mode === null) {
    throw new Error('choose --repo-only or --live-url');
  }
  if (options.expectedBackendRevision !== null) {
    assert.match(
      options.expectedBackendRevision,
      /^[a-f0-9]{40}$/i,
      '--expected-backend-revision must be a full 40-character commit',
    );
  }
  return options;
}

const VERIFICATION_STATUSES = new Set(['verified', 'not-run']);

/** Keep repository, deployment and authenticated E2E verification distinct. */
export function buildVerificationReport({
  repository,
  deployment = 'not-run',
  authenticatedE2E = 'not-run',
}) {
  for (const [level, status] of Object.entries({ repository, deployment, authenticatedE2E })) {
    assert.ok(
      VERIFICATION_STATUSES.has(status),
      `${level} verification status must be "verified" or "not-run"`,
    );
  }
  assert.equal(
    repository,
    'verified',
    'repository verification must pass before any deployment is reported',
  );
  if (deployment === 'not-run') {
    assert.equal(
      authenticatedE2E,
      'not-run',
      'authenticated E2E verification requires deployment verification',
    );
  }
  return { repository, deployment, authenticatedE2E };
}

/** Name only the variables, never their values. */
export function resolveAuthenticatedE2eCredentials(env = process.env) {
  const token = typeof env.CODERAX_SMOKE_TOKEN === 'string' ? env.CODERAX_SMOKE_TOKEN.trim() : '';
  if (token) {
    return { method: 'token' };
  }
  const email = typeof env.CODERAX_SMOKE_EMAIL === 'string' ? env.CODERAX_SMOKE_EMAIL.trim() : '';
  const password = typeof env.CODERAX_SMOKE_PASSWORD === 'string' ? env.CODERAX_SMOKE_PASSWORD : '';
  if (email && password) {
    return { method: 'password' };
  }
  const missing = [
    ...(email ? [] : ['CODERAX_SMOKE_EMAIL']),
    ...(password ? [] : ['CODERAX_SMOKE_PASSWORD']),
  ];
  throw new Error(
    'authenticated E2E verification requires CODERAX_SMOKE_TOKEN or both ' +
      `CODERAX_SMOKE_EMAIL and CODERAX_SMOKE_PASSWORD; missing ${missing.join(', ')}. ` +
      'No authenticated verification was performed.',
  );
}

const runDeployedSmoke = (origin, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts/smoke-deployed.mjs')], {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `authenticated E2E smoke failed (${signal ? `signal ${signal}` : `exit code ${code}`})`,
        ),
      );
    });
  });

export async function verifyAuthenticatedE2e(
  origin,
  { env = process.env, run = runDeployedSmoke } = {},
) {
  assertAuthenticatedOrigin(origin, env);
  const credentials = resolveAuthenticatedE2eCredentials(env);
  await run(origin, { ...env, CODERAX_BASE_URL: origin });
  return { status: 'verified', method: credentials.method, origin };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  try {
    const repository = await verifyRepositoryContracts();
    if (options.mode === 'repository') {
      console.log(
        JSON.stringify({
          ok: true,
          verification: buildVerificationReport({ repository: 'verified' }),
          repo: repository,
        }),
      );
      return;
    }

    const origin = validateLiveURL(options.liveUrl);
    if (options.authenticatedE2e) {
      resolveAuthenticatedE2eCredentials(process.env);
      assertAuthenticatedOrigin(origin, process.env);
    }
    const live = await verifyLiveBackend(
      origin,
      fetch,
      options.expectedBackendRevision ?? undefined,
    );
    const authenticated = options.authenticatedE2e
      ? await verifyAuthenticatedE2e(origin)
      : { status: 'not-run' };
    console.log(
      JSON.stringify({
        ok: true,
        verification: buildVerificationReport({
          repository: 'verified',
          deployment: 'verified',
          authenticatedE2E: authenticated.status === 'verified' ? 'verified' : 'not-run',
        }),
        repo: repository,
        live: { ...live, authenticatedE2E: authenticated },
      }),
    );
  } catch (error) {
    console.error(
      '[Coderax release gate] FAILED:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
