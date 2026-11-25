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
  return { ASSETS: assets, CODERAX_ALLOWED_HOSTS: 'coderax.example', ...overrides };
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
  it('accepts the authorized Coderax sslip.io origin', () => {
    assert.equal(parseApiOrigin(ORIGIN)?.origin, ORIGIN);
  });

  it('rejects values that would widen the upstream target', () => {
    for (const value of [
      undefined,
      '',
      'http://coderax-93-184-216-34.sslip.io',
      'https://coderax-93-184-216-34.sslip.io/path',
      'https://coderax-93-184-216-34.sslip.io?x=1',
      'https://coderax-93-184-216-34.sslip.io:8443',
      'https://user:pass@coderax-93-184-216-34.sslip.io',
      'not a url',
    ]) {
      assert.equal(parseApiOrigin(value), null, String(value));
    }
  });

  it('refuses to send the proxy secret to a non-Coderax or private origin', () => {
    for (const value of [
      'https://coderaxai.vercel.app',
      'https://coderax.example',
      'https://coderax-93-184-216-34.sslip.io.evil.example',
      'https://coderax-10-0-0-1.sslip.io',
      'https://coderax-127-0-0-1.sslip.io',
      'https://coderax-192-168-1-1.sslip.io',
      'https://coderax-198-51-100-1.sslip.io',
      'https://coderax-999-1-1-1.sslip.io',
    ]) {
      assert.equal(parseApiOrigin(value), null, value);
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

  it('refuses to proxy API calls for a host it does not serve', async () => {
    let requested = false;
    globalThis.fetch = async () => {
      requested = true;
      return new Response('should not be called');
    };

    const response = await worker.fetch(
      new Request('https://attacker.example/api/config'),
      env({ CODERAX_ALLOWED_HOSTS: 'coderax.nnabdelshahid.workers.dev' }),
    );

    assert.equal(response.status, 421);
    assert.equal(requested, false);
    assert.equal(assets.calls.length, 0);
  });

  it('allows loopback during local Worker development', async () => {
    globalThis.fetch = async () => new Response('{"ok":true}');
    const response = await worker.fetch(
      new Request('http://localhost:8787/api/config'),
      env({ CODERAX_ALLOWED_HOSTS: '', CODERAX_API_ORIGIN: ORIGIN, CODERAX_PROXY_SECRET: SECRET }),
    );

    assert.equal(response.status, 200);
  });

  it('defaults the allowed host to the canonical Workers origin', async () => {
    globalThis.fetch = async () => new Response('{"ok":true}');
    const response = await worker.fetch(
      new Request('https://coderax.nnabdelshahid.workers.dev/api/config'),
      env({ CODERAX_ALLOWED_HOSTS: '', CODERAX_API_ORIGIN: ORIGIN, CODERAX_PROXY_SECRET: SECRET }),
    );

    assert.equal(response.status, 200);
  });

  it('fails closed instead of answering API calls with index.html', async () => {
    const response = await worker.fetch(new Request('https://coderax.example/api/config'), env());

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'API proxy is not configured' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(assets.calls.length, 0);
  });

  it('fails closed when the proxy secret is missing or too short', async () => {
    let requested = false;
    globalThis.fetch = async () => {
      requested = true;
      return new Response('{"ok":true}');
    };

    for (const secret of [undefined, '', 'too-short']) {
      const response = await worker.fetch(
        new Request('https://coderax.example/api/config'),
        env({ CODERAX_API_ORIGIN: ORIGIN, CODERAX_PROXY_SECRET: secret }),
      );

      assert.equal(response.status, 503, String(secret));
      assert.deepEqual(await response.json(), { error: 'API proxy is not configured' });
    }
    assert.equal(requested, false);
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
        headers: {
          cookie: 'a=b',
          'x-vercel-id': 'skip-me',
          'x-forwarded-for': '1.2.3.4',
          'cf-connecting-ip': '203.0.113.9',
        },
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
    assert.equal(captured.headers.get('x-forwarded-for'), '203.0.113.9');
    assert.equal(captured.headers.get('x-coderax-proxy-secret'), SECRET);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"ok":true}');
    assert.equal(response.headers.get('transfer-encoding'), null);
    assert.equal(response.headers.get('x-coderax-proxy-secret'), null);
    assert.equal(assets.calls.length, 0);
  });

  it('does not trust a client-supplied X-Forwarded-For without Cloudflare attestation', async () => {
    let captured;
    globalThis.fetch = async (input, init) => {
      captured = { headers: new Headers(init.headers) };
      return new Response('{"ok":true}');
    };

    await worker.fetch(
      new Request('https://coderax.example/api/config', {
        headers: { 'x-forwarded-for': '198.51.100.7' },
      }),
      env({ CODERAX_API_ORIGIN: ORIGIN, CODERAX_PROXY_SECRET: SECRET }),
    );

    assert.equal(captured.headers.get('x-forwarded-for'), null);
  });

  it('drops request fields named by the Connection header', async () => {
    let captured;
    globalThis.fetch = async (input, init) => {
      captured = { headers: new Headers(init.headers) };
      return new Response('ok');
    };

    await worker.fetch(
      new Request('https://coderax.example/api/config', {
        headers: {
          connection: 'x-hop-state',
          'x-hop-state': 'drop-me',
          'x-keep-state': 'keep-me',
        },
      }),
      env({ CODERAX_API_ORIGIN: ORIGIN, CODERAX_PROXY_SECRET: SECRET }),
    );

    assert.equal(captured.headers.get('connection'), null);
    assert.equal(captured.headers.get('x-hop-state'), null);
    assert.equal(captured.headers.get('x-keep-state'), 'keep-me');
  });

  it('drops response fields named by the Connection header', async () => {
    globalThis.fetch = async () =>
      new Response('{"ok":true}', {
        headers: {
          connection: 'x-upstream-state',
          'x-upstream-state': 'drop-me',
          'x-keep-state': 'keep-me',
        },
      });

    const response = await worker.fetch(
      new Request('https://coderax.example/api/config'),
      env({ CODERAX_API_ORIGIN: ORIGIN, CODERAX_PROXY_SECRET: SECRET }),
    );

    assert.equal(await response.text(), '{"ok":true}');
    assert.equal(response.headers.get('connection'), null);
    assert.equal(response.headers.get('x-upstream-state'), null);
    assert.equal(response.headers.get('x-keep-state'), 'keep-me');
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
      env({ CODERAX_API_ORIGIN: ORIGIN, CODERAX_PROXY_SECRET: SECRET }),
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
      env({ CODERAX_API_ORIGIN: ORIGIN, CODERAX_PROXY_SECRET: SECRET }),
    );

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'API origin is unavailable' });
  });
});
