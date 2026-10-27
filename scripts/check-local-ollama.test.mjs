import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { checkLocalOllama, localOllamaOrigin } from './check-local-ollama.mjs';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server) {
  if (!server.listening) {
    return;
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test('defaults to the local Ollama loopback endpoint', () => {
  assert.equal(localOllamaOrigin(), 'http://127.0.0.1:11434');
  assert.equal(localOllamaOrigin('http://localhost:11434'), 'http://localhost:11434');
});

test('rejects non-loopback or credentialed readiness endpoints', () => {
  for (const host of [
    'https://127.0.0.1:11434',
    'http://ollama.example:11434',
    'http://user:password@127.0.0.1:11434',
    'http://127.0.0.1:11434/base',
    'http://127.0.0.1:11434/?token=secret',
  ]) {
    assert.throws(() => localOllamaOrigin(host));
  }
});

test('checks Qwen 3.5 4B with key-free requests and refuses redirects', async () => {
  const calls = [];
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    jsonResponse({ model: 'qwen3.5:4b', done: true, message: { content: 'LOCAL_OK' } }),
  ];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return responses.shift();
  };

  const result = await checkLocalOllama({ host: 'http://localhost:11434', fetchImpl });

  assert.deepEqual(result, {
    status: 'ready',
    model: 'qwen3.5:4b',
    origin: 'http://localhost:11434',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(calls[1].options.headers, { 'content-type': 'application/json' });
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    model: 'qwen3.5:4b',
    messages: [{ role: 'user', content: 'Reply with LOCAL_OK.' }],
    stream: false,
    think: false,
    options: { num_predict: 32 },
  });
});

test('does not send chat when the required local model is missing', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ models: [{ name: 'other-model' }] });
  };

  await assert.rejects(
    checkLocalOllama({ fetchImpl }),
    /Required local model qwen3\.5:4b is not installed/,
  );
  assert.equal(calls, 1);
});

test('rejects an empty local chat response', async () => {
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    jsonResponse({ message: { content: '  ' } }),
  ];

  await assert.rejects(
    checkLocalOllama({ fetchImpl: async () => responses.shift() }),
    /Local Ollama chat returned an empty reply/,
  );
});

test('does not report readiness when Ollama returns an incomplete response', async () => {
  for (const done of [false, undefined]) {
    const responses = [
      jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
      jsonResponse({ model: 'qwen3.5:4b', done, message: { content: 'partial' } }),
    ];
    await assert.rejects(
      checkLocalOllama({ fetchImpl: async () => responses.shift() }),
      /Local Ollama chat did not finish/,
    );
  }
});

test('does not report readiness when a different model answers', async () => {
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    jsonResponse({ model: 'different:tag', done: true, message: { content: 'LOCAL_OK' } }),
  ];
  await assert.rejects(
    checkLocalOllama({ fetchImpl: async () => responses.shift() }),
    /Local Ollama chat returned a different model/,
  );
});

test('validates the readiness timeout range', async () => {
  await assert.rejects(checkLocalOllama({ timeoutMs: 0 }), /timeoutMs must be between/);
  await assert.rejects(checkLocalOllama({ timeoutMs: 120001 }), /timeoutMs must be between/);
});

test('does not follow a model-inventory redirect to another server', async (t) => {
  let redirectedRequests = 0;
  const target = createServer((_request, response) => {
    redirectedRequests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ models: [{ name: 'qwen3.5:4b' }] }));
  });
  const targetURL = await listen(target);
  const source = createServer((_request, response) => {
    response.writeHead(302, { location: `${targetURL}/api/tags` });
    response.end();
  });
  const sourceURL = await listen(source);
  t.after(async () => {
    await close(source);
    await close(target);
  });

  await assert.rejects(checkLocalOllama({ host: sourceURL }));
  assert.equal(redirectedRequests, 0);
});

test('does not follow a chat redirect to another server', async (t) => {
  let redirectedRequests = 0;
  const target = createServer((_request, response) => {
    redirectedRequests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: { content: 'REMOTE_OK' } }));
  });
  const targetURL = await listen(target);
  const source = createServer((request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ models: [{ name: 'qwen3.5:4b' }] }));
      return;
    }
    response.writeHead(302, { location: `${targetURL}/api/chat` });
    response.end();
  });
  const sourceURL = await listen(source);
  t.after(async () => {
    await close(source);
    await close(target);
  });

  await assert.rejects(checkLocalOllama({ host: sourceURL }));
  assert.equal(redirectedRequests, 0);
});
