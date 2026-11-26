#!/usr/bin/env node
/**
 * Discover public model catalogs and compare them with providers.lock.json.
 *
 * Discovery never promotes a model: it records what the provider lists, flags a
 * verified model that disappeared, and leaves routing eligibility to the
 * verified registry. No credential is read and no inference quota is spent.
 *
 * Usage:
 *   node scripts/sync-models.mjs [--check|--write] [--json]
 *
 * Exit codes: 0 = no drift, 1 = drift or a required catalog is unavailable,
 * 2 = the lock file cannot be read.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const asJson = args.includes('--json');

const LOCK_PATH = join(root, 'providers.lock.json');
let lock;
try {
  lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
} catch (error) {
  console.error(`Could not read providers.lock.json: ${error.message}`);
  process.exit(2);
}

const SOURCES = [
  {
    providerId: 'openrouter',
    url: 'https://openrouter.ai/api/v1/models',
    optional: false,
    read: (body) => (Array.isArray(body?.data) ? body.data.map((model) => model.id) : []),
  },
  {
    providerId: 'cerebras',
    url: 'https://api.cerebras.ai/public/v1/models?format=openrouter',
    optional: false,
    read: (body) => (Array.isArray(body?.data) ? body.data.map((model) => model.id) : []),
  },
  {
    providerId: 'opencodeai',
    url: 'https://opencode.ai/zen/v1/models',
    optional: true,
    read: (body) =>
      Array.isArray(body?.data)
        ? body.data.map((model) => model.id)
        : Array.isArray(body)
          ? body
          : [],
  },
];

const byId = new Map(lock.providers.map((provider) => [provider.id, provider]));
const errors = [];
const results = [];

for (const source of SOURCES) {
  const provider = byId.get(source.providerId);
  if (!provider) {
    errors.push(`Provider "${source.providerId}" is absent from providers.lock.json`);
    continue;
  }
  const startedAt = Date.now();
  try {
    const response = await fetch(source.url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.json();
    const discovered = [
      ...new Set(source.read(body).filter((id) => typeof id === 'string')),
    ].sort();
    const verified = (provider.models ?? [])
      .filter((model) => model.verified === true)
      .map((model) => model.id);
    const known = new Set((provider.models ?? []).map((model) => model.id));
    const missingVerified = verified.filter((id) => !discovered.includes(id));
    const newIds = discovered.filter((id) => !known.has(id)).slice(0, 50);
    provider.discovery = {
      checkedAt: new Date().toISOString(),
      sourceUrl: source.url,
      status: 'ok',
      modelCount: discovered.length,
      missingVerified,
      newIds,
      latencyMs: Date.now() - startedAt,
    };
    results.push({ provider: source.providerId, ...provider.discovery });
    for (const id of missingVerified) {
      errors.push(`Verified model "${id}" is no longer listed by ${source.providerId}`);
    }
  } catch (error) {
    provider.discovery = {
      checkedAt: new Date().toISOString(),
      sourceUrl: source.url,
      status: 'unavailable',
      errorCode: error?.name === 'TimeoutError' ? 'timeout' : 'unavailable',
      modelCount: 0,
      missingVerified: [],
      newIds: [],
      latencyMs: Date.now() - startedAt,
    };
    results.push({ provider: source.providerId, ...provider.discovery });
    const message = `Could not read ${source.providerId} catalog from ${source.url}`;
    if (source.optional) {
      provider.discovery.optional = true;
    } else {
      errors.push(message);
    }
  }
}

if (write) {
  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

const summary = {
  checkedAt: new Date().toISOString(),
  mode: write ? 'write' : 'check',
  results,
  errors,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Model discovery (${summary.mode})`);
  for (const result of results) {
    console.log(
      `  ${result.status === 'ok' ? 'ok         ' : 'unavailable'}  ${result.provider}  ${result.modelCount} models`,
    );
    for (const id of result.missingVerified) {
      console.error(`  missing verified model: ${id}`);
    }
  }
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  console.log(`\n${errors.length} error(s)`);
}

process.exit(errors.length > 0 ? 1 : 0);
