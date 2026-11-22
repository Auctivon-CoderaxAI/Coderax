import {
  DEFAULT_FREE_INFERENCE_COOLDOWN_MS,
  DEFAULT_FREE_INFERENCE_FAILURE_THRESHOLD,
  DEFAULT_FREE_INFERENCE_MAX_REQUESTS_PER_DAY,
  DEFAULT_FREE_INFERENCE_MAX_RETRIES,
  DEFAULT_FREE_INFERENCE_MAX_TOKENS_PER_DAY,
} from 'coderax-data-provider';
import type { TFreeInferenceConfig } from 'coderax-data-provider';
import type { FreeRoutingLimits, FreeRouter, FreeRoutingSnapshot } from './router';
import type { EndpointHealth } from './health';
import type { QuotaLedger } from './quota';
import { createFreeRouter, createDisabledRoutingSnapshot } from './router';

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
    allowToolsInFallback: value?.allowToolsInFallback ?? false,
    maxRequestsPerDay: value?.maxRequestsPerDay ?? DEFAULT_FREE_INFERENCE_MAX_REQUESTS_PER_DAY,
    maxTokensPerDay: value?.maxTokensPerDay ?? DEFAULT_FREE_INFERENCE_MAX_TOKENS_PER_DAY,
    maxRetries: value?.maxRetries ?? DEFAULT_FREE_INFERENCE_MAX_RETRIES,
    failureThreshold: value?.failureThreshold ?? DEFAULT_FREE_INFERENCE_FAILURE_THRESHOLD,
    cooldownMs: value?.cooldownMs ?? DEFAULT_FREE_INFERENCE_COOLDOWN_MS,
  };
}

export type FreeRouterDeps = {
  endpoints?: Parameters<typeof createFreeRouter>[0]['endpoints'];
  now?: () => number;
  health?: EndpointHealth;
  quota?: QuotaLedger;
};

export function createFreeRouterFromConfig(
  config: FreeInferenceConfigLike,
  deps: FreeRouterDeps = {},
): FreeRouter {
  return createFreeRouter({ limits: resolveFreeRoutingLimits(config), ...deps });
}

/**
 * One router per resolved budget, kept for the process lifetime.
 *
 * A router owns live cooldowns and a quota ledger, so rebuilding it per request
 * would reset both and let a retry storm forget what it already spent. The
 * registry is keyed by the resolved limits, so a tenant or request with a
 * different budget gets its own ledger instead of sharing one.
 */
const routers = new Map<string, FreeRouter>();

export function getFreeRouterForConfig(
  config: FreeInferenceConfigLike,
  deps: FreeRouterDeps = {},
): FreeRouter {
  const limits = resolveFreeRoutingLimits(config);
  const key = JSON.stringify(limits);
  const existing = routers.get(key);
  if (existing) {
    return existing;
  }
  const created = createFreeRouter({ limits, ...deps });
  routers.set(key, created);
  return created;
}

/** The snapshot a deployment without hosted routing reports. */
export function disabledRoutingSnapshot(): FreeRoutingSnapshot {
  return createDisabledRoutingSnapshot();
}
