import {
  DEFAULT_FREE_INFERENCE_COOLDOWN_MS,
  DEFAULT_FREE_INFERENCE_FAILURE_THRESHOLD,
  DEFAULT_FREE_INFERENCE_MAX_REQUESTS_PER_DAY,
  DEFAULT_FREE_INFERENCE_MAX_RETRIES,
  DEFAULT_FREE_INFERENCE_MAX_TOKENS_PER_DAY,
} from 'coderax-data-provider';
import type { TFreeInferenceConfig } from 'coderax-data-provider';
import type { FreeRoutingLimits } from './router';
import type { QuotaLedger } from './quota';
import { createQuotaLedger } from './quota';

/**
 * Deployment configuration to routing limits.
 *
 * Defaults mirror `freeInferenceConfigSchema`, and an absent block stays
 * disabled, so a deployment that never opted in makes no hosted call.
 */
export type FreeInferenceConfigLike =
  | { freeInference?: Partial<TFreeInferenceConfig> | null }
  | null
  | undefined;

export function resolveFreeRoutingLimits(config: FreeInferenceConfigLike): FreeRoutingLimits {
  const value = config?.freeInference;
  return {
    enabled: value?.enabled === true,
    allowFallback: value?.allowFallback ?? true,
    maxRequestsPerDay: value?.maxRequestsPerDay ?? DEFAULT_FREE_INFERENCE_MAX_REQUESTS_PER_DAY,
    maxTokensPerDay: value?.maxTokensPerDay ?? DEFAULT_FREE_INFERENCE_MAX_TOKENS_PER_DAY,
    maxRetries: value?.maxRetries ?? DEFAULT_FREE_INFERENCE_MAX_RETRIES,
    failureThreshold: value?.failureThreshold ?? DEFAULT_FREE_INFERENCE_FAILURE_THRESHOLD,
    cooldownMs: value?.cooldownMs ?? DEFAULT_FREE_INFERENCE_COOLDOWN_MS,
  };
}

/**
 * One quota ledger per resolved deployment budget, so every path that spends
 * free inference debits the same day's allowance and the status endpoint
 * reports what was actually used.
 *
 * An injected clock gets its own ledger: tests and multi-window simulations
 * must not mutate the process-wide budget. Production paths use the system
 * clock and therefore share the ledger.
 */
const sharedLedgers = new Map<string, QuotaLedger>();

export function getSharedQuotaLedger(limits: FreeRoutingLimits, now?: () => number): QuotaLedger {
  const quotaLimits = {
    requestsPerDay: limits.maxRequestsPerDay,
    tokensPerDay: limits.maxTokensPerDay,
  };
  if (now != null) {
    return createQuotaLedger({ limits: quotaLimits, now });
  }
  const key = `${quotaLimits.requestsPerDay}:${quotaLimits.tokensPerDay}`;
  const existing = sharedLedgers.get(key);
  if (existing) {
    return existing;
  }
  const created = createQuotaLedger({ limits: quotaLimits });
  sharedLedgers.set(key, created);
  return created;
}
