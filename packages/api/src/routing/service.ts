import type { FreeRouter, FreeRoutingSnapshot } from './router';
import type { FreeInferenceConfigLike } from './limits';
import type { EndpointHealth } from './health';
import type { QuotaLedger } from './quota';
import { createFreeRouter, createDisabledRoutingSnapshot } from './router';
import { getSharedQuotaLedger, resolveFreeRoutingLimits } from './limits';

export { resolveFreeRoutingLimits };
export type { FreeInferenceConfigLike };

export type FreeRouterDeps = {
  endpoints?: Parameters<typeof createFreeRouter>[0]['endpoints'];
  credentialEnvNames?: readonly string[];
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
 *
 * The quota ledger is the deployment-wide shared one, which the free-inference
 * transport also debits. A snapshot therefore reports the requests and tokens
 * real turns spent, not an untouched parallel ledger.
 */
const routers = new Map<string, FreeRouter>();

export function getFreeRouterForConfig(
  config: FreeInferenceConfigLike,
  deps: FreeRouterDeps = {},
): FreeRouter {
  const limits = resolveFreeRoutingLimits(config);
  const credentialEnvNames = [...(deps.credentialEnvNames ?? [])].sort();
  const key = JSON.stringify({ limits, credentialEnvNames });
  const existing = routers.get(key);
  if (existing) {
    return existing;
  }
  const created = createFreeRouter({
    limits,
    ...deps,
    quota: deps.quota ?? getSharedQuotaLedger(limits, deps.now),
  });
  routers.set(key, created);
  return created;
}

/** The snapshot a deployment without hosted routing reports. */
export function disabledRoutingSnapshot(): FreeRoutingSnapshot {
  return createDisabledRoutingSnapshot();
}
