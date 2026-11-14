import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { checkLocalOllama, localOllamaOrigin } from './check-local-ollama.mjs';

const encoder = new TextEncoder();

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const chatLine = ({ model = 'qwen3.5:4b', content = '', done = false } = {}) =>
  `${JSON.stringify({ model, message: { content }, done })}\n`;

const streamResponse = (lines, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  body: new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  }),
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

function createOllamaStub(lines) {
  const requests = [];
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/api/tags') {
      requests.push({ method: request.method, url: request.url });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ models: [{ name: 'qwen3.5:4b' }] }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/chat') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        requests.push({ method: request.method, url: request.url, body: JSON.parse(body) });
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        for (const line of lines) {
          response.write(line);
        }
        response.end();
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return { server, requests };
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

test('checks Qwen 3.5 4B with a key-free streamed chat and refuses redirects', async () => {
  const calls = [];
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    streamResponse([
      chatLine({ content: 'LOCAL' }),
      chatLine({ content: '_OK' }),
      chatLine({ done: true }),
    ]),
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
    stream: true,
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

test('rejects a stream that finishes without any generated content', async () => {
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    streamResponse([chatLine({ done: true })]),
  ];

  await assert.rejects(
    checkLocalOllama({ fetchImpl: async () => responses.shift() }),
    /Local Ollama chat returned an empty reply/,
  );
});

test('rejects a stream that closes before a terminal done chunk', async () => {
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    streamResponse([chatLine({ content: 'partial' })]),
  ];

  await assert.rejects(
    checkLocalOllama({ fetchImpl: async () => responses.shift() }),
    /Local Ollama chat did not finish/,
  );
});

test('rejects a malformed stream chunk instead of accepting partial text', async () => {
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    streamResponse(['not-json\n', chatLine({ done: true })]),
  ];

  await assert.rejects(
    checkLocalOllama({ fetchImpl: async () => responses.shift() }),
    /malformed stream chunk/,
  );
});

test('rejects a stream when a different model answers', async () => {
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    streamResponse([
      chatLine({ model: 'different:tag', content: 'LOCAL_OK' }),
      chatLine({ model: 'different:tag', done: true }),
    ]),
  ];

  await assert.rejects(
    checkLocalOllama({ fetchImpl: async () => responses.shift() }),
    /Local Ollama chat returned a different model/,
  );
});

test('reports a timeout instead of an unbounded readiness wait', async () => {
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            throw error;
          },
          releaseLock() {},
        }),
      },
    },
  ];

  await assert.rejects(
    checkLocalOllama({ fetchImpl: async () => responses.shift() }),
    /Local Ollama readiness check timed out/,
  );
});

test('propagates an unavailable local host', async () => {
  const fetchImpl = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
  };

  await assert.rejects(checkLocalOllama({ fetchImpl }), /ECONNREFUSED/);
});

test('validates the readiness timeout range', async () => {
  await assert.rejects(checkLocalOllama({ timeoutMs: 0 }), /timeoutMs must be between/);
  await assert.rejects(checkLocalOllama({ timeoutMs: 120001 }), /timeoutMs must be between/);
});

test('rejects a complete non-streaming reply that never yielded a content chunk', async () => {
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    streamResponse([
      JSON.stringify({
        model: 'qwen3.5:4b',
        message: { content: 'LOCAL_OK' },
        done: true,
      }),
    ]),
  ];

  await assert.rejects(
    checkLocalOllama({ fetchImpl: async () => responses.shift() }),
    /Local Ollama chat did not stream content/,
  );
});

test('rejects JSON values that are not stream chunks', async () => {
  for (const line of ['42', 'true', 'null', '[]']) {
    const responses = [
      jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
      streamResponse([`${line}\n`]),
    ];

    await assert.rejects(
      checkLocalOllama({ fetchImpl: async () => responses.shift() }),
      /malformed stream chunk/,
    );
  }
});

test('rejects oversized content as soon as it arrives', async () => {
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    streamResponse([chatLine({ content: 'x'.repeat(50) }), chatLine({ done: true })]),
  ];

  await assert.rejects(
    checkLocalOllama({ fetchImpl: async () => responses.shift(), maxReplyChars: 10 }),
    /exceeded the maximum size/,
  );
});

test('rejects an oversized unterminated line before it buffers without bound', async () => {
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    streamResponse([
      JSON.stringify({
        model: 'qwen3.5:4b',
        message: { content: 'x'.repeat(50) },
        done: false,
      }),
    ]),
  ];

  await assert.rejects(
    checkLocalOllama({ fetchImpl: async () => responses.shift(), maxReplyChars: 10 }),
    /exceeded the maximum size/,
  );
});

test('cancels the response reader when a terminal chunk ends the check', async () => {
  let cancelled = false;
  let reads = 0;
  const responses = [
    jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }),
    {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            if (reads === 1) {
              return { done: false, value: encoder.encode(chatLine({ content: 'LOCAL' })) };
            }
            return { done: false, value: encoder.encode(chatLine({ done: true })) };
          },
          cancel: async () => {
            cancelled = true;
          },
          releaseLock() {},
        }),
      },
    },
  ];

  const result = await checkLocalOllama({ fetchImpl: async () => responses.shift() });

  assert.deepEqual(result, {
    status: 'ready',
    model: 'qwen3.5:4b',
    origin: 'http://127.0.0.1:11434',
  });
  assert.equal(cancelled, true);
});

test('validates the reply size limit', async () => {
  await assert.rejects(checkLocalOllama({ maxReplyChars: 0 }), /maxReplyChars/);
  await assert.rejects(checkLocalOllama({ maxReplyChars: 1.5 }), /maxReplyChars/);
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
    response.end(JSON.stringify({ message: { content: 'REMOTE_OK' }, done: true }));
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

test('checks readiness through the real loopback HTTP stream flow', async (t) => {
  const stub = createOllamaStub([
    chatLine({ content: 'LOCAL' }),
    chatLine({ content: '_OK' }),
    chatLine({ done: true }),
  ]);
  const host = await listen(stub.server);
  t.after(() => close(stub.server));

  const result = await checkLocalOllama({ host });

  assert.deepEqual(result, { status: 'ready', model: 'qwen3.5:4b', origin: host });
  assert.deepEqual(stub.requests, [
    { method: 'GET', url: '/api/tags' },
    {
      method: 'POST',
      url: '/api/chat',
      body: {
        model: 'qwen3.5:4b',
        messages: [{ role: 'user', content: 'Reply with LOCAL_OK.' }],
        stream: true,
        think: false,
        options: { num_predict: 32 },
      },
    },
  ]);
});

test('rejects an incomplete reply over the real loopback HTTP stream flow', async (t) => {
  const stub = createOllamaStub([chatLine({ content: 'partial' })]);
  const host = await listen(stub.server);
  t.after(() => close(stub.server));

  await assert.rejects(checkLocalOllama({ host }), /Local Ollama chat did not finish/);
  assert.equal(stub.requests.length, 2);
});
