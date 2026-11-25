import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import worker, { isApiPath, parseApiOrigin } from './index.mjs';

const ORIGIN = 'https://coderax-93-184-216-34.sslip.io';
const SECRET = 'a'.repeat(64);

const assets = {
  calls: [],
  fetch(request) {
    assets.calls.push(request);
    return new Response(`asset:${new URL(request.url).pathname}`, {
      headers: { 'content-type': 'text/html' },
    });
  },
};

function env(overrides = {}) {
  return { ASSETS: assets, ...overrides };
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  assets.calls = [];
});

describe('isApiPath', () => {
  it('claims the routes the backend owns', () => {
    for (const pathname of [
      '/api',
      '/api/config',
      '/api/work/chat',
      '/oauth/callback',
      '/health',
      '/livez',
      '/readyz',
    ]) {
      assert.equal(isApiPath(pathname), true, pathname);
    }
  });

  it('leaves application routes and lookalikes to the assets runtime', () => {
    for (const pathname of ['/', '/c/abc123', '/login', '/apix', '/apiary', '/oauth-ish']) {
      assert.equal(isApiPath(pathname), false, pathname);
    }
  });
});

describe('parseApiOrigin', () => {
  it('accepts a plain HTTPS origin', () => {
    assert.equal(parseApiOrigin(ORIGIN)?.origin, ORIGIN);
  });

  it('rejects values that would widen the upstream target', () => {
    for (const value of [
      undefined,
      '',
      'http://coderax.example',
      'https://coderax.example/path',
      'https://coderax.example?x=1',
      'https://coderax.example:8443',
      'https://user:pass@coderax.example',
      'not a url',
    ]) {
      assert.equal(parseApiOrigin(value), null, String(value));
    }
  });
});

describe('worker fetch', () => {
  it('serves application routes from the assets binding', async () => {
    const response = await worker.fetch(new Request('https://coderax.example/c/abc123'), env());

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'asset:/c/abc123');
    assert.equal(assets.calls.length, 1);
  });

  it('fails closed instead of answering API calls with index.html', async () => {
    const response = await worker.fetch(new Request('https://coderax.example/api/config'), env());

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'API proxy is not configured' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(assets.calls.length, 0);
  });

  it('forwards API calls to the configured origin', async () => {
    let captured;
    globalThis.fetch = async (input, init) => {
      captured = { input, init, headers: new Headers(init.headers) };
      return new Response('{"ok":true}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
          'x-coderax-proxy-secret': 'must-not-echo',
        },
      });
    };

    const response = await worker.fetch(
      new Request('https://coderax.example/api/config?x=1', {
        headers: { cookie: 'a=b', 'x-vercel-id': 'skip-me' },
      }),
      env({ CODERAX_API_ORIGIN: ORIGIN, CODERAX_PROXY_SECRET: SECRET }),
    );

    assert.equal(captured.input, `${ORIGIN}/api/config?x=1`);
    assert.equal(captured.init.method, 'GET');
    assert.equal(captured.init.redirect, 'manual');
    assert.equal(captured.headers.get('cookie'), 'a=b');
    assert.equal(captured.headers.get('x-vercel-id'), null);
    assert.equal(captured.headers.get('x-forwarded-host'), 'coderax.example');
    assert.equal(captured.headers.get('x-forwarded-proto'), 'https');
    assert.equal(captured.headers.get('x-coderax-proxy-secret'), SECRET);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"ok":true}');
    assert.equal(response.headers.get('transfer-encoding'), null);
    assert.equal(response.headers.get('x-coderax-proxy-secret'), null);
    assert.equal(assets.calls.length, 0);
  });

  it('forwards request bodies for API writes', async () => {
    let captured;
    globalThis.fetch = async (input, init) => {
      captured = { input, init };
      return new Response('{"ok":true}', { status: 201 });
    };

    await worker.fetch(
      new Request('https://coderax.example/api/work/chat', {
        method: 'POST',
        body: '{"text":"hi"}',
      }),
      env({ CODERAX_API_ORIGIN: ORIGIN }),
    );

    assert.equal(captured.input, `${ORIGIN}/api/work/chat`);
    assert.equal(captured.init.method, 'POST');
    assert.equal(await new Response(captured.init.body).text(), '{"text":"hi"}');
  });

  it('reports an unreachable origin as a gateway failure', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('network');
    };

    const response = await worker.fetch(
      new Request('https://coderax.example/api/config'),
      env({ CODERAX_API_ORIGIN: ORIGIN }),
    );

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'API origin is unavailable' });
  });
});
