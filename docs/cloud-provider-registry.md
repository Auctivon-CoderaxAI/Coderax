# Cloud provider registry

This repository keeps one machine-readable description of the AI providers it
can reach, what each one costs, which models are verified, and whether the
runtime may route to it. The goal is that a credential alone never enables
inference: a provider must also be proven to stay at $0 for Coderax's usage.

## Files

| File                           | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `providers.lock.json`          | Providers, endpoints, models, capabilities, zero-cost evidence, routing   |
| `env.lock.json`                | Variable names, scope, consumers, forbidden surfaces; never secret values |
| `scripts/verify-env.mjs`       | Environment contract and client-bundle leak check; names only             |
| `scripts/verify-providers.mjs` | Registry/evidence validation; live probing is explicit and CI-only        |
| `scripts/sync-models.mjs`      | Public model-catalog discovery and discontinued-model detection           |

`.env*` files are gitignored. The lock files contain names and public endpoint
metadata only. No script prints a credential value.

## Zero-cost status

Only `verified-free-model` passes the runtime gate. Everything else is listed
honestly and stays out of routing:

| Provider       | Status                       | Why                                                          |
| -------------- | ---------------------------- | ------------------------------------------------------------ |
| OpenRouter     | `verified-free-model`        | `:free` models, price 0 in the public catalog                |
| Gemini         | `free-tier-unverified`       | Key exposes no account plan, region or remaining quota       |
| Cerebras       | `trial-credit`               | One-time $5 credit after a payment method                    |
| Groq           | `free-tier-unverified`       | Free and billable tiers share the same key shape             |
| OpenCode Zen   | `paid`                       | Per-request billing; free models require the OpenCode client |
| APInex         | `requires-topup`             | Daily allowance starts after a $5 top-up                     |
| Cloudflare     | `free-allocation-unverified` | Free daily Neurons depend on an unexposed plan               |
| Free.ai        | `free-allowance-overage`     | 30k tokens/day free, billed beyond that pool                 |
| 100MillionSeek | `free-service-unverified`    | Advertises 100M tokens/day; no authenticated probe yet       |
| Vercel         | `deployment-only`            | Deployment token, never an inference credential              |

`100MILLIONSEEK_API_KEY` begins with a digit, so a POSIX shell cannot export
it. The provider documents `HMS_API_KEY`; the legacy name is accepted only when
a non-shell environment injects it.

## Runtime gate

`providerFallback.zeroCostOnly` defaults to `true`. Under that default, only a
`verified-free-model` provider can be added as a custom endpoint or used as a
fallback. Setting it to `false` is an explicit owner decision to allow
account-tier billing. The Work free router has its own independent zero-cost
allowlist and does not use this setting.

## Commands

```bash
npm run build:data-provider
npm run verify:env
npm run verify:providers
npm run sync:models -- --check
```

Live inference is delegated to the existing probe. It requires explicit
permission, CI, a valid registry, and a passing public pricing check:

```bash
node scripts/verify-providers.mjs --live --allow-live   # CI=true required
```

Model discovery is read-only by default. With `--write`, it publishes discovery
results only if there are no discovery errors and the lock has not changed
during collection.

## Current blockers

- No repository or production-environment secret is readable by the auditor.
  Locally present credentials are personal-machine state and were not used;
  secure cloud migration is required before live verification.
- No provider other than OpenRouter has a current authenticated verification
  record, so the fallback chain is inert under the default gate.
- Hosted CI is billing-blocked on this repository, so these commands are the
  local acceptance gate until CI is restored.
