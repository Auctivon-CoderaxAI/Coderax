import {
  createFreeRouterFromConfig,
  getFreeRouterForConfig,
  resolveFreeRoutingLimits,
} from './service';

describe('routing from deployment config', () => {
  it('stays disabled when the deployment did not opt in', () => {
    expect(resolveFreeRoutingLimits(undefined)).toMatchObject({ enabled: false });
    expect(resolveFreeRoutingLimits({})).toMatchObject({
      enabled: false,
      allowFallback: true,
      allowToolsInFallback: false,
      maxRetries: 2,
    });
    expect(createFreeRouterFromConfig(undefined).plan()).toMatchObject({
      ok: false,
      reason: 'disabled',
    });
  });

  it('carries configured budgets and fails closed when only fallbacks exist', () => {
    const router = createFreeRouterFromConfig({
      freeInference: {
        enabled: true,
        allowFallback: false,
        maxRequestsPerDay: 7,
        maxTokensPerDay: 9_000,
        maxRetries: 1,
        cooldownMs: 5_000,
        failureThreshold: 1,
      },
    });
    /** No verified free endpoint serves the preferred model, so disabling
     *  fallbacks must leave nothing to route to rather than jump to a paid one. */
    expect(router.plan()).toMatchObject({ ok: false, reason: 'free_capacity_exhausted' });
    expect(router.snapshot()).toMatchObject({
      enabled: true,
      activeModel: null,
      paidRoutesEnabled: false,
      endpoints: expect.arrayContaining([
        expect.objectContaining({ quota: expect.objectContaining({ requestsLimit: 7 }) }),
      ]),
    });
  });

  it('reuses the router for the same budget so cooldowns and quota survive requests', async () => {
    const config = {
      freeInference: { enabled: true, maxRequestsPerDay: 3, maxTokensPerDay: 1_000 },
    };
    const first = getFreeRouterForConfig(config, {
      credentialEnvNames: ['OPENROUTER_API_KEY'],
    });
    const plan = first.plan();
    await first.run(plan, async () => ({ ok: true, value: 'ok', tokens: 5 }));
    const requestsUsed = first.snapshot().endpoints[0]?.quota.requestsUsed;
    expect(requestsUsed).toBe(1);

    const second = getFreeRouterForConfig(config, {
      credentialEnvNames: ['OPENROUTER_API_KEY'],
    });
    expect(second).toBe(first);
    expect(second.snapshot().endpoints[0]?.quota.requestsUsed).toBe(requestsUsed);
  });

  it('keeps separate budgets in separate ledgers', () => {
    const small = getFreeRouterForConfig({
      freeInference: { enabled: true, maxRequestsPerDay: 11, maxTokensPerDay: 1_000 },
    });
    const large = getFreeRouterForConfig({
      freeInference: { enabled: true, maxRequestsPerDay: 12, maxTokensPerDay: 1_000 },
    });
    expect(small).not.toBe(large);
    expect(small.snapshot().endpoints[0]?.quota.requestsLimit).toBe(11);
    expect(large.snapshot().endpoints[0]?.quota.requestsLimit).toBe(12);
  });

  it('does not reuse a router whose server credential presence differs', () => {
    const config = { freeInference: { enabled: true } };
    const withoutKey = getFreeRouterForConfig(config);
    const withKey = getFreeRouterForConfig(config, {
      credentialEnvNames: ['OPENROUTER_API_KEY'],
    });

    expect(withKey).not.toBe(withoutKey);
    expect(withoutKey.snapshot().endpoints[0]).toMatchObject({
      credentialPresent: false,
      available: false,
      rejectionReason: 'missing_credential',
    });
    expect(withKey.snapshot().endpoints[0]).toMatchObject({
      credentialPresent: true,
      freeEligible: true,
      healthy: true,
      available: true,
      rejectionReason: null,
    });
  });
});
