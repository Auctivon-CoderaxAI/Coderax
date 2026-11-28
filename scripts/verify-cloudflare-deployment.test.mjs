import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  buildReport,
  parseArgs,
  validateOrigin,
  verifyDeployment,
  verifyRepositoryConfig,
  verifyRevisionDrift,
} from './verify-cloudflare-deployment.mjs';

const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);

const DEFAULT_ROUTES = {
  '/deployment.json': {
    type: 'application/json',
    body: JSON.stringify({ worker: 'coderax', commit: COMMIT, branch: 'main', builtAt: 'now' }),
  },
  '/': { type: 'text/html', body: '<!doctype html><html><body>Coderax</body></html>' },
  '/login': { type: 'text/html', body: '<!doctype html><html><body>Login</body></html>' },
  '/readyz': { type: 'text/plain', body: 'OK' },
  '/api/config': {
    type: 'application/json',
    body: JSON.stringify({ appTitle: 'Coderax', buildInfo: { commit: COMMIT } }),
  },
};

let server;
let origin;
let routes;
const ORIGIN = 'https://coderax.example.workers.dev';

// The gate only accepts HTTPS origins, so keep the fixture origin realistic and
// rewrite its path to the loopback server in the injected fetcher.
function localFetch(input, init) {
  const url = new URL(input);
  return fetch(`${origin}${url.pathname}${url.search}`, init);
}

before(async () => {
  server = createServer((request, response) => {
    const route = routes[new URL(request.url, 'http://localhost').pathname];
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': route.type });
    response.end(typeof route.body === 'function' ? route.body() : route.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function fixture(overrides = {}) {
  routes = { ...DEFAULT_ROUTES, ...overrides };
}

describe('validateOrigin', () => {
  it('accepts a plain HTTPS origin', () => {
    assert.equal(
      validateOrigin('https://coderax.example.workers.dev'),
      'https://coderax.example.workers.dev',
    );
  });

  it('rejects values that would widen or misdirect the check', () => {
    for (const value of [
      undefined,
      '',
      'http://coderax.example',
      'https://coderax.example/path',
      'https://coderax.example?x=1',
      'https://coderax.example#x',
      'https://coderax.example:8443',
      'https://user:pass@coderax.example',
    ]) {
      assert.throws(() => validateOrigin(value), String(value));
    }
  });
});

describe('parseArgs', () => {
  it('requires an expected commit for a live check', () => {
    assert.throws(() => parseArgs(['--url', 'https://coderax.example']), /expected-commit/);
    assert.throws(
      () => parseArgs(['--url', 'https://coderax.example', '--expected-commit', 'abc']),
      /40-character/,
    );
  });

  it('separates repository and live modes', () => {
    assert.throws(() => parseArgs(['--config-only', '--expected-commit', COMMIT]), /config-only/);
    assert.throws(
      () => parseArgs(['--config-only', '--url', 'https://coderax.example']),
      /exactly one/,
    );
    assert.deepEqual(parseArgs(['--config-only']), {
      mode: 'config',
      url: null,
      expectedCommit: null,
      drift: false,
      help: false,
    });
  });

  it('compares revisions instead of a pinned commit in drift mode', () => {
    assert.deepEqual(parseArgs(['--drift', '--url', 'https://coderax.example']), {
      mode: 'drift',
      url: 'https://coderax.example',
      expectedCommit: null,
      drift: true,
      help: false,
    });
    assert.throws(() => parseArgs(['--drift']), /needs --url/);
    assert.throws(() => parseArgs(['--drift', '--config-only']), /live deployment/);
    assert.throws(
      () => parseArgs(['--drift', '--url', 'https://coderax.example', '--expected-commit', COMMIT]),
      /does not take --expected-commit/,
    );
  });
});

describe('verifyDeployment', () => {
  it('passes only when the Worker and backend both report the expected commit', async () => {
    fixture();
    const result = await verifyDeployment(ORIGIN, COMMIT, localFetch);
    assert.equal(result.deployedCommit, COMMIT);
    assert.equal(result.backendCommit, COMMIT);
    assert.equal(result.readiness, 'OK');
  });

  it('fails when the Worker serves a different revision', async () => {
    fixture({
      '/deployment.json': {
        type: 'application/json',
        body: JSON.stringify({ worker: 'coderax', commit: OTHER_COMMIT, branch: 'main' }),
      },
    });
    await assert.rejects(() => verifyDeployment(ORIGIN, COMMIT, localFetch), /expected/);
  });

  it('fails when the marker changes during verification', async () => {
    let reads = 0;
    fixture({
      '/deployment.json': {
        type: 'application/json',
        body: () =>
          JSON.stringify({
            worker: 'coderax',
            commit: reads++ === 0 ? COMMIT : OTHER_COMMIT,
            branch: 'main',
          }),
      },
    });
    await assert.rejects(
      () => verifyDeployment(ORIGIN, COMMIT, localFetch),
      /reports b{40}, expected/,
    );
  });

  it('fails when the SPA fallback answers /deployment.json', async () => {
    fixture({ '/deployment.json': { type: 'text/html', body: '<html></html>' } });
    await assert.rejects(() => verifyDeployment(ORIGIN, COMMIT, localFetch), /not JSON/);
  });

  it('fails when the deployment has no identifiable commit', async () => {
    fixture({
      '/deployment.json': {
        type: 'application/json',
        body: JSON.stringify({ worker: 'coderax', commit: null, branch: 'main' }),
      },
    });
    await assert.rejects(
      () => verifyDeployment(ORIGIN, COMMIT, localFetch),
      /cannot be identified/,
    );
  });

  it('fails when API traffic does not reach the backend', async () => {
    fixture({ '/api/config': { type: 'text/html', body: '<html></html>' } });
    await assert.rejects(
      () => verifyDeployment(ORIGIN, COMMIT, localFetch),
      /did not reach the backend/,
    );
  });

  it('fails when the backend cannot identify its commit', async () => {
    fixture({
      '/api/config': { type: 'application/json', body: JSON.stringify({ appTitle: 'Coderax' }) },
    });
    await assert.rejects(() => verifyDeployment(ORIGIN, COMMIT, localFetch), /buildInfo\.commit/);
  });

  it('fails when readiness is not OK', async () => {
    fixture({ '/readyz': { type: 'text/plain', body: 'starting' } });
    await assert.rejects(
      () => verifyDeployment(ORIGIN, COMMIT, localFetch),
      /did not confirm backend startup/,
    );
  });
});

describe('verifyRevisionDrift', () => {
  it('reports no drift when the Worker and the backend serve the same revision', async () => {
    fixture();
    const result = await verifyRevisionDrift(ORIGIN, localFetch);
    assert.equal(result.drift, false);
    assert.equal(result.workerCommit, COMMIT);
    assert.equal(result.backendCommit, COMMIT);
  });

  it('flags drift when the backend lags the served Worker', async () => {
    fixture({
      '/api/config': {
        type: 'application/json',
        body: JSON.stringify({ appTitle: 'Coderax', buildInfo: { commit: OTHER_COMMIT } }),
      },
    });
    const result = await verifyRevisionDrift(ORIGIN, localFetch);
    assert.equal(result.drift, true);
    assert.equal(result.workerCommit, COMMIT);
    assert.equal(result.backendCommit, OTHER_COMMIT);
  });

  it('fails closed when the backend cannot identify its revision', async () => {
    fixture({
      '/api/config': { type: 'application/json', body: JSON.stringify({ appTitle: 'Coderax' }) },
    });
    await assert.rejects(() => verifyRevisionDrift(ORIGIN, localFetch), /buildInfo\.commit/);
  });

  it('fails when the Worker marker changes while the comparison runs', async () => {
    let reads = 0;
    fixture({
      '/deployment.json': {
        type: 'application/json',
        body: () =>
          JSON.stringify({
            worker: 'coderax',
            commit: reads++ === 0 ? COMMIT : OTHER_COMMIT,
            branch: 'main',
          }),
      },
    });
    await assert.rejects(
      () => verifyRevisionDrift(ORIGIN, localFetch),
      /reports b{40}, expected/,
    );
  });
});

describe('buildReport', () => {
  it('cannot report API or authenticated success without a verified deployment', () => {
    assert.throws(
      () => buildReport({ repository: 'verified', api: 'verified' }),
      /requires deployment/,
    );
    assert.throws(
      () => buildReport({ repository: 'verified', authenticatedE2E: 'verified' }),
      /requires deployment/,
    );
    assert.deepEqual(buildReport({ repository: 'verified' }), {
      repository: 'verified',
      deployment: 'not-run',
      api: 'not-run',
      authenticatedE2E: 'not-run',
    });
  });
});

describe('verifyRepositoryConfig', () => {
  it('accepts the committed Wrangler and package contract', () => {
    const config = verifyRepositoryConfig();
    assert.equal(config.worker, 'coderax');
    assert.equal(config.wrangler, '4.168.0');
  });

  const configUrl = new URL('../wrangler.jsonc', import.meta.url);
  const fixture = (t, setting) => {
    const root = mkdtempSync(join(tmpdir(), 'coderax-wrangler-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(
      join(root, 'package.json'),
      readFileSync(new URL('../package.json', import.meta.url)),
    );
    const config = readFileSync(configUrl, 'utf8');
    writeFileSync(join(root, 'wrangler.jsonc'), config.replace('"keep_vars": true,', setting));
    return root;
  };

  for (const [name, setting] of [
    ['commented out', '// "keep_vars": true,'],
    ['in a block comment', '/* "keep_vars": true, */'],
    ['nested', '"vars": { "keep_vars": true },'],
    ['disabled', '// "keep_vars": true,\n  "keep_vars": false,'],
  ]) {
    it(`rejects keep_vars when it is ${name}`, (t) => {
      assert.throws(() => verifyRepositoryConfig(fixture(t, setting)), /top-level keep_vars/);
    });
  }

  it('accepts a true setting with JSONC comments, trailing commas, and comment markers in strings', (t) => {
    const setting =
      '"keep_vars" /* preserve dashboard variables */ : true,\n' +
      '  "vars": { "URL": "https://example.test/a/*b*/", "TEXT": "a \\"quote\\",}" , },';
    assert.equal(verifyRepositoryConfig(fixture(t, setting)).worker, 'coderax');
  });
});

describe('deploy:cloudflare', () => {
  it('rejects npm arguments that could select a config other than the checked file', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'coderax-deploy-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'scripts'));
    for (const file of [
      'package.json',
      'wrangler.jsonc',
      'scripts/deploy-cloudflare.mjs',
      'scripts/verify-cloudflare-deployment.mjs',
    ]) {
      copyFileSync(new URL(`../${file}`, import.meta.url), join(root, file));
    }
    // Stop before Wrangler even if the wrapper regresses and accepts arguments.
    writeFileSync(join(root, 'scripts/write-deployment-metadata.mjs'), 'process.exit(42);');

    const result = spawnSync(
      'npm',
      ['run', 'deploy:cloudflare', '--', '--config', 'alternate.jsonc'],
      {
        cwd: root,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /does not accept Wrangler arguments/);
  });
});
