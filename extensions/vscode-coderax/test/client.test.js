'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const {
  CoderaxApiError,
  DEFAULT_BASE_URL,
  askAgent,
  createApiKey,
  getModels,
  loginWithPassword,
  normalizeBaseUrl,
  requestJson,
  revokeApiKey,
  verifyTotp,
} = require('../client');

function jsonResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null;
      },
    },
    text: async () => JSON.stringify(value),
  };
}

test('base URL accepts the default and rejects credentials, paths, and insecure remote hosts', () => {
  assert.equal(normalizeBaseUrl(DEFAULT_BASE_URL), DEFAULT_BASE_URL);
  assert.equal(normalizeBaseUrl('http://localhost:3080'), 'http://localhost:3080');
  assert.throws(() => normalizeBaseUrl('http://coderax.example'), /HTTPS/);
  assert.throws(() => normalizeBaseUrl('https://user:pass@coderax.example'), /origin/);
  assert.throws(() => normalizeBaseUrl('https://coderax.example/path'), /origin/);
});

test('model lookup authenticates to the Coderax remote-agent endpoint', async () => {
  let request;
  const models = await getModels(DEFAULT_BASE_URL, 'test-api-key', {
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse(200, { object: 'list', data: [{ id: 'agent-1', name: 'Agent 1' }] });
    },
  });
  assert.deepEqual(models, [{ id: 'agent-1', name: 'Agent 1' }]);
  assert.equal(request.url, `${DEFAULT_BASE_URL}/api/agents/v1/models`);
  assert.equal(request.options.headers.Authorization, 'Bearer test-api-key');
  assert.equal(request.options.redirect, 'error');
});

test('chat completion sends a non-streaming OpenAI-compatible request and extracts the answer', async () => {
  let request;
  const answer = await askAgent(DEFAULT_BASE_URL, 'test-api-key', 'agent-1', 'Explain the change', {
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse(200, { choices: [{ message: { content: 'Looks good.' } }] });
    },
  });
  assert.equal(answer, 'Looks good.');
  assert.equal(request.url, `${DEFAULT_BASE_URL}/api/agents/v1/chat/completions`);
  assert.deepEqual(JSON.parse(request.options.body), {
    model: 'agent-1',
    messages: [{ role: 'user', content: 'Explain the change' }],
    stream: false,
  });
});

test('login and two-factor requests use the configured origin and exact server routes', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse(200, { token: 'short-lived-session-token' });
  };
  await loginWithPassword(DEFAULT_BASE_URL, 'user@example.test', 'one-time-password', { fetchImpl });
  await verifyTotp(DEFAULT_BASE_URL, 'temporary-token', '123456', { fetchImpl });
  assert.equal(calls[0].url, `${DEFAULT_BASE_URL}/api/auth/login`);
  assert.equal(calls[0].options.headers.Origin, DEFAULT_BASE_URL);
  assert.equal(calls[0].options.headers.Referer, `${DEFAULT_BASE_URL}/`);
  assert.equal(calls[1].url, `${DEFAULT_BASE_URL}/api/auth/2fa/verify-temp`);
  assert.deepEqual(JSON.parse(calls[1].options.body), { tempToken: 'temporary-token', code: '123456' });
});

test('API key creation is authenticated and sends its expiry', async () => {
  let request;
  await createApiKey(DEFAULT_BASE_URL, 'short-lived-session-token', '2026-11-23T00:00:00.000Z', {
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse(201, { id: 'key-id', key: 'test-api-key' });
    },
  });
  assert.equal(request.url, `${DEFAULT_BASE_URL}/api/api-keys`);
  assert.equal(request.options.headers.Authorization, 'Bearer short-lived-session-token');
  assert.equal(JSON.parse(request.options.body).expiresAt, '2026-11-23T00:00:00.000Z');
});

test('API key revocation accepts the server no-content response', async () => {
  let request;
  const result = await revokeApiKey(DEFAULT_BASE_URL, 'short-lived-session-token', 'key-id', {
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return {
        ok: true,
        status: 204,
        headers: { get: () => null },
        text: async () => '',
      };
    },
  });
  assert.equal(result, undefined);
  assert.equal(request.url, `${DEFAULT_BASE_URL}/api/api-keys/key-id`);
  assert.equal(request.options.headers.Authorization, 'Bearer short-lived-session-token');
});

test('extension keeps Coderax credentials in SecretStorage and has no database URI setting', async () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const source = await readFile(path.join(root, 'extension.js'), 'utf8');
  const client = await readFile(path.join(root, 'client.js'), 'utf8');
  const sourceText = `${JSON.stringify(manifest)}\n${source}\n${client}`;
  assert.match(source, /context\.secrets\.store\(API_KEY_SECRET/);
  assert.match(source, /context\.secrets\.get\(API_KEY_SECRET/);
  assert.doesNotMatch(sourceText, /mongodb(?:\+srv)?:\/\//i);
  assert.doesNotMatch(sourceText, /\bMONGO_URI\b/i);
  assert.equal(manifest.contributes.configuration.properties['coderax.mongoUri'], undefined);
  assert.equal(manifest.contributes.configuration.properties['coderax.apiKey'], undefined);
});

test('HTTP errors do not expose upstream response bodies', async () => {
  await assert.rejects(
    requestJson({
      baseUrl: DEFAULT_BASE_URL,
      path: '/api/agents/v1/models',
      apiKey: 'test-api-key',
      fetchImpl: async () => jsonResponse(401, { error: 'private server detail should not be displayed' }),
    }),
    (error) => {
      assert.ok(error instanceof CoderaxApiError);
      assert.match(error.message, /rejected the API key/);
      assert.doesNotMatch(error.message, /private server detail/);
      return true;
    },
  );
});
