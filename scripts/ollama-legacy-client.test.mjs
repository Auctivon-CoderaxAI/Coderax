import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../api/app/clients/OllamaClient.js', import.meta.url), 'utf8');
const field = { optional() { return this; }, nullable() { return this; } };
const z = {
  number: () => field, string: () => field, boolean: () => field,
  array: () => field, optional: () => field,
  object: () => ({ parse: (payload) => ({ model: payload.model, stream: payload.stream }) }),
};

function harness(handler) {
  const calls = [];
  class FakeOllama {
    async chat(request) {
      calls.push(request);
      return handler(request);
    }
  }
  const modules = {
    zod: { z },
    axios: { get: async () => ({ data: { models: [] } }) },
    ollama: { Ollama: FakeOllama },
    '@librechat/agents': { sleep: async () => {} },
    '@coderax/data-schemas': { logger: { error: () => {} } },
    'coderax-data-provider': { Constants: { DEFAULT_STREAM_RATE: 0 } },
    '@coderax/api': { resolveHeaders: () => ({}), deriveBaseURL: (url) => url },
  };
  const module = { exports: {} };
  runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) => {
      if (!Object.hasOwn(modules, name)) throw new Error('Unexpected dependency: ' + name);
      return modules[name];
    },
  }, { filename: 'OllamaClient.js' });
  return { OllamaClient: module.exports.OllamaClient, calls };
}

const payload = (stream) => ({
  model: 'qwen3.5:4b',
  messages: [{ role: 'user', content: 'say LOCAL_OK' }],
  ...(stream === undefined ? {} : { stream }),
});

test('non-streaming model chat invokes transport and delivers reply once', async () => {
  const { OllamaClient, calls } = harness(async () => ({ message: { content: 'LOCAL_OK' } }));
  const progress = [];
  const result = await new OllamaClient().chatCompletion({
    payload: payload(false), onProgress: (text) => progress.push(text),
  });
  assert.equal(result, 'LOCAL_OK');
  assert.deepEqual(progress, ['LOCAL_OK']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stream, false);
  assert.equal(calls[0].model, 'qwen3.5:4b');
  assert.equal(calls[0].messages[0].content, 'say LOCAL_OK');
});

test('omitted stream flag still performs non-streaming chat without callback', async () => {
  const { OllamaClient, calls } = harness(async () => ({ message: { content: 'DEFAULT_OK' } }));
  const result = await new OllamaClient().chatCompletion({ payload: payload() });
  assert.equal(result, 'DEFAULT_OK');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stream, false);
});

test('pre-aborted request never calls the model transport', async () => {
  const { OllamaClient, calls } = harness(async () => ({ message: { content: 'UNEXPECTED' } }));
  const result = await new OllamaClient().chatCompletion({
    payload: payload(false), abortController: { signal: { aborted: true } },
  });
  assert.equal(result, '');
  assert.equal(calls.length, 0);
});

test('aborted in-flight non-streaming request does not deliver late result', async () => {
  const signal = { aborted: false };
  const { OllamaClient, calls } = harness(async () => {
    signal.aborted = true;
    return { message: { content: 'LATE' } };
  });
  const progress = [];
  const result = await new OllamaClient().chatCompletion({
    payload: payload(false), abortController: { signal },
    onProgress: (text) => progress.push(text),
  });
  assert.equal(result, '');
  assert.equal(calls.length, 1);
  assert.deepEqual(progress, []);
});

test('streaming works without optional AbortController', async () => {
  const { OllamaClient, calls } = harness(async () => ({
    async *[Symbol.asyncIterator]() {
      yield { message: { content: 'A' } };
      yield { message: { content: 'B' } };
    },
  }));
  const progress = [];
  const result = await new OllamaClient().chatCompletion({
    payload: payload(true), onProgress: (text) => progress.push(text),
  });
  assert.equal(result, 'AB');
  assert.deepEqual(progress, ['A', 'B']);
  assert.equal(calls.length, 1);
});

test('streaming cancellation calls iterator abort and does not emit another chunk', async () => {
  const signal = { aborted: false };
  let aborts = 0;
  const { OllamaClient } = harness(async () => ({
    abort: () => { aborts += 1; },
    async *[Symbol.asyncIterator]() {
      yield { message: { content: 'A' } };
      yield { message: { content: 'B' } };
    },
  }));
  const progress = [];
  const result = await new OllamaClient().chatCompletion({
    payload: payload(true), abortController: { signal },
    onProgress: (text) => { progress.push(text); signal.aborted = true; },
  });
  assert.equal(result, 'A');
  assert.deepEqual(progress, ['A']);
  assert.equal(aborts, 1);
});
