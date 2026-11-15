#!/usr/bin/env node
/**
 * Coderax deployment preflight, intentionally independent of npm dependencies.
 * A successful Vite build is NOT proof that the Express API is deployed.
 *
 * Usage:
 *   node scripts/verify-coderax-deployment.mjs --repo-only
 *   node scripts/verify-coderax-deployment.mjs --live-url https://coderax-ten.vercel.app
 *   node scripts/verify-coderax-deployment.mjs --live-url https://coderax-ten.vercel.app --expected-backend-revision <full-commit>
 */
import assert from 'node:assert/strict';
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
  assert.ok(
    isPreviewAlias || isProductionAlias,
    'live URL must be a Coderax Vercel deployment',
  );
  return url.origin;
};

/**
 * Vercel Services traces the backend entrypoint from the repository root.
 * Keep a runtime dependency used by @coderax/api visible to the root tracer,
 * rather than relying solely on npm workspace hoisting.
 */
export function verifyVercelRuntimeDependency(rootPackage, lock, apiPackage, backendPackage, name) {
  const required = apiPackage.dependencies?.[name];
  assert.equal(typeof required, 'string', `@coderax/api must declare ${name} as a dependency`);
  assert.equal(backendPackage.dependencies?.[name], required, `Express ${name} version must match @coderax/api`);
  assert.equal(rootPackage.dependencies?.[name], required, `Vercel root must declare ${name} for function tracing`);
  assert.equal(lock.packages?.['']?.dependencies?.[name], required, `root lockfile must include ${name} for npm ci`);
  assert.equal(lock.packages?.api?.dependencies?.[name], required, `Express lockfile must include ${name} for npm ci`);
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
export function verifyVercelBackendBootstrapDependencies(rootPackage, lock, backendPackage, source) {
  const imports = [...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1])
    .filter((name) => !name.startsWith('.') && !name.startsWith('node:'))
    .filter((name) => !['@coderax/api', 'coderax-data-provider'].includes(name));

  for (const name of imports) {
    const required = backendPackage.dependencies?.[name];
    assert.equal(typeof required, 'string', `Express must declare bootstrap dependency ${name}`);
    assert.equal(rootPackage.dependencies?.[name], required, `Vercel root must declare bootstrap dependency ${name}`);
    assert.equal(lock.packages?.['']?.dependencies?.[name], required, `root lockfile must include bootstrap dependency ${name}`);
    assert.equal(lock.packages?.api?.dependencies?.[name], required, `Express lockfile must include bootstrap dependency ${name}`);
    assert.ok(lock.packages?.[`node_modules/${name}`]?.version, `lockfile must resolve bootstrap dependency ${name}`);
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
export function verifyVercelEntrypointRuntimeDependency(rootPackage, lock, backendPackage, source, specifier) {
  verifyVercelEntrypointDependency(source, specifier);
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  const required = backendPackage.dependencies?.[name];
  assert.equal(typeof required, 'string', `Express must declare entrypoint dependency ${name}`);
  assert.equal(rootPackage.dependencies?.[name], required, `Vercel root must declare entrypoint dependency ${name}`);
  assert.equal(lock.packages?.['']?.dependencies?.[name], required, `root lockfile must include entrypoint dependency ${name}`);
  assert.equal(lock.packages?.api?.dependencies?.[name], required, `Express lockfile must include entrypoint dependency ${name}`);
  assert.ok(lock.packages?.[`node_modules/${name}`]?.version, `lockfile must resolve entrypoint dependency ${name}`);
  return name;
}

/** Verify package markers for dependencies that Vercel cannot reach through
 * module-alias. The marker uses require.resolve so tracing does not eagerly
 * initialize optional providers and authentication integrations.
 */
export function verifyVercelAliasRuntimeDependencies(lock, backendPackage, source) {
  const specifiers = [...source.matchAll(/\brequire\.resolve\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1]);
  assert.ok(specifiers.length > 0, 'Vercel alias-hidden runtime dependency markers are missing');
  for (const specifier of specifiers) {
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    const required = backendPackage.dependencies?.[name];
    assert.equal(typeof required, 'string', `Express must declare alias-hidden runtime dependency ${name}`);
    assert.equal(lock.packages?.api?.dependencies?.[name], required, `Express lockfile must include alias-hidden dependency ${name}`);
    assert.ok(
      lock.packages?.[`api/node_modules/${name}`]?.version || lock.packages?.[`node_modules/${name}`]?.version,
      `lockfile must resolve alias-hidden dependency ${name}`,
    );
  }
  return [...new Set(specifiers.map((specifier) => (
    specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
  )))].sort();
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
  assert.match(loaderSource, /\bimport\s*\(\s*['"]openid-client['"]\s*\)/, 'OpenID loader must use import()');
  assert.match(loaderSource, /\bimport\s*\(\s*['"]openid-client\/passport['"]\s*\)/, 'OpenID Passport loader must use import()');
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
    assert.equal(rootPackage.dependencies?.[name], required, `Vercel root must declare workspace dependency ${name}`);
    assert.equal(lock.packages?.['']?.dependencies?.[name], required, `root lockfile must include workspace ${name}`);
    assert.equal(lock.packages?.api?.dependencies?.[name], required, `Express lockfile must include workspace ${name}`);
    assert.equal(lock.packages?.[`node_modules/${name}`]?.link, true, `${name} must resolve as an npm workspace link`);
    assert.ok(lock.packages?.[workspace], `lockfile is missing workspace ${workspace}`);
  }
  return Object.keys(workspaces);
}

/** Ensure model bootstrap has a dedicated CommonJS/ESM workspace export. */
export function verifyDataSchemasModelsExport(dataSchemasPackage) {
  const modelExport = dataSchemasPackage.exports?.['./models'];
  assert.equal(modelExport?.require?.default, './dist/createModels.cjs', 'data-schemas CommonJS models export is missing');
  assert.equal(modelExport?.require?.types, './dist/createModels.d.cts', 'data-schemas CommonJS models types are missing');
  assert.equal(modelExport?.import?.default, './dist/createModels.mjs', 'data-schemas ESM models export is missing');
  assert.equal(modelExport?.import?.types, './dist/createModels.d.mts', 'data-schemas ESM models types are missing');
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

export function verifyWorkspaceBuildTooling(rootPackage, lock, clientPackage, apiPackage, services) {
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
    assert.equal(
      typeof pkg.devDependencies?.tsdown, 'string',
      `${workspace} must declare tsdown`,
    );
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

export async function verifyRepositoryContracts(root = repoRoot) {
  const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const clientPackage = JSON.parse(await readFile(path.join(root, 'client/package.json'), 'utf8'));
  const workspaceClientPackage = JSON.parse(await readFile(path.join(root, 'packages/client/package.json'), 'utf8'));
  const apiPackage = JSON.parse(await readFile(path.join(root, 'packages/api/package.json'), 'utf8'));
  const dataSchemasPackage = JSON.parse(await readFile(path.join(root, 'packages/data-schemas/package.json'), 'utf8'));
  const backendPackage = JSON.parse(await readFile(path.join(root, 'api/package.json'), 'utf8'));
  const backendSource = await readFile(path.join(root, 'api/server/index.js'), 'utf8');
  const backendAliasTraceSource = await readFile(path.join(root, 'api/server/vercel-trace-dependencies.js'), 'utf8');
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
  const openIdRuntimeSources = Object.fromEntries(await Promise.all(
    openIdRuntimePaths.map(async (filename) => [filename, await readFile(path.join(root, filename), 'utf8')]),
  ));
  const openIdLoaderSource = await readFile(path.join(root, 'packages/api/src/auth/openid/client.ts'), 'utf8');
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  verifyVercelEntrypointDependency(backendSource, './vercel-trace-dependencies');
  const backendAliasRuntimeDependencies = verifyVercelAliasRuntimeDependencies(lock, backendPackage, backendAliasTraceSource);
  const openIdClientEsmSafeSources = verifyVercelOpenIdClientEsmCompatibility(openIdRuntimeSources, openIdLoaderSource);
  const backendEntrypointDependencies = [
    verifyVercelEntrypointRuntimeDependency(rootPackage, lock, backendPackage, backendSource, 'eventsource'),
    verifyVercelEntrypointRuntimeDependency(rootPackage, lock, backendPackage, backendSource, 'lodash/partialRight'),
  ];
  const apiRuntimeDependencies = verifyVercelApiRuntimeDependencies(rootPackage, lock, apiPackage, backendPackage);
  const backendBootstrapDependencies = verifyVercelBackendBootstrapDependencies(rootPackage, lock, backendPackage, backendBootstrapSource);
  const backendWorkspaceDependencies = verifyVercelBackendWorkspaceDependencies(rootPackage, lock, backendPackage);
  verifyDataSchemasModelsExport(dataSchemasPackage);
  const vercel = JSON.parse(await readFile(path.join(root, 'client/vercel.json'), 'utf8'));
  assert.equal(typeof rootPackage.scripts?.frontend, 'string', 'root frontend script missing');
  assert.equal(typeof clientPackage.scripts?.frontend, 'string', 'client frontend script missing');
  assert.equal(typeof clientPackage.scripts?.build, 'string', 'client build script missing');
  assert.ok(
    backendSource.includes('const clientShellAvailable = !process.env.VERCEL || fs.existsSync(indexPath);'),
    'Vercel backend must start without frontend assets supplied by its separate service',
  );
  assert.ok(
    vercel.rewrites?.some((rule) =>
      typeof rule.source === 'string' &&
      rule.source.includes('?!api') &&
      rule.destination === '/index.html'),
    'SPA routing must not swallow /api requests',
  );
  const services = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.deepEqual(
    findMissingBuildTestFiles(services, (file) => existsSync(path.join(root, file))),
    [],
    'Vercel build commands must only name test files that exist',
  );
  assert.equal(services.services?.frontend?.framework, 'vite', 'frontend service not configured');
  assert.ok(services.services?.frontend?.rewrites?.some((r) => r.source === '/(.*)' && r.destination === '/index.html'), 'Vite SPA deep-link fallback missing inside frontend service');
  assert.match(
    services.services?.frontend?.installCommand ?? '',
    /npm ci --include=dev/,
    'frontend service must install the build toolchain used by the client package',
  );
  assert.equal(services.services?.backend?.framework, 'express', 'Express API proxy service not configured');
  assert.equal(services.services?.backend?.entrypoint, 'api/proxy.js', 'backend proxy entrypoint missing');
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
  assert.match(apiPackageSource, /normalize-cjs-runtime\.mjs dist\/proxy\.cjs/, 'API build must normalize the proxy CommonJS entrypoint for Vercel');
  assert.match(proxySource, /require\(['"]@coderax\/api\/proxy['"]\)/, 'Express wiring must load the TypeScript API workspace export');
  assert.match(apiPackageSource, /"\.\/proxy"\s*:/, 'API workspace must export the compiled proxy entry');
  assert.match(proxyHandlerSource, /CODERAX_API_ORIGIN/, 'proxy must require a configured API origin');
  assert.match(proxyHandlerSource, /CODERAX_PROXY_SECRET/, 'proxy must require a private origin secret');
  assert.match(proxyHandlerSource, /function isApiPath/, 'proxy must allowlist forwarded routes');
  assert.match(proxyHandlerSource, /response\.on\('error'/, 'proxy must handle upstream response stream errors');
  assert.doesNotMatch(proxySource + proxyHandlerSource, /api\/server\/index/, 'Vercel proxy must not start the database-backed API locally');
  assert.match(services.services?.backend?.buildCommand ?? '', /npm run build:api/, 'Vercel must build the TypeScript proxy workspace before bundling');
  assert.doesNotMatch(
    services.services?.backend?.buildCommand ?? '',
    /\bnpm run build:client(?:-package)?\b/,
    'backend service must not build frontend assets owned by the frontend service',
  );
  verifyWorkspaceBuildTooling(rootPackage, lock, workspaceClientPackage, apiPackage, services);
  assert.ok(services.rewrites?.some((r) => r.source === '/api/(.*)' && r.destination?.service === 'backend'), '/api not routed to backend service');
  assert.ok(services.rewrites?.some((r) => r.source === '/readyz' && r.destination?.service === 'backend'), 'readiness not routed to backend service');
  assert.ok(services.rewrites?.some((r) => r.source === '/(.*)' && r.destination?.service === 'frontend'), 'frontend catch-all missing');

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
  assert.ok(response.status < 300 && response.status >= 200, route + ' returned HTTP ' + response.status);
  assert.ok(!response.headers.get('location'), route + ' unexpectedly redirected');
  return checkResponse(response, await readBounded(response));
};

export async function verifyLiveBackend(value, fetcher = fetch, expectedBackendRevision) {
  if (expectedBackendRevision !== undefined) {
    assert.match(expectedBackendRevision, /^[a-f0-9]{40}$/i, 'expected backend revision must be a full 40-character commit');
  }
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
  if (expectedBackendRevision !== undefined) {
    const actual = config.buildInfo?.commit;
    assert.ok(typeof actual === 'string' && /^[a-f0-9]{40}$/i.test(actual), '/api/config is missing a full backend-reported buildInfo.commit');
    assert.equal(actual.toLowerCase(), expectedBackendRevision.toLowerCase(), 'backend-reported buildInfo.commit does not match expected revision');
  }
  await check(origin, '/login', (response, body) => {
    assert.match(response.headers.get('content-type') || '', /text[/]html/i);
    assert.match(body, /<html/i, 'login SPA is not served');
  }, fetcher);
  return {
    origin,
    readiness: 'OK',
    apiConfig: 'JSON',
    spa: 'HTML',
    appTitle: config.appTitle,
    backendRevisionVerified: expectedBackendRevision !== undefined,
  };
}

async function main() {
  const flag = process.argv[2];
  try {
    const result = await verifyRepositoryContracts();
    if (flag === '--repo-only') {
      console.log(JSON.stringify({ ok: true, repo: result }));
      return;
    }
    if (
      flag !== '--live-url' ||
      !process.argv[3] ||
      (process.argv.length !== 4 &&
        !(process.argv.length === 6 && process.argv[4] === '--expected-backend-revision'))
    ) {
      throw new Error('Use --repo-only or --live-url https://coderax-*.vercel.app [--expected-backend-revision <full-commit>]');
    }
    const live = await verifyLiveBackend(process.argv[3], fetch, process.argv[5]);
    console.log(JSON.stringify({ ok: true, repo: result, live }));
  } catch (error) {
    console.error('[Coderax release gate] FAILED:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
