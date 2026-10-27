'use strict';

const DEFAULT_BASE_URL = 'https://coderaxai.vercel.app';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

class CoderaxApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CoderaxApiError';
    this.status = status;
  }
}

function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Coderax API URL must be a valid HTTPS origin.');
  }

  const isLocalHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('Coderax API URL must use HTTPS. HTTP is allowed only for localhost.');
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Coderax API URL must be an origin without credentials, path, query, or fragment.');
  }

  return url.origin;
}

function messageForStatus(status) {
  if (status === 401) return 'Coderax rejected the API key or sign-in. Check the credentials and try again.';
  if (status === 403) return 'This account or API key does not have permission to use remote agents.';
  if (status === 404) return 'This Coderax service does not expose the requested API route.';
  if (status === 429) return 'Coderax rate limited this request. Wait briefly and try again.';
  return `Coderax returned HTTP ${status}.`;
}

async function requestJson({
  baseUrl,
  path,
  method = 'GET',
  apiKey,
  bearerToken,
  body,
  sameOrigin = false,
  allowEmpty = false,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This VS Code runtime does not provide HTTPS fetch support.');
  }
  const origin = normalizeBaseUrl(baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: 'application/json' };
  const credential = apiKey || bearerToken;
  if (credential) headers.Authorization = `Bearer ${credential}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (sameOrigin) {
    // Coderax's browser login and 2FA routes require same-origin requests.
    // This native client sends those credentials directly to the selected HTTPS origin.
    headers.Origin = origin;
    headers.Referer = `${origin}/`;
  }

  try {
    const response = await fetchImpl(new URL(path, `${origin}/`), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });

    const length = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
      throw new Error('Coderax response exceeded the allowed size.');
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('Coderax response exceeded the allowed size.');
    }
    if (!response.ok) {
      // Do not surface the body: upstream error bodies can contain private details.
      throw new CoderaxApiError(response.status, messageForStatus(response.status));
    }
    if (allowEmpty && text.trim() === '') return undefined;
    const contentType = response.headers?.get?.('content-type') || '';
    if (!/application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(contentType)) {
      throw new Error('Coderax returned a non-JSON response. Check the configured service URL.');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Coderax returned an invalid JSON response.');
    }
  } catch (error) {
    if (error instanceof CoderaxApiError) throw error;
    if (error?.name === 'AbortError') throw new Error('Coderax request timed out.');
    if (error instanceof TypeError) throw new Error('Could not reach Coderax over HTTPS. Check the service URL and network.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getModels(baseUrl, apiKey, options = {}) {
  const response = await requestJson({
    baseUrl,
    path: '/api/agents/v1/models',
    apiKey,
    ...options,
  });
  if (!Array.isArray(response?.data)) {
    throw new Error('Coderax returned an unexpected model list.');
  }
  return response.data.filter((model) => model && typeof model.id === 'string');
}

async function askAgent(baseUrl, apiKey, model, prompt, options = {}) {
  const response = await requestJson({
    baseUrl,
    path: '/api/agents/v1/chat/completions',
    method: 'POST',
    apiKey,
    body: {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    },
    timeoutMs: 120_000,
    ...options,
  });
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  throw new Error('Coderax returned no assistant response.');
}

async function loginWithPassword(baseUrl, email, password, options = {}) {
  return requestJson({
    baseUrl,
    path: '/api/auth/login',
    method: 'POST',
    body: { email, password },
    sameOrigin: true,
    ...options,
  });
}

async function verifyTotp(baseUrl, tempToken, code, options = {}) {
  return requestJson({
    baseUrl,
    path: '/api/auth/2fa/verify-temp',
    method: 'POST',
    body: { tempToken, code },
    sameOrigin: true,
    ...options,
  });
}

async function createApiKey(baseUrl, bearerToken, expiresAt, options = {}) {
  return requestJson({
    baseUrl,
    path: '/api/api-keys',
    method: 'POST',
    bearerToken,
    body: { name: 'Coderax VS Code Extension', expiresAt },
    ...options,
  });
}

async function revokeApiKey(baseUrl, bearerToken, id, options = {}) {
  return requestJson({
    baseUrl,
    path: `/api/api-keys/${encodeURIComponent(id)}`,
    method: 'DELETE',
    bearerToken,
    allowEmpty: true,
    ...options,
  });
}

module.exports = {
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
};
