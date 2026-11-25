import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyModelTarget, formatProbeSuccess, probeModel } from './probe-cloud-model.mjs';

const MODEL = 'qwen3.5:4b';

function stubFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next;
  };
  return { fetchImpl, calls };
}

const inventory = (id = MODEL) => ({ ok: true, json: async () => ({ data: [{ id }] }) });
const reply = (content = 'MODEL_PROBE_OK') => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

test('names a private Docker Ollama endpoint as such', () => {
  const target = classifyModelTarget('http://ollama:11434/v1/');
  assert.equal(target.placement, 'private-docker-service');
  const report = formatProbeSuccess(target.placement);
  assert.match(report, /^MODEL_PROBE_OK$/m);
  assert.match(report, /MODEL_PLACEMENT: private-docker-service/);
  assert.doesNotMatch(report, /remote inference verified/i);
  assert.doesNotMatch(report, /cloud inference verified/i);
});

test('names an authenticated HTTPS endpoint as remote, not cloud', () => {
  const target = classifyModelTarget('https://inference.example.com/v1/');
  assert.equal(target.placement, 'remote-https');
  const report = formatProbeSuccess(target.placement);
  assert.match(report, /MODEL_PLACEMENT: remote-https/);
  assert.doesNotMatch(report, /cloud inference verified/i);
});

test('rejects plain HTTP that is not the private Docker service', () => {
  for (const base of [
    'http://localhost:11434/v1/',
    'http://127.0.0.1:11434/v1/',
    'http://inference.example.com/v1/',
  ]) {
    assert.throws(() => classifyModelTarget(base), /HTTPS or private Docker service ollama/);
  }
});

test('rejects credentials, query strings and a non-v1 path', () => {
  for (const base of [
    'https://user:pass@inference.example.com/v1/',
    'https://inference.example.com/v1/?key=secret',
    'https://inference.example.com/api/',
  ]) {
    assert.throws(() => classifyModelTarget(base));
  }
});

test('probes the Docker service without fabricating a remote claim', async () => {
  const { fetchImpl, calls } = stubFetch([inventory(), reply()]);
  const result = await probeModel({ base: 'http://ollama:11434/v1/', model: MODEL, fetchImpl });

  assert.deepEqual(result, { placement: 'private-docker-service', model: MODEL });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://ollama:11434/v1/models');
  assert.equal(calls[1].url, 'http://ollama:11434/v1/chat/completions');
  assert.equal('Authorization' in calls[0].options.headers, false);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.model, MODEL);
  assert.match(body.messages[0].content, /MODEL_PROBE_OK/);
});

test('requires a token for an authenticated HTTPS endpoint', async () => {
  await assert.rejects(
    probeModel({
      base: 'https://inference.example.com/v1/',
      model: MODEL,
      token: '',
      fetchImpl: fetch,
    }),
    /requires CODERAX_MODEL_INTERNAL_TOKEN/,
  );
});

test('sends the token to an HTTPS endpoint but never reports its value', async () => {
  const { fetchImpl, calls } = stubFetch([inventory(), reply()]);
  const result = await probeModel({
    base: 'https://inference.example.com/v1/',
    model: MODEL,
    token: 'secret-token',
    fetchImpl,
  });

  assert.equal(result.placement, 'remote-https');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  const report = formatProbeSuccess(result.placement);
  assert.doesNotMatch(report, /secret-token/);
});

test('fails closed when the model is absent from the inventory', async () => {
  const { fetchImpl } = stubFetch([inventory('another-model')]);
  await assert.rejects(
    probeModel({ base: 'http://ollama:11434/v1/', model: MODEL, fetchImpl }),
    /Required model is missing/,
  );
});

test('fails closed on an unverifiable completion', async () => {
  const { fetchImpl } = stubFetch([inventory(), reply('something else')]);
  await assert.rejects(
    probeModel({ base: 'http://ollama:11434/v1/', model: MODEL, fetchImpl }),
    /no verifiable response/,
  );
});
