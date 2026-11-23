#!/usr/bin/env node
/**
 * Verify the zero-cost inference catalog against the live providers.
 *
 * Two different claims are checked, and never mixed together:
 *   1. Free terms: the provider's public catalog still prices the model at $0.
 *   2. Working inference: an authenticated completion succeeds with the
 *      configured credential and returns the expected shape.
 *
 * A catalog entry is evidence of price, not proof that a credential works. This
 * script prints `verified` only after (2) succeeds. Without a credential it
 * reports `blocked`, which is the honest state rather than a guess.
 *
 * Usage:
 *   npm run build:data-provider
 *   node scripts/verify-free-inference.mjs [--out docs/free-inference-verification.json]
 *                                          [--require-inference]
 *
 * Exit codes: 0 = audit complete (blocked endpoints allowed), 1 = a credentialed
 * endpoint failed or the public catalog no longer matches the allowlist, 2 = the
 * catalog could not be imported (build the data provider first).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const requireInference = process.argv.includes('--require-inference');
const outIndex = process.argv.indexOf('--out');
const outPath = resolve(
  root,
  outIndex !== -1 && process.argv[outIndex + 1]
    ? process.argv[outIndex + 1]
    : 'docs/free-inference-verification.json',
);

let catalog;
try {
  catalog = await import(new URL('../packages/data-provider/dist/index.mjs', import.meta.url));
} catch {
  console.error('Could not import packages/data-provider/dist. Run: npm run build:data-provider');
  process.exit(2);
}

const { DEEPSEEK_R1_PRIMARY, FREE_ENDPOINTS, isFullDeepSeekR1 } = catalog;
const checkedAt = new Date().toISOString();
const results = [];

function isZeroPrice(value) {
  return value === '0' || value === 0;
}

const PROBE_MAX_TOKENS = 64;

function readGeneratedText(payload, provider) {
  if (payload == null || typeof payload !== 'object') return null;
  if (provider === 'cloudflare') {
    const response = payload.result?.response;
    return typeof response === 'string' && response.trim() !== '' ? response : null;
  }
  const message = payload.choices?.[0]?.message;
  if (message == null || typeof message !== 'object') return null;
  for (const field of ['content', 'reasoning', 'reasoning_content']) {
    const value = message[field];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function errorCodeFor(status) {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_error';
  return 'invalid_response';
}

async function checkPublicCatalog() {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    return { ok: false, status: response.status, detail: 'OpenRouter catalog unavailable' };
  }
  const body = await response.json();
  const models = Array.isArray(body.data) ? body.data : [];
  const r1 = models.filter(
    (model) =>
      typeof model.id === 'string' && /deepseek-r1/i.test(model.id) && isFullDeepSeekR1(model.id),
  );
  const freeR1 = r1.filter(
    (model) => isZeroPrice(model.pricing?.prompt) && isZeroPrice(model.pricing?.completion),
  );
  const freeModelIds = new Set(
    models
      .filter((model) => /:free$/.test(model.id ?? ''))
      .filter(
        (model) => isZeroPrice(model.pricing?.prompt) && isZeroPrice(model.pricing?.completion),
      )
      .map((model) => model.id),
  );

  const listed = FREE_ENDPOINTS.filter((endpoint) => endpoint.provider === 'openrouter').map(
    (endpoint) => ({
      id: endpoint.id,
      modelId: endpoint.modelId,
      listedFree: freeModelIds.has(endpoint.modelId),
      tools: endpoint.modelId.includes(':free'),
    }),
  );

  return {
    ok: freeR1.length === 0 && listed.every((entry) => entry.listedFree),
    status: response.status,
    modelCount: models.length,
    freeModelCount: freeModelIds.size,
    fullR1Endpoints: r1.map((model) => ({
      id: model.id,
      prompt: model.pricing?.prompt ?? null,
      completion: model.pricing?.completion ?? null,
    })),
    freeFullR1: freeR1.map((model) => model.id),
    listed,
  };
}

async function probe(endpoint) {
  const apiKey = process.env[endpoint.apiKeyEnv];
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const base = {
    id: endpoint.id,
    provider: endpoint.provider,
    modelId: endpoint.modelId,
    credentialEnv: endpoint.apiKeyEnv,
    pricingBasis: endpoint.pricing.basis,
  };

  if (!apiKey) {
    return { ...base, status: 'blocked', blocker: 'missing_credential', errorCode: null };
  }
  if (endpoint.provider === 'cloudflare' && !accountId) {
    return { ...base, status: 'blocked', blocker: 'missing_account', errorCode: null };
  }

  const url =
    endpoint.provider === 'cloudflare'
      ? `${endpoint.baseURL.replace(/\$\{CLOUDFLARE_ACCOUNT_ID\}/g, accountId)}/${endpoint.modelId}`
      : `${endpoint.baseURL.replace(/\/$/, '')}/chat/completions`;
  const body =
    endpoint.provider === 'cloudflare'
      ? {
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
          max_tokens: PROBE_MAX_TOKENS,
        }
      : {
          model: endpoint.modelId,
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
          max_tokens: PROBE_MAX_TOKENS,
          stream: false,
        };

  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ...base,
        status: 'failed',
        blocker: null,
        errorCode: errorCodeFor(response.status),
        httpStatus: response.status,
        latencyMs,
      };
    }
    const payload = await response.json();
    if (!readGeneratedText(payload, endpoint.provider)) {
      return {
        ...base,
        status: 'failed',
        blocker: null,
        errorCode: 'invalid_response',
        httpStatus: response.status,
        latencyMs,
      };
    }
    const modelEcho = typeof payload.model === 'string' ? payload.model : null;
    if (endpoint.kind === 'primary' && modelEcho && !isFullDeepSeekR1(modelEcho)) {
      return {
        ...base,
        status: 'failed',
        blocker: null,
        errorCode: 'model_identity_mismatch',
        httpStatus: response.status,
        latencyMs,
        modelEcho,
      };
    }
    return {
      ...base,
      status: 'verified',
      blocker: null,
      errorCode: null,
      httpStatus: response.status,
      latencyMs,
      modelEcho,
    };
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      blocker: null,
      errorCode: error?.name === 'TimeoutError' ? 'timeout' : 'network_error',
      latencyMs: Date.now() - startedAt,
    };
  }
}

const publicCatalog = await checkPublicCatalog();
for (const endpoint of FREE_ENDPOINTS) {
  results.push(await probe(endpoint));
}

const summary = {
  verified: results.filter((entry) => entry.status === 'verified').length,
  blocked: results.filter((entry) => entry.status === 'blocked').length,
  failed: results.filter((entry) => entry.status === 'failed').length,
};

const report = {
  checkedAt,
  primary: {
    label: DEEPSEEK_R1_PRIMARY.label,
    available: false,
    reason: DEEPSEEK_R1_PRIMARY.reason,
    checkedAt: DEEPSEEK_R1_PRIMARY.checkedAt,
    evidence: DEEPSEEK_R1_PRIMARY.evidence,
  },
  publicCatalog,
  endpoints: results,
  summary,
  paidRoutesEnabled: false,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ outPath, summary, primaryAvailable: false }, null, 2));

const catalogDrift = publicCatalog.ok !== true;
const credentialedFailure = summary.failed > 0;
const nothingVerified = requireInference && summary.verified === 0;

if (catalogDrift || credentialedFailure || nothingVerified) {
  if (catalogDrift) {
    console.error('Public free catalog no longer matches the allowlist. Review the catalog.');
  }
  if (credentialedFailure) {
    console.error('A credentialed endpoint failed its live inference probe.');
  }
  if (nothingVerified) {
    console.error('No endpoint produced a verified authenticated inference response.');
  }
  process.exit(1);
}
