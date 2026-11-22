import type { TWorkRoutingEndpoint, TWorkRoutingSnapshot } from 'coderax-data-provider';

/** What the server's routing snapshot says about one catalogued endpoint. */
export type WorkProviderAvailability =
  | 'available'
  | 'quota_exhausted'
  | 'cooling_down'
  | 'unavailable';

/** The preferred model's state, which the routing snapshot reports separately. */
export type WorkPrimaryAvailability = 'available' | 'unconfigured' | 'unverified';

/**
 * Read one endpoint's availability. Quota is checked before health so a
 * provider that has spent today's budget is never described as available.
 */
export function workProviderAvailability(
  endpoint: TWorkRoutingEndpoint,
  now = Date.now(),
): WorkProviderAvailability {
  const { requestsUsed, requestsLimit, tokensUsed, tokensLimit } = endpoint.quota;
  if (requestsUsed >= requestsLimit || tokensUsed >= tokensLimit) {
    return 'quota_exhausted';
  }
  if (endpoint.cooldownUntil != null && endpoint.cooldownUntil > now) {
    return 'cooling_down';
  }
  return endpoint.available ? 'available' : 'unavailable';
}

/** Requests left in the server's daily free budget for this endpoint. */
export function workProviderRequestsRemaining(endpoint: TWorkRoutingEndpoint): number {
  return Math.max(0, endpoint.quota.requestsLimit - endpoint.quota.requestsUsed);
}

/**
 * The preferred model's state. A deployment that has not opted in is
 * unconfigured; an opted-in deployment with no verified endpoint is unverified.
 * Neither is ever presented as available.
 */
export function workPrimaryAvailability(routing: TWorkRoutingSnapshot): WorkPrimaryAvailability {
  if (!routing.enabled) {
    return 'unconfigured';
  }
  if (routing.primary.available) {
    return 'available';
  }
  return routing.primary.reason === 'no_configured_credential' ? 'unconfigured' : 'unverified';
}

/** The endpoint row behind the active model, when the server lists one. */
export function workActiveEndpoint(routing: TWorkRoutingSnapshot): TWorkRoutingEndpoint | null {
  const active = routing.activeModel;
  if (!active) {
    return null;
  }
  return (
    routing.endpoints.find(
      (endpoint) => endpoint.provider === active.provider && endpoint.modelId === active.modelId,
    ) ?? null
  );
}
