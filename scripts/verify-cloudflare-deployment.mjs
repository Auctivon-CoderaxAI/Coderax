#!/usr/bin/env node
/**
 * Coderax Cloudflare release gate.
 *
 * The committed configuration, the live Worker revision, and the backend behind
 * the Worker are separate verification levels. A successful Workers Build or an
 * HTTP 200 for the SPA is not proof that the application works.
 *
 * Usage:
 *   node scripts/verify-cloudflare-deployment.mjs --config-only
 *   node scripts/verify-cloudflare-deployment.mjs \
 *     --url https://coderax.<account>.workers.dev \
 *     --expected-commit <full-40-character-commit>
 *
 * --config-only contacts no deployment and reports `deployment: not-run`.
 * --url always requires /deployment.json to report the exact expected commit,
 * the SPA and login shell to render, /readyz to report OK, and /api/config to
 * report the same full commit from the backend. A missing or unidentifiable
 * value fails; nothing is skipped or reported as success.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL_COMMIT = /^[a-f0-9]{40}$/i;
const VERIFICATION_STATUSES = new Set(['verified', 'not-run']);
const MAX_BODY_BYTES = 1_048_576;

/** Accept only a plain HTTPS deployment origin; never a URL carrying credentials or a path. */
export function validateOrigin(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('--url needs an HTTPS deployment origin');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('--url must be a valid HTTPS origin');
  }
  assert.equal(url.protocol, 'https:', 'deployment URL must use HTTPS');
  assert.equal(url.username, '', 'deployment URL cannot embed credentials');
  assert.equal(url.password, '', 'deployment URL cannot embed credentials');
  assert.equal(url.port, '', 'deployment URL cannot use a non-default port');
  assert.equal(url.pathname, '/', 'deployment URL must be an origin');
  assert.equal(url.search, '', 'deployment URL cannot include a query');
  assert.equal(url.hash, '', 'deployment URL cannot include a fragment');
  return url.origin;
}

async function request(origin, route, fetcher) {
  const response = await fetcher(`${origin}${route}`, {
    method: 'GET',
    redirect: 'manual',
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${route} returned HTTP ${response.status}`,
  );
  assert.equal(response.headers.get('location'), null, `${route} unexpectedly redirected`);
  assert.ok(
    Buffer.byteLength(body) <= MAX_BODY_BYTES,
    `${route} returned more than ${MAX_BODY_BYTES} bytes`,
  );
  return { response, body };
}

async function verifyMarker(origin, expected, fetcher) {
  const marker = await request(origin, '/deployment.json', fetcher);
  assert.match(
    marker.response.headers.get('content-type') ?? '',
    /application[/]json/i,
    '/deployment.json is not JSON; the SPA fallback answered instead of a build artifact',
  );
  const deployment = JSON.parse(marker.body);
  assert.equal(deployment.worker, 'coderax', '/deployment.json names an unexpected Worker');
  assert.match(
    deployment.commit ?? '',
    FULL_COMMIT,
    '/deployment.json has no full commit; the served revision cannot be identified',
  );
  assert.equal(
    deployment.commit.toLowerCase(),
    expected,
    `/deployment.json reports ${deployment.commit}, expected ${expected}`,
  );
  assert.equal(typeof deployment.branch, 'string', '/deployment.json has no branch');
  return deployment;
}

/** Verify the live Worker serves the expected revision and reaches the backend. */
export async function verifyDeployment(value, expectedCommit, fetcher = fetch) {
  if (!FULL_COMMIT.test(expectedCommit ?? '')) {
    throw new Error('--expected-commit must be a full 40-character commit');
  }
  const expected = expectedCommit.toLowerCase();
  const origin = validateOrigin(value);

  await verifyMarker(origin, expected, fetcher);

  const shell = await request(origin, '/', fetcher);
  assert.match(
    shell.response.headers.get('content-type') ?? '',
    /text[/]html/i,
    'the application shell is not HTML',
  );
  assert.match(shell.body, /<html/i, 'the application shell is not an HTML document');

  const login = await request(origin, '/login', fetcher);
  assert.match(
    login.response.headers.get('content-type') ?? '',
    /text[/]html/i,
    '/login is not HTML',
  );

  const readiness = await request(origin, '/readyz', fetcher);
  assert.equal(readiness.body.trim(), 'OK', '/readyz did not confirm backend startup');

  const configResponse = await request(origin, '/api/config', fetcher);
  assert.match(
    configResponse.response.headers.get('content-type') ?? '',
    /application[/]json/i,
    '/api/config served HTML; API traffic did not reach the backend',
  );
  const config = JSON.parse(configResponse.body);
  assert.equal(
    typeof config.appTitle,
    'string',
    '/api/config is missing application configuration',
  );
  const backendCommit = config.buildInfo?.commit;
  assert.match(
    backendCommit ?? '',
    FULL_COMMIT,
    '/api/config has no full buildInfo.commit; the API reached a backend that cannot identify its revision',
  );
  assert.equal(
    backendCommit.toLowerCase(),
    expected,
    `/api/config reports ${backendCommit}, expected ${expected}`,
  );

  const finalDeployment = await verifyMarker(origin, expected, fetcher);

  return {
    origin,
    worker: finalDeployment.worker,
    deployedCommit: finalDeployment.commit.toLowerCase(),
    branch: finalDeployment.branch,
    builtAt: finalDeployment.builtAt ?? null,
    shell: 'HTML',
    login: 'HTML',
    readiness: 'OK',
    apiConfig: 'JSON',
    backendCommit: backendCommit.toLowerCase(),
    appTitle: config.appTitle,
  };
}

/** Verify the committed Worker contract without contacting a deployment. */
export function verifyRepositoryConfig(root = repoRoot) {
  const wrangler = readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const required = [
    '"name": "coderax"',
    '"main": "./worker/index.mjs"',
    '"directory": "./client/dist"',
    '"/api/*"',
    '"/oauth/*"',
    '"/readyz"',
    '"workers_dev": true',
  ];
  for (const needle of required) {
    assert.ok(wrangler.includes(needle), `wrangler.jsonc is missing ${needle}`);
  }
  assert.match(
    pkg.scripts?.frontend ?? '',
    /write-deployment-metadata\.mjs/,
    'npm run frontend must write the served revision',
  );
  assert.match(
    pkg.scripts?.['deploy:cloudflare'] ?? '',
    /wrangler@4\.168\.0/,
    'the Cloudflare deploy command must pin Wrangler',
  );
  assert.match(
    pkg.scripts?.['deploy:cloudflare'] ?? '',
    /write-deployment-metadata\.mjs/,
    'the Cloudflare deploy command must write the revision marker',
  );
  return {
    worker: 'coderax',
    entrypoint: './worker/index.mjs',
    assets: './client/dist',
    wrangler: '4.168.0',
  };
}

/** Keep repository, deployment, API and authenticated verification distinct. */
export function buildReport({
  repository,
  deployment = 'not-run',
  api = 'not-run',
  authenticatedE2E = 'not-run',
}) {
  for (const [level, status] of Object.entries({ repository, deployment, api, authenticatedE2E })) {
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
    assert.equal(api, 'not-run', 'API verification requires deployment verification');
    assert.equal(
      authenticatedE2E,
      'not-run',
      'authenticated E2E verification requires deployment verification',
    );
  }
  return { repository, deployment, api, authenticatedE2E };
}

export const USAGE = `Usage:
  node scripts/verify-cloudflare-deployment.mjs --config-only
  node scripts/verify-cloudflare-deployment.mjs --url <https-origin> --expected-commit <full-commit>

Verification levels:
  --config-only   Committed Wrangler/package contract only. Contacts no deployment
                  and reports deployment: not-run.
  --url           Requires /deployment.json to report the exact expected commit,
                  the SPA and /login to render, /readyz to report OK, and
                  /api/config to report the same full commit from the backend.
                  Missing values fail; checks are never skipped.
  --help, -h      Show this message.`;

export function parseArgs(argv) {
  const options = {
    mode: null,
    url: null,
    expectedCommit: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--config-only') {
      if (options.mode !== null) {
        throw new Error('choose exactly one verification mode');
      }
      options.mode = 'config';
    } else if (argument === '--url') {
      if (options.mode !== null) {
        throw new Error('choose exactly one verification mode');
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--') || value.trim() === '') {
        throw new Error('--url needs an HTTPS origin');
      }
      index += 1;
      options.mode = 'live';
      options.url = value;
    } else if (argument === '--expected-commit') {
      if (options.expectedCommit !== null) {
        throw new Error('--expected-commit can only be given once');
      }
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--') || value.trim() === '') {
        throw new Error('--expected-commit needs a full commit');
      }
      index += 1;
      options.expectedCommit = value;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  if (options.help) {
    return options;
  }
  if (options.mode === null) {
    throw new Error('choose --config-only or --url');
  }
  if (options.mode === 'config' && options.expectedCommit !== null) {
    throw new Error('--config-only verifies the repository only; --expected-commit needs --url');
  }
  if (options.mode === 'live' && options.expectedCommit === null) {
    throw new Error('--url requires --expected-commit; an unidentified deployment is not verified');
  }
  if (options.expectedCommit !== null) {
    assert.match(
      options.expectedCommit,
      FULL_COMMIT,
      '--expected-commit must be a full 40-character commit',
    );
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  try {
    const config = verifyRepositoryConfig();
    if (options.mode === 'config') {
      console.log(
        JSON.stringify({
          ok: true,
          verification: buildReport({ repository: 'verified' }),
          config,
        }),
      );
      return;
    }

    const live = await verifyDeployment(options.url, options.expectedCommit);
    console.log(
      JSON.stringify({
        ok: true,
        verification: buildReport({
          repository: 'verified',
          deployment: 'verified',
          api: 'verified',
        }),
        config,
        live,
      }),
    );
  } catch (error) {
    console.error(
      '[Coderax Cloudflare release gate] FAILED:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
