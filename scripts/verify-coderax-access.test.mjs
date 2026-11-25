import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROTECTED_GET_PATHS,
  PROTECTED_POST_PATHS,
  parseArgs,
  validateAccessURL,
  verifyAnonymousAccess,
} from './verify-coderax-access.mjs';

const response = (status, body = {}, headers = {}) => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const publicConfig = {
  appTitle: 'Coderax',
  registrationEnabled: false,
  passwordLoginEnabled: true,
};

const fakeFetch =
  ({ config = publicConfig, statuses = {}, postStatuses = {}, workStatus = 401 } = {}) =>
  async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === '/api/config') {
      return response(200, config, { 'content-type': 'application/json' });
    }
    if (PROTECTED_POST_PATHS.includes(url.pathname)) {
      assert.equal(init.method, 'POST');
      return response(postStatuses[url.pathname] ?? workStatus);
    }
    return response(statuses[url.pathname] ?? 401);
  };

test('accepts HTTPS origins and loopback HTTP only', () => {
  assert.equal(
    validateAccessURL('https://coderax.nnabdelshahid.workers.dev'),
    'https://coderax.nnabdelshahid.workers.dev',
  );
  assert.equal(validateAccessURL('http://127.0.0.1:3080'), 'http://127.0.0.1:3080');
  assert.throws(() => validateAccessURL('http://coderax.example/'));
  assert.throws(() => validateAccessURL('https://coderax.example/path'));
  assert.throws(() => validateAccessURL('https://user:pass@coderax.example/'));
  assert.throws(() => validateAccessURL('https://coderax.example/?token=secret'));
});

test('passes only when every private surface refuses anonymous access', async () => {
  const report = await verifyAnonymousAccess(
    'https://coderax.nnabdelshahid.workers.dev',
    fakeFetch(),
  );
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 1 + PROTECTED_GET_PATHS.length + PROTECTED_POST_PATHS.length);
});

test('fails when public registration is enabled', async () => {
  await assert.rejects(
    verifyAnonymousAccess(
      'https://coderax.nnabdelshahid.workers.dev',
      fakeFetch({ config: { ...publicConfig, registrationEnabled: true } }),
    ),
    /public registration must be disabled/,
  );
});

test('fails when startup config does not report whether registration is disabled', async () => {
  await assert.rejects(
    verifyAnonymousAccess(
      'https://coderax.nnabdelshahid.workers.dev',
      fakeFetch({ config: { ...publicConfig, registrationEnabled: undefined } }),
    ),
    /public registration must be disabled/,
  );
});

test('fails when owner password sign-in is not enabled', async () => {
  await assert.rejects(
    verifyAnonymousAccess(
      'https://coderax.nnabdelshahid.workers.dev',
      fakeFetch({ config: { ...publicConfig, passwordLoginEnabled: false } }),
    ),
    /owner password sign-in must be enabled/,
  );
});

test('fails when a private route answers an anonymous request', async () => {
  await assert.rejects(
    verifyAnonymousAccess(
      'https://coderax.nnabdelshahid.workers.dev',
      fakeFetch({ statuses: { '/api/convos': 200 } }),
    ),
    /\/api\/convos returned HTTP 200/,
  );
});

test('fails when Chat, Work or agent inference is reachable anonymously', async () => {
  for (const route of PROTECTED_POST_PATHS) {
    await assert.rejects(
      verifyAnonymousAccess(
        'https://coderax.nnabdelshahid.workers.dev',
        fakeFetch({ postStatuses: { [route]: 200 } }),
      ),
      new RegExp(`${route.replace(/[/.]/g, '\\$&')} returned HTTP 200`),
    );
  }
});

test('requires --base-url', () => {
  assert.equal(
    parseArgs(['--base-url', 'https://coderax.nnabdelshahid.workers.dev']).baseUrl,
    'https://coderax.nnabdelshahid.workers.dev',
  );
  assert.throws(() => parseArgs([]), /choose --base-url/);
  assert.throws(() => parseArgs(['--base-url']), /needs an HTTPS origin/);
});
