import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLoopbackOrigin, verifySelfHost } from './check-selfhost.mjs';

function fakeResponse(status, contentType, body) {
  return {
    status,
    headers: { get: (name) => name === 'content-type' ? contentType : null },
    text: async () => body,
  };
}
const good = async (url) => {
  if (url.endsWith('/readyz')) return fakeResponse(200, 'text/plain; charset=utf-8', 'OK');
  if (url.endsWith('/api/config')) return fakeResponse(200, 'application/json; charset=utf-8', '{"appTitle":"Coderax"}');
  return fakeResponse(200, 'text/html; charset=utf-8', '<!doctype html><html lang="en"></html>');
};

test('only explicitly local origins are accepted', () => {
  assert.equal(validateLoopbackOrigin('http://127.0.0.1:3080'), 'http://127.0.0.1:3080');
  for (const url of ['http://evil.test', 'https://127.0.0.1:3080', 'http://127.0.0.1:3080/api', 'http://u:p@localhost:3080/', 'http://localhost:3080/?token=abc']) {
    assert.throws(() => validateLoopbackOrigin(url));
  }
});

test('genuine Express readiness and SPA pass', async () => {
  assert.deepEqual(await verifySelfHost('http://127.0.0.1:3080', good), {ready:true,api:true,spa:true,appTitle:'Coderax'});
});

test('Vercel-like static frontend with no backend fails closed', async () => {
  await assert.rejects(verifySelfHost('http://127.0.0.1:3080', async () => fakeResponse(404, 'text/html', '<html></html>')), /readyz returned HTTP 404/);
});

test('API returning SPA HTML fails closed', async () => {
  await assert.rejects(verifySelfHost('http://127.0.0.1:3080', async (url) => url.endsWith('/api/config') ? fakeResponse(200, 'text/html', '<html></html>') : good(url)), /wrong content type/);
});

test('a liveness-only server never passes readiness', async () => {
  await assert.rejects(verifySelfHost('http://127.0.0.1:3080', async (url) => url.endsWith('/readyz') ? fakeResponse(503, 'text/plain', 'NOT_READY') : good(url)), /readyz returned HTTP 503/);
});
