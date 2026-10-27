import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createProxyHandler, isApiPath, parseApiOrigin } = require('./dist/proxy.cjs');

const ENV = {
  CODERAX_API_ORIGIN: 'https://coderax-93-184-216-34.sslip.io',
  CODERAX_PROXY_SECRET: 'a'.repeat(64),
  DOMAIN_CLIENT: 'https://coderaxai.vercel.app',
};

function responseStub() {
  const res = new EventEmitter();
  res.headers = {};
  res.body = '';
  res.statusCode = 200;
  res.headersSent = false;
  res.writableEnded = false;
  res.destroyed = false;
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };
  res.removeHeader = (name) => {
    delete res.headers[name.toLowerCase()];
  };
  res.write = (chunk) => {
    res.headersSent = true;
    res.body += chunk.toString();
    return true;
  };
  res.end = (body) => {
    if (body) res.body += body.toString();
    res.headersSent = true;
    res.writableEnded = true;
    res.emit('finish');
  };
  res.destroy = () => {
    res.destroyed = true;
  };
  return res;
}

test('only API, OAuth, and health routes are eligible for forwarding', () => {
  for (const path of [
    '/api',
    '/api/config',
    '/api/agents/chat',
    '/oauth/callback',
    '/readyz',
    '/health',
    '/livez',
  ]) {
    assert.equal(isApiPath(path), true, `${path} should be forwarded`);
  }
  for (const path of ['/', '/login', '/assets/app.js', '/ollama/api/generate']) {
    assert.equal(isApiPath(path), false, `${path} should stay on the frontend`);
  }
});

test('the configured origin must be HTTPS and point to a public Coderax sslip.io host', () => {
  assert.equal(parseApiOrigin(ENV.CODERAX_API_ORIGIN).hostname, 'coderax-93-184-216-34.sslip.io');
  for (const origin of [
    'http://coderax-93-184-216-34.sslip.io',
    'https://127.0.0.1',
    'https://coderax-10-0-0-1.sslip.io',
    'https://coderax-169-254-169-254.sslip.io',
    'https://coderax-192-0-2-1.sslip.io',
    'https://coderax-198-19-0-1.sslip.io',
    'https://coderax-203-0-113-5.sslip.io',
    'https://coderax-240-0-0-1.sslip.io',
    'https://coderax-999-1-1-1.sslip.io',
    'https://coderax-93-184-216-34.sslip.io/path',
    'https://user:password@coderax-93-184-216-34.sslip.io',
  ]) {
    assert.throws(() => parseApiOrigin(origin));
  }
});

test('missing secret fails closed without contacting the configured origin', () => {
  const res = responseStub();
  let requested = false;
  const handler = createProxyHandler({
    env: { ...ENV, CODERAX_PROXY_SECRET: '' },
    request: () => {
      requested = true;
      throw new Error('must not be called');
    },
  });
  handler({ url: '/readyz', headers: { host: 'coderaxai.vercel.app' }, on() {}, pipe() {} }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /not configured/);
  assert.equal(requested, false);
});

test('rejects unknown hosts and non-API paths before making an upstream request', () => {
  let requested = false;
  const handler = createProxyHandler({
    env: ENV,
    request: () => {
      requested = true;
    },
  });
  const makeReq = (url, host) => ({ url, headers: { host }, on() {}, pipe() {} });
  const unknownHost = responseStub();
  handler(makeReq('/api/config', 'attacker.example'), unknownHost);
  assert.equal(unknownHost.statusCode, 421);
  const frontendPath = responseStub();
  handler(makeReq('/login', 'coderaxai.vercel.app'), frontendPath);
  assert.equal(frontendPath.statusCode, 404);
  assert.equal(requested, false);
});

test('forwards allowed requests with a private proxy secret and preserves response cookies', async () => {
  let capturedOptions;
  let requestBody = '';
  const handler = createProxyHandler({
    env: ENV,
    request: (options, callback) => {
      capturedOptions = options;
      const upstreamRequest = new Writable({
        write(chunk, _encoding, done) {
          requestBody += chunk.toString();
          done();
        },
      });
      upstreamRequest.on('finish', () => {
        const upstreamResponse = new PassThrough();
        upstreamResponse.statusCode = 201;
        upstreamResponse.headers = {
          'content-type': 'application/json',
          'set-cookie': [
            'coderax-auth=one; HttpOnly; Secure',
            'coderax-refresh=two; HttpOnly; Secure',
          ],
          connection: 'close',
        };
        callback(upstreamResponse);
        upstreamResponse.end('{"ok":true}');
      });
      return upstreamRequest;
    },
  });

  const incoming = new PassThrough();
  incoming.url = '/api/auth/guest?mode=fast';
  incoming.method = 'POST';
  incoming.headers = {
    host: 'coderaxai.vercel.app',
    origin: 'https://coderaxai.vercel.app',
    'content-type': 'application/json',
    'x-forwarded-host': 'attacker.example',
    'x-coderax-proxy-secret': 'attacker-supplied',
    'x-vercel-forwarded-for': '8.8.8.8',
  };
  const res = responseStub();
  handler(incoming, res);
  incoming.end('{"guest":true}');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(capturedOptions.hostname, 'coderax-93-184-216-34.sslip.io');
  assert.equal(capturedOptions.path, '/api/auth/guest?mode=fast');
  assert.equal(capturedOptions.headers['x-coderax-proxy-secret'], ENV.CODERAX_PROXY_SECRET);
  assert.equal(capturedOptions.headers['x-forwarded-host'], 'coderaxai.vercel.app');
  assert.equal(capturedOptions.headers['x-forwarded-proto'], 'https');
  assert.equal(capturedOptions.headers['x-forwarded-for'], '8.8.8.8');
  assert.equal(capturedOptions.headers['x-forwarded-host'].includes('attacker'), false);
  assert.equal(requestBody, '{"guest":true}');
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.headers['set-cookie'], [
    'coderax-auth=one; HttpOnly; Secure',
    'coderax-refresh=two; HttpOnly; Secure',
  ]);
  assert.equal(res.headers.connection, undefined);
});

test('a mid-stream upstream error closes the downstream response without escaping', async () => {
  const handler = createProxyHandler({
    env: ENV,
    request: (_options, callback) => {
      const upstreamRequest = new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });
      upstreamRequest.on('finish', () => {
        const upstreamResponse = new PassThrough();
        upstreamResponse.statusCode = 200;
        upstreamResponse.headers = { 'content-type': 'text/event-stream' };
        callback(upstreamResponse);
        upstreamResponse.write('data: {"partial":true}\n\n');
        upstreamResponse.emit('error', new Error('upstream disconnected'));
      });
      return upstreamRequest;
    },
  });

  const incoming = new PassThrough();
  incoming.url = '/api/agents/chat';
  incoming.method = 'POST';
  incoming.headers = { host: 'coderaxai.vercel.app' };
  const res = responseStub();
  handler(incoming, res);
  incoming.end('{}');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(res.body, 'data: {"partial":true}\n\n');
  assert.equal(res.destroyed, true);
});


test('a silent TLS handshake fails before the function deadline with a 504', async () => {
  const handler = createProxyHandler({
    env: ENV,
    timeouts: { connectMs: 15, firstResponseMs: 100, streamIdleMs: 100, totalMs: 150 },
    request: () => new Writable({ write(_chunk, _encoding, done) { done(); } }),
  });
  const incoming = new PassThrough();
  incoming.url = '/api/config';
  incoming.method = 'GET';
  incoming.headers = { host: 'coderaxai.vercel.app' };
  const res = responseStub();
  handler(incoming, res);
  incoming.end();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(res.statusCode, 504);
  assert.match(res.body, /"stage":"connect"/);
});

test('a connected upstream that never sends headers returns a bounded 504', async () => {
  const handler = createProxyHandler({
    env: ENV,
    timeouts: { connectMs: 100, firstResponseMs: 15, streamIdleMs: 100, totalMs: 150 },
    request: () => {
      const upstream = new Writable({ write(_chunk, _encoding, done) { done(); } });
      queueMicrotask(() => {
        const socket = Object.assign(new EventEmitter(), {
          encrypted: true, connecting: false, secureConnecting: false,
        });
        upstream.emit('socket', socket);
      });
      return upstream;
    },
  });
  const incoming = new PassThrough();
  incoming.url = '/api/config';
  incoming.method = 'GET';
  incoming.headers = { host: 'coderaxai.vercel.app' };
  const res = responseStub();
  handler(incoming, res);
  incoming.end();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(res.statusCode, 504);
  assert.match(res.body, /"stage":"first_response"/);
});

test('an upstream that stops emitting SSE chunks closes the downstream stream', async () => {
  const handler = createProxyHandler({
    env: ENV,
    timeouts: { connectMs: 100, firstResponseMs: 100, streamIdleMs: 15, totalMs: 150 },
    request: (_options, callback) => {
      const upstream = new Writable({ write(_chunk, _encoding, done) { done(); } });
      upstream.on('finish', () => {
        const response = new PassThrough();
        response.statusCode = 200;
        response.headers = { 'content-type': 'text/event-stream' };
        callback(response);
        response.write('data: {"token":"hi"}\n\n');
      });
      return upstream;
    },
  });
  const incoming = new PassThrough();
  incoming.url = '/api/agents/chat';
  incoming.method = 'POST';
  incoming.headers = { host: 'coderaxai.vercel.app' };
  const res = responseStub();
  handler(incoming, res);
  incoming.end('{}');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'data: {"token":"hi"}\n\n');
  assert.equal(res.destroyed, true);
});

test('active SSE chunks reset the idle deadline and preserve the complete stream', async () => {
  const chunks = ['data: one\n\n', 'data: two\n\n', 'data: three\n\n'];
  const handler = createProxyHandler({
    env: ENV,
    timeouts: { connectMs: 100, firstResponseMs: 100, streamIdleMs: 35, totalMs: 250 },
    request: (_options, callback) => {
      const upstream = new Writable({ write(_chunk, _encoding, done) { done(); } });
      upstream.on('finish', () => {
        const response = new PassThrough();
        response.statusCode = 200;
        response.headers = { 'content-type': 'text/event-stream' };
        callback(response);
        chunks.forEach((chunk, index) => setTimeout(() => {
          response.write(chunk);
          if (index === chunks.length - 1) response.end();
        }, 10 + index * 15));
      });
      return upstream;
    },
  });
  const incoming = new PassThrough();
  incoming.url = '/api/agents/chat';
  incoming.method = 'POST';
  incoming.headers = { host: 'coderaxai.vercel.app' };
  const res = responseStub();
  handler(incoming, res);
  incoming.end('{}');
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, chunks.join(''));
  assert.equal(res.writableEnded, true);
  assert.equal(res.destroyed, false);
});
