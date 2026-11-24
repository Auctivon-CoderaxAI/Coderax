import {
  assertZeroCostEndpoint,
  describePrimaryStatus,
  FREE_ENDPOINTS,
  FREE_PROVIDER_ALLOWLIST,
  selectFreeEndpoints,
} from 'coderax-data-provider';
import type { FreeEndpoint, FreeEndpointRejection, FreePrimaryStatus } from 'coderax-data-provider';
import type { WorkCheckpoint } from './checkpoint';
import type { EndpointHealth } from './health';
import type { QuotaLedger } from './quota';
import { isSafeModelSwitchPoint } from './checkpoint';
import { createEndpointHealth } from './health';
import { createQuotaLedger } from './quota';

/**
 * Routes one turn across verified free endpoints.
 *
 * The router owns ordering, cooldowns, budgets and bounded failover. It does
 * not speak HTTP: the caller supplies the attempt callback, so the transport
 * stays where it already lives and this module stays testable without network.
 */

/**
 * A tool-required turn never runs on a text-only endpoint, and no limit here
 * relaxes that: dropping a Work turn's tools is a correctness failure, not a
 * cost trade-off an operator can opt into.
 */
export type FreeRoutingLimits = {
  enabled: boolean;
  allowFallback: boolean;
  maxRequestsPerDay: number;
  maxTokensPerDay: number;
  maxRetries: number;
  failureThreshold: number;
  cooldownMs: number;
};

export type FreeRouteRequirements = {
  /** A Work turn needs tool calling; text-only endpoints must never execute it. */
  requireTools?: boolean;
  /** Conservative prompt estimate reserved against the daily token budget. */
  estimatedTokens?: number;
};

export type FreeRouteRejection = {
  id: string;
  reason:
    | FreeEndpointRejection
    | 'cooldown'
    | 'quota'
    | 'rate_limit'
    | 'fallback_disabled'
    | 'disabled'
    | 'missing_credential'
    | 'tools_unavailable';
};

export type FreeRoutePlan =
  | {
      ok: true;
      selected: FreeEndpoint;
      alternatives: FreeEndpoint[];
      estimatedTokens: number;
      requireTools: boolean;
      primary: FreePrimaryStatus;
      rejected: FreeRouteRejection[];
    }
  | {
      ok: false;
      reason: 'disabled' | 'free_capacity_exhausted';
      primary: FreePrimaryStatus;
      rejected: FreeRouteRejection[];
    };

export type FreeAttemptOutcome<T> =
  | { ok: true; value: T; tokens?: number }
  | { ok: false; code: string; retryable: boolean; tokens?: number };

export type FreeRunResult<T> =
  | { ok: true; endpoint: FreeEndpoint; value: T; attempts: number }
  | {
      ok: false;
      reason: 'not_routed' | 'unsafe_checkpoint' | 'attempt_failed' | 'all_attempts_failed';
      attempts: number;
      errors: string[];
    };

export type FreeEndpointStatus = {
  id: string;
  provider: string;
  modelId: string;
  label: string;
  kind: 'primary' | 'fallback';
  /** Pricing and provider policy are verified and allowlisted for $0 use. */
  freeEligible: boolean;
  /** Credential presence only; no credential value is ever returned. */
  credentialPresent: boolean;
  healthy: boolean;
  available: boolean;
  rejectionReason: FreeRouteRejection['reason'] | null;
  cooldownUntil: number | null;
  tools: boolean;
  quota: {
    requestsUsed: number;
    requestsLimit: number;
    tokensUsed: number;
    tokensLimit: number;
    resetAt: number;
    requestsPerMinuteUsed: number | null;
    requestsPerMinuteLimit: number | null;
    requestsPerMinuteResetAt: number | null;
  };
};

export type FreeRoutingSnapshot = {
  enabled: boolean;
  /** The preferred model and why it is or is not serving. */
  primary: FreePrimaryStatus;
  /** The endpoint a new turn would use right now, if any. */
  activeModel: { provider: string; modelId: string; label: string } | null;
  endpoints: FreeEndpointStatus[];
  /** There is no paid route in this router, and this field says so explicitly. */
  paidRoutesEnabled: false;
};

/**
 * The honest answer when a deployment has not opted into hosted free routing:
 * nothing is configured and nothing is active.
 */
export function createDisabledRoutingSnapshot(): FreeRoutingSnapshot {
  return {
    enabled: false,
    primary: describePrimaryStatus(FREE_ENDPOINTS),
    activeModel: null,
    endpoints: [],
    paidRoutesEnabled: false,
  };
}

export type FreeRouter = {
  plan: (requirements?: FreeRouteRequirements) => FreeRoutePlan;
  /** Execute the original plan object returned by this router. */
  run: <T>(
    plan: FreeRoutePlan,
    attempt: (endpoint: FreeEndpoint) => Promise<FreeAttemptOutcome<T>>,
    options?: { checkpoint?: WorkCheckpoint },
  ) => Promise<FreeRunResult<T>>;
  snapshot: () => FreeRoutingSnapshot;
};

export function createFreeRouter({
  endpoints = FREE_ENDPOINTS,
  credentialEnvNames = [],
  limits,
  now = Date.now,
  health,
  quota,
}: {
  endpoints?: readonly FreeEndpoint[];
  /** Present server environment variable names only. */
  credentialEnvNames?: readonly string[];
  limits: FreeRoutingLimits;
  now?: () => number;
  health?: EndpointHealth;
  quota?: QuotaLedger;
}): FreeRouter {
  const configuredCredentials = new Set(credentialEnvNames);
  const tracker =
    health ??
    createEndpointHealth({
      cooldownMs: limits.cooldownMs,
      failureThreshold: limits.failureThreshold,
      now,
    });
  const ledger =
    quota ??
    createQuotaLedger({
      limits: {
        requestsPerDay: limits.maxRequestsPerDay,
        tokensPerDay: limits.maxTokensPerDay,
      },
      now,
    });
  const minuteRequests = new Map<string, { windowStart: number; requests: number }>();
  const primary = describePrimaryStatus(endpoints);
  // Bind tool requirements to plans issued by this router, not caller-editable fields.
  const issuedToolRequirements = new WeakMap<FreeRoutePlan, boolean>();

  function quotaKey(endpoint: FreeEndpoint): string {
    return endpoint.quotaGroup ?? endpoint.id;
  }

  function quotaFor(endpoint: FreeEndpoint) {
    const quotaSnapshot = ledger.snapshot(quotaKey(endpoint));
    const minuteQuota = minuteQuotaFor(endpoint);
    return {
      ...quotaSnapshot,
      requestsLimit:
        endpoint.dailyRequestLimit == null
          ? quotaSnapshot.requestsLimit
          : Math.min(quotaSnapshot.requestsLimit, endpoint.dailyRequestLimit),
      requestsPerMinuteUsed: minuteQuota.requestsUsed,
      requestsPerMinuteLimit: minuteQuota.requestsLimit,
      requestsPerMinuteResetAt: minuteQuota.resetAt,
    };
  }

  function minuteQuotaFor(endpoint: FreeEndpoint) {
    const requestsLimit = endpoint.requestsPerMinuteLimit;
    if (requestsLimit == null) {
      return { requestsUsed: null, requestsLimit: null, resetAt: null, windowStart: null };
    }
    const windowStart = Math.floor(now() / 60_000) * 60_000;
    const existing = minuteRequests.get(quotaKey(endpoint));
    return {
      requestsUsed: existing?.windowStart === windowStart ? existing.requests : 0,
      requestsLimit,
      resetAt: windowStart + 60_000,
      windowStart,
    };
  }

  function reserveMinuteRequest(endpoint: FreeEndpoint, windowStart: number | null): void {
    if (windowStart == null) {
      return;
    }
    const key = quotaKey(endpoint);
    const existing = minuteRequests.get(key);
    const requests = existing?.windowStart === windowStart ? existing.requests : 0;
    minuteRequests.set(key, { windowStart, requests: requests + 1 });
  }

  function rejectionFor(
    endpoint: FreeEndpoint,
    requireTools: boolean,
    estimatedTokens: number,
  ): FreeRouteRejection['reason'] | null {
    if (!limits.enabled) {
      return 'disabled';
    }
    const policy = assertZeroCostEndpoint(endpoint);
    if (!policy.ok) {
      return policy.reason;
    }
    if (!FREE_PROVIDER_ALLOWLIST.includes(endpoint.provider)) {
      return 'unknown_provider';
    }
    if (endpoint.kind === 'fallback' && !limits.allowFallback) {
      return 'fallback_disabled';
    }
    if (!configuredCredentials.has(endpoint.apiKeyEnv)) {
      return 'missing_credential';
    }
    if (requireTools && !endpoint.capabilities.tools) {
      return 'tools_unavailable';
    }
    if (!tracker.isAvailable(endpoint.id)) {
      return 'cooldown';
    }
    const remaining = quotaFor(endpoint);
    if (
      remaining.requestsUsed + 1 > remaining.requestsLimit ||
      remaining.tokensUsed + estimatedTokens > remaining.tokensLimit
    ) {
      return 'quota';
    }
    if (
      remaining.requestsPerMinuteLimit != null &&
      remaining.requestsPerMinuteUsed! + 1 > remaining.requestsPerMinuteLimit
    ) {
      return 'rate_limit';
    }
    return null;
  }

  function plan(requirements: FreeRouteRequirements = {}): FreeRoutePlan {
    if (!limits.enabled) {
      return {
        ok: false,
        reason: 'disabled',
        primary,
        rejected: [],
      };
    }

    const rejected: FreeRouteRejection[] = [];
    const estimatedTokens = requirements.estimatedTokens ?? 0;
    if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0) {
      return { ok: false, reason: 'free_capacity_exhausted', primary, rejected };
    }
    const requiresTools = requirements.requireTools === true;
    const selection = selectFreeEndpoints(endpoints);
    const rejectedByPolicy = new Map(selection.rejected.map((entry) => [entry.id, entry.reason]));
    const eligible: FreeEndpoint[] = [];
    for (const endpoint of endpoints) {
      const reason =
        rejectedByPolicy.get(endpoint.id) ?? rejectionFor(endpoint, requiresTools, estimatedTokens);
      if (reason !== null && reason !== undefined) {
        rejected.push({ id: endpoint.id, reason });
        continue;
      }
      eligible.push(endpoint);
    }
    eligible.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === 'primary' ? -1 : 1;
      }
      if (a.routingPriority !== b.routingPriority) {
        return a.routingPriority - b.routingPriority;
      }
      return a.id.localeCompare(b.id);
    });

    if (eligible.length === 0) {
      return { ok: false, reason: 'free_capacity_exhausted', primary, rejected };
    }
    const [selected, ...alternatives] = eligible;
    const routePlan: FreeRoutePlan = {
      ok: true,
      selected: selected as FreeEndpoint,
      alternatives,
      estimatedTokens,
      requireTools: requiresTools,
      primary,
      rejected,
    };
    issuedToolRequirements.set(routePlan, requiresTools);
    return routePlan;
  }

  async function run<T>(
    routePlan: FreeRoutePlan,
    attempt: (endpoint: FreeEndpoint) => Promise<FreeAttemptOutcome<T>>,
    options: { checkpoint?: WorkCheckpoint } = {},
  ): Promise<FreeRunResult<T>> {
    // A previously computed plan must not bypass a disabled router. Plans are
    // public data, so reject unknown endpoints before calling any provider.
    if (!limits.enabled || !routePlan.ok) {
      return { ok: false, reason: 'not_routed', attempts: 0, errors: [] };
    }

    // Keep the capability constraint outside caller-mutable plan data.
    const trustedRequireTools = issuedToolRequirements.get(routePlan);
    if (
      trustedRequireTools === undefined ||
      routePlan.requireTools !== trustedRequireTools ||
      !Number.isSafeInteger(routePlan.estimatedTokens) ||
      routePlan.estimatedTokens < 0 ||
      typeof routePlan.requireTools !== 'boolean' ||
      !Array.isArray(routePlan.alternatives)
    ) {
      return { ok: false, reason: 'not_routed', attempts: 0, errors: [] };
    }

    const candidates = [routePlan.selected, ...routePlan.alternatives].slice(
      0,
      Math.max(1, 1 + limits.maxRetries),
    );
    // A plan is caller-supplied data, not an authorization token. Reapply
    // zero-cost catalog and fallback policy before any quota/provider action.
    // A stale or forged plan must not route to a configured paid endpoint.
    const allowed = new Set(
      selectFreeEndpoints(endpoints).usable.filter(
        (endpoint) =>
          FREE_PROVIDER_ALLOWLIST.includes(endpoint.provider) &&
          configuredCredentials.has(endpoint.apiKeyEnv) &&
          (limits.allowFallback || endpoint.kind !== 'fallback') &&
          (!trustedRequireTools || endpoint.capabilities.tools),
      ),
    );
    if (
      new Set(candidates).size !== candidates.length ||
      candidates.some((endpoint) => !allowed.has(endpoint))
    ) {
      return { ok: false, reason: 'not_routed', attempts: 0, errors: [] };
    }
    const errors: string[] = [];
    let attempts = 0;

    for (const endpoint of candidates) {
      /**
       * A second endpoint is a model switch. If the run is past a safe
       * checkpoint, stop rather than risk repeating an unrecorded action.
       */
      if (attempts > 0 && (!options.checkpoint || !isSafeModelSwitchPoint(options.checkpoint))) {
        return { ok: false, reason: 'unsafe_checkpoint', attempts, errors };
      }
      if (!tracker.isAvailable(endpoint.id)) {
        errors.push(`${endpoint.id}:cooldown`);
        continue;
      }
      // Recheck and reserve at execution time: a plan can become stale while
      // another concurrent turn consumes the remaining quota.
      const remaining = quotaFor(endpoint);
      if (
        remaining.requestsPerMinuteLimit != null &&
        remaining.requestsPerMinuteUsed! + 1 > remaining.requestsPerMinuteLimit
      ) {
        errors.push(`${endpoint.id}:rate_limit`);
        continue;
      }
      if (remaining.requestsUsed + 1 > remaining.requestsLimit) {
        errors.push(`${endpoint.id}:request_budget`);
        continue;
      }
      if (remaining.tokensUsed + routePlan.estimatedTokens > remaining.tokensLimit) {
        errors.push(`${endpoint.id}:token_budget`);
        continue;
      }
      const reservation = ledger.reserve(quotaKey(endpoint), {
        tokens: routePlan.estimatedTokens,
      });
      if (!reservation.ok) {
        errors.push(`${endpoint.id}:${reservation.reason}`);
        continue;
      }
      reserveMinuteRequest(endpoint, minuteQuotaFor(endpoint).windowStart);

      attempts += 1;
      let outcome: FreeAttemptOutcome<T>;
      try {
        outcome = await attempt(endpoint);
      } catch (error) {
        outcome = {
          ok: false,
          code: error instanceof Error ? error.name || 'attempt_threw' : 'attempt_threw',
          retryable: true,
        };
      }

      if (outcome.ok) {
        tracker.recordSuccess(endpoint.id);
        if (outcome.tokens != null) {
          ledger.settle(
            quotaKey(endpoint),
            outcome.tokens,
            routePlan.estimatedTokens,
            reservation.resetAt,
          );
        }
        return { ok: true, endpoint, value: outcome.value, attempts };
      }

      tracker.recordFailure(endpoint.id, outcome.code);
      if (outcome.tokens != null) {
        ledger.settle(
          quotaKey(endpoint),
          outcome.tokens,
          routePlan.estimatedTokens,
          reservation.resetAt,
        );
      }
      errors.push(`${endpoint.id}:${outcome.code}`);
      if (!outcome.retryable) {
        return { ok: false, reason: 'attempt_failed', attempts, errors };
      }
    }

    return { ok: false, reason: 'all_attempts_failed', attempts, errors };
  }

  function snapshot(): FreeRoutingSnapshot {
    // This endpoint describes native Work availability, so text-only endpoints
    // must not appear available even if a non-Work plan could use them.
    const current = plan({ requireTools: true });
    return {
      enabled: limits.enabled,
      primary,
      activeModel: current.ok
        ? {
            provider: current.selected.provider,
            modelId: current.selected.modelId,
            label: current.selected.label,
          }
        : null,
      endpoints: endpoints.map((endpoint) => {
        const healthSnapshot = tracker.snapshot(endpoint.id);
        const policy = assertZeroCostEndpoint(endpoint);
        const rejectionReason = rejectionFor(endpoint, true, 0);
        const endpointQuota = quotaFor(endpoint);
        return {
          id: endpoint.id,
          provider: endpoint.provider,
          modelId: endpoint.modelId,
          label: endpoint.label,
          kind: endpoint.kind,
          freeEligible: policy.ok && FREE_PROVIDER_ALLOWLIST.includes(endpoint.provider),
          credentialPresent: configuredCredentials.has(endpoint.apiKeyEnv),
          healthy: healthSnapshot.available,
          available: rejectionReason === null,
          rejectionReason,
          cooldownUntil: healthSnapshot.cooldownUntil,
          tools: endpoint.capabilities.tools,
          quota: endpointQuota,
        };
      }),
      paidRoutesEnabled: false,
    };
  }

  return { plan, run, snapshot };
}
