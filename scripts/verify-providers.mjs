#!/usr/bin/env node
/**
 * Verify the provider registry against the runtime catalog and recorded evidence.
 *
 * The default run is offline and consumes no provider quota. It fails closed:
 * a provider may be routing-eligible only when it is a verified $0 model with
 * verified streaming and tool calling. Live inference is delegated to the
 * existing free-inference probe, never reimplemented here, and requires both
 * --live and --allow-live plus CI=true so a laptop run cannot spend a personal
 * credential.
 *
 * Usage:
 *   npm run build:data-provider
 *   node scripts/verify-providers.mjs [--json]
 *   node scripts/verify-providers.mjs --live --allow-live
 *
 * Exit codes: 0 = registry valid, 1 = violation, 2 = catalog unavailable or
 * live probing refused.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const live = args.includes('--live');
const allowLive = args.includes('--allow-live');
const errors = [];
const warnings = [];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (error) {
    console.error(`Could not read ${file}: ${error.message}`);
    process.exit(2);
  }
}

let catalog;
try {
  catalog = await import(new URL('../packages/data-provider/dist/index.mjs', import.meta.url));
} catch {
  console.error('Could not import packages/data-provider/dist. Run: npm run build:data-provider');
  process.exit(2);
}

const lock = readJson('providers.lock.json');
const envLock = readJson('env.lock.json');
const providers = Array.isArray(lock.providers) ? lock.providers : [];
const byId = new Map(providers.map((provider) => [provider.id, provider]));
const envByName = new Map((envLock.variables ?? []).map((variable) => [variable.name, variable]));
const ELIGIBLE_STATUS = 'verified-free-model';

if (lock.policy?.paidRoutesEnabled !== false) {
  errors.push('providers.lock.json must keep paidRoutesEnabled false');
}
if (lock.policy?.additionalSpendUsd !== 0) {
  errors.push('providers.lock.json must keep additionalSpendUsd at 0');
}

for (const provider of providers) {
  if (!/^[a-z0-9-]+$/.test(provider.id ?? '')) {
    errors.push(`Invalid provider id "${provider.id}"`);
  }
  if (!/^https:\/\//.test(provider.baseURL ?? '')) {
    errors.push(`Provider "${provider.id}" must use an https base URL`);
  }
  const credential = envByName.get(provider.auth?.credentialEnv);
  if (!credential) {
    errors.push(`Provider "${provider.id}" credential is absent from env.lock.json`);
  } else if (credential.scope !== 'server') {
    errors.push(`Provider "${provider.id}" credential must be server-scoped`);
  }

  for (const model of provider.models ?? []) {
    if (model.verified === true && (!model.sourceUrl || !model.pricingBasis)) {
      errors.push(
        `Verified model "${model.id}" for "${provider.id}" lacks sourceUrl or pricingBasis`,
      );
    }
  }

  if (provider.routing?.eligible !== true) {
    continue;
  }
  if (provider.zeroCost?.status !== ELIGIBLE_STATUS) {
    errors.push(
      `Provider "${provider.id}" is routable but its zero-cost state is ${provider.zeroCost?.status}`,
    );
  }
  if (!provider.zeroCost?.verifiedAt || !/^https:\/\//.test(provider.zeroCost?.evidenceUrl ?? '')) {
    errors.push(`Provider "${provider.id}" is routable without dated pricing evidence`);
  }
  const verifiedModels = (provider.models ?? []).filter((model) => model.verified === true);
  if (verifiedModels.length === 0) {
    errors.push(`Provider "${provider.id}" is routable without a verified model`);
  }
  if (provider.capabilities?.verified !== true) {
    errors.push(`Provider "${provider.id}" is routable without verified capabilities`);
  }
  if (provider.capabilities?.streaming !== true || provider.capabilities?.tools !== true) {
    errors.push(
      `Provider "${provider.id}" is routable without verified streaming and tool calling`,
    );
  }
  if (provider.compatibility?.chat !== true || provider.compatibility?.work !== true) {
    errors.push(
      `Provider "${provider.id}" is routable without verified Chat and Work compatibility`,
    );
  }
}

// The Work free router is the only executable zero-cost surface in the runtime.
const allowlist = new Set(catalog.FREE_PROVIDER_ALLOWLIST ?? []);
for (const endpoint of catalog.FREE_ENDPOINTS ?? []) {
  const provider = byId.get(endpoint.provider);
  if (!provider) {
    errors.push(
      `FREE_ENDPOINTS provider "${endpoint.provider}" is absent from providers.lock.json`,
    );
    continue;
  }
  const model = (provider.models ?? []).find((entry) => entry.id === endpoint.modelId);
  if (allowlist.has(endpoint.provider) && (!model || model.verified !== true)) {
    errors.push(
      `FREE_ENDPOINTS model "${endpoint.modelId}" is absent or unverified in providers.lock.json`,
    );
  }
  if (
    (endpoint.promptCostPerMillion ?? 0) !== 0 ||
    (endpoint.completionCostPerMillion ?? 0) !== 0
  ) {
    errors.push(`FREE_ENDPOINTS endpoint "${endpoint.id}" declares a non-zero price`);
  }
  if (allowlist.has(endpoint.provider) && !catalog.assertZeroCostEndpoint(endpoint).ok) {
    errors.push(`FREE_ENDPOINTS endpoint "${endpoint.id}" fails the runtime zero-cost assertion`);
  }
}

const lockEligible = providers
  .filter((provider) => provider.kind === 'inference' && provider.routing?.eligible === true)
  .map((provider) => provider.id);
for (const id of lockEligible) {
  if (!allowlist.has(id)) {
    errors.push(`Provider "${id}" is routable in the lock but absent from the runtime allowlist`);
  }
}
for (const id of allowlist) {
  if (!lockEligible.includes(id)) {
    errors.push(`Runtime allowlist provider "${id}" is not routable in the lock`);
  }
}

// Every provider-fallback entry must match the lock, and only a verified $0
// provider may pass the runtime eligibility gate.
const fallbackIdMap = { opencode: 'opencodeai' };
for (const provider of catalog.PROVIDER_FALLBACK_PROVIDERS ?? []) {
  const locked = byId.get(fallbackIdMap[provider.id] ?? provider.id);
  if (!locked) {
    errors.push(`Runtime fallback provider "${provider.id}" is absent from providers.lock.json`);
    continue;
  }
  if (locked.baseURL !== provider.baseURL) {
    errors.push(`Fallback "${provider.id}" base URL differs from the lock`);
  }
  if (locked.auth?.credentialEnv !== provider.apiKeyEnv) {
    errors.push(`Fallback "${provider.id}" credential env differs from the lock`);
  }
  if (!(locked.models ?? []).some((model) => model.id === provider.defaultModel)) {
    errors.push(`Fallback "${provider.id}" default model is absent from the lock`);
  }
  const runtimeEligible = catalog.isProviderFallbackZeroCostEligible(provider) === true;
  const lockEligible = locked.zeroCost?.status === ELIGIBLE_STATUS;
  if (runtimeEligible !== lockEligible) {
    errors.push(`Fallback "${provider.id}" runtime eligibility disagrees with the lock`);
  }
  if (!runtimeEligible && locked.routing?.eligible === true) {
    errors.push(`Fallback "${provider.id}" cannot be routable while runtime-ineligible`);
  }
}

// A deployment that enables fallback must not opt out of the zero-cost gate.
for (const file of ['coderax.docker.yaml', 'coderax.example.yaml']) {
  let config;
  try {
    config = yaml.load(readFileSync(join(root, file), 'utf8')) ?? {};
  } catch (error) {
    warnings.push(`Could not parse ${file}: ${error.message}`);
    continue;
  }
  const fallback = config.providerFallback;
  if (fallback?.enabled === true && fallback?.zeroCostOnly === false) {
    errors.push(`${file} enables provider fallback with zeroCostOnly disabled`);
  }
}

// Recorded live evidence must still agree with the registry.
try {
  const evidence = readJson('docs/free-inference-verification.json');
  for (const endpoint of evidence.endpoints ?? []) {
    // An authenticated probe proves inference, not a $0 price. Only free-model
    // evidence raises a lock entry to verified; a free-tier probe stays
    // unverified for routing until the account plan itself is proven.
    if (endpoint.status !== 'verified' || endpoint.pricingBasis !== 'free-model') {
      continue;
    }
    const provider = byId.get(endpoint.provider);
    const model = provider?.models?.find((entry) => entry.id === endpoint.modelId);
    if (!model || model.verified !== true) {
      errors.push(
        `Verified free-model evidence for "${endpoint.modelId}" has no verified lock entry`,
      );
    }
  }
} catch {
  warnings.push(
    'docs/free-inference-verification.json is unavailable; live evidence was not cross-checked',
  );
}

let liveStatus = 'skipped';
if (live) {
  if (!allowLive) {
    console.error('Refusing --live without --allow-live. Live probes consume provider quota.');
    process.exit(2);
  }
  if (process.env.CI !== 'true') {
    console.error(
      'Refusing --live outside CI. Personal-machine credentials must not be spent here.',
    );
    process.exit(2);
  }
  // The delegated probe reports every catalog endpoint, including free-tier
  // entries whose account plan is unverified. Strip those credentials so the
  // probe cannot spend them; only the allowlisted $0 route is exercised.
  const probeEnv = { ...process.env };
  for (const endpoint of catalog.FREE_ENDPOINTS ?? []) {
    if (catalog.FREE_PROVIDER_ALLOWLIST?.includes(endpoint.provider)) {
      continue;
    }
    delete probeEnv[endpoint.apiKeyEnv];
    for (const name of endpoint.requiredEnv ?? []) {
      delete probeEnv[name];
    }
  }
  const probe = spawnSync(
    process.execPath,
    ['scripts/verify-free-inference.mjs', '--require-inference'],
    {
      cwd: root,
      stdio: 'inherit',
      env: probeEnv,
    },
  );
  liveStatus = probe.status === 0 ? 'passed' : 'failed';
  if (probe.status !== 0) {
    errors.push('The delegated free-inference probe failed');
  }
}

const summary = {
  checkedAt: new Date().toISOString(),
  providers: providers.length,
  routingEligible: providers
    .filter((provider) => provider.routing?.eligible === true)
    .map((provider) => provider.id),
  runtimeFallbackEligible: (catalog.PROVIDER_FALLBACK_PROVIDERS ?? [])
    .filter((provider) => catalog.isProviderFallbackZeroCostEligible(provider) === true)
    .map((provider) => provider.id),
  live: liveStatus,
  errors,
  warnings,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('Provider registry audit');
  console.log(`  routing eligible: ${summary.routingEligible.join(', ') || 'none'}`);
  console.log(
    `  runtime fallback eligible: ${summary.runtimeFallbackEligible.join(', ') || 'none'}`,
  );
  console.log(`  live probe: ${summary.live}`);
  for (const warning of warnings) {
    console.warn(`warning: ${warning}`);
  }
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
}

process.exit(errors.length > 0 ? 1 : 0);
