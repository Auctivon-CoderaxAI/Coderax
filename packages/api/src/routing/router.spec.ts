import type { FreeEndpoint } from 'coderax-data-provider';
import { createEndpointHealth } from './health';
import { createQuotaLedger } from './quota';
import type { FreeRoutingLimits } from './router';
import { createFreeRouter } from './router';
import { isSafeModelSwitchPoint } from './checkpoint';

const primary: FreeEndpoint = {
  id: 'primary',
  provider: 'openrouter',
  modelId: 'deepseek/deepseek-r1-0528',
  label: 'DeepSeek-R1 671B',
  kind: 'primary',
  baseURL: 'https://openrouter.ai/api/v1',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  pricing: {
    basis: 'free-model',
    verifiedAt: '2026-11-08',
    evidenceUrl: 'https://openrouter.ai/api/v1/models',
    note: 'Test fixture priced at 0.',
  },
  capabilities: { streaming: true, tools: true, reasoning: true },
  contextTokens: 163_840,
  routingPriority: 1,
};

const fallbackA: FreeEndpoint = {
  ...primary,
  id: 'fallback-a',
  kind: 'fallback',
  modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  label: 'Nemotron Ultra (free)',
  routingPriority: 10,
};

const fallbackB: FreeEndpoint = {
  ...primary,
  id: 'fallback-b',
  kind: 'fallback',
  modelId: 'google/gemma-4-31b-it:free',
  label: 'Gemma 4 31B (free)',
  routingPriority: 20,
};

const limits: FreeRoutingLimits = {
  enabled: true,
  allowFallback: true,
  allowToolsInFallback: true,
  maxRequestsPerDay: 100,
  maxTokensPerDay: 100_000,
  maxRetries: 2,
  failureThreshold: 2,
  cooldownMs: 60_000,
};

function routerWith(
  overrides: Partial<FreeRoutingLimits> = {},
  endpoints = [primary, fallbackA, fallbackB],
) {
  let clock = 1_000_000;
  const now = () => clock;
  const router = createFreeRouter({
    endpoints,
    limits: { ...limits, ...overrides },
    now,
  });
  return {
    router,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('free route planning', () => {
  it('prefers the healthy primary and names it as the active model', () => {
    const { router } = routerWith();
    const plan = router.plan();
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.selected.id).toBe('primary');
    expect(plan.primary.available).toBe(true);
    expect(router.snapshot().activeModel).toMatchObject({
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-r1-0528',
    });
    expect(router.snapshot().paidRoutesEnabled).toBe(false);
  });

  it('never routes at all while disabled, and says so', () => {
    const { router } = routerWith({ enabled: false });
    expect(router.plan()).toMatchObject({ ok: false, reason: 'disabled' });
    expect(router.snapshot()).toMatchObject({ enabled: false, activeModel: null });
  });

  it('honours allowFallback: false instead of silently using another provider', () => {
    const { router } = routerWith({ allowFallback: false });
    const plan = router.plan();
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.alternatives).toEqual([]);
    }
    expect(router.plan({ requireTools: true }).ok).toBe(true);
  });

  it('excludes an endpoint that cannot call tools when tool support is required', () => {
    const textOnly: FreeEndpoint = {
      ...fallbackB,
      id: 'text-only',
      capabilities: { streaming: true, tools: false, reasoning: false },
    };
    const { router } = routerWith({ allowToolsInFallback: false }, [textOnly]);
    expect(router.plan({ requireTools: true })).toMatchObject({
      ok: false,
      reason: 'free_capacity_exhausted',
    });
  });
});

describe('bounded failover', () => {
  it('switches to the next free endpoint after a retryable provider failure', async () => {
    const { router } = routerWith();
    const plan = router.plan();
    const seen: string[] = [];
    const result = await router.run(plan, async (endpoint) => {
      seen.push(endpoint.id);
      if (endpoint.id === 'primary') {
        return { ok: false, code: 'provider_error', retryable: true };
      }
      return { ok: true, value: 'answer', tokens: 12 };
    });

    expect(seen).toEqual(['primary', 'fallback-a']);
    expect(result).toMatchObject({ ok: true, endpoint: { id: 'fallback-a' }, attempts: 2 });
    expect(router.snapshot().endpoints.find((e) => e.id === 'fallback-a')?.quota.tokensUsed).toBe(
      12,
    );
  });

  it('stops after a non-retryable failure instead of burning free quota', async () => {
    const { router } = routerWith();
    const seen: string[] = [];
    const result = await router.run(router.plan(), async (endpoint) => {
      seen.push(endpoint.id);
      return { ok: false, code: 'unauthorized', retryable: false };
    });
    expect(seen).toEqual(['primary']);
    expect(result).toMatchObject({ ok: false, reason: 'attempt_failed', attempts: 1 });
  });

  it('bounds attempts to maxRetries + 1', async () => {
    const { router } = routerWith({ maxRetries: 1 });
    const seen: string[] = [];
    const result = await router.run(router.plan(), async (endpoint) => {
      seen.push(endpoint.id);
      return { ok: false, code: 'provider_error', retryable: true };
    });
    expect(seen).toEqual(['primary', 'fallback-a']);
    expect(result).toMatchObject({ ok: false, reason: 'all_attempts_failed', attempts: 2 });
  });

  it('refuses to switch models past an unsafe checkpoint', async () => {
    const { router } = routerWith();
    const seen: string[] = [];
    const result = await router.run(
      router.plan(),
      async (endpoint) => {
        seen.push(endpoint.id);
        return { ok: false, code: 'provider_error', retryable: true };
      },
      { checkpoint: 'tool_running' },
    );
    expect(seen).toEqual(['primary']);
    expect(result).toMatchObject({ ok: false, reason: 'unsafe_checkpoint', attempts: 1 });
  });

  it('allows a switch between completed tool calls', async () => {
    const { router } = routerWith();
    const result = await router.run(
      router.plan(),
      async (endpoint) =>
        endpoint.id === 'primary'
          ? { ok: false, code: 'provider_error', retryable: true }
          : { ok: true, value: 'done' },
      { checkpoint: 'between_tool_calls' },
    );
    expect(result).toMatchObject({ ok: true, endpoint: { id: 'fallback-a' } });
  });

  it('surfaces a thrown attempt as a bounded retry, never as success', async () => {
    const { router } = routerWith({ maxRetries: 0 });
    const result = await router.run(router.plan(), async () => {
      throw new Error('socket hang up');
    });
    expect(result).toMatchObject({ ok: false, reason: 'all_attempts_failed', attempts: 1 });
  });
});

describe('cooldowns and budgets', () => {
  it('cools a repeatedly failing endpoint down and routes around it', async () => {
    const clock = { value: 1_000_000 };
    const now = () => clock.value;
    const health = createEndpointHealth({ cooldownMs: 30_000, failureThreshold: 1, now });
    const router = createFreeRouter({
      endpoints: [primary, fallbackA],
      limits,
      now,
      health,
    });

    await router.run(router.plan(), async (endpoint) =>
      endpoint.id === 'primary'
        ? { ok: false, code: 'rate_limited', retryable: true }
        : { ok: true, value: 'served by the fallback' },
    );
    expect(health.isAvailable('primary')).toBe(false);
    expect(health.isAvailable('fallback-a')).toBe(true);

    const plan = router.plan();
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.selected.id).toBe('fallback-a');
      expect(plan.rejected.some((entry) => entry.reason === 'cooldown')).toBe(true);
    }

    clock.value += 31_000;
    expect(health.isAvailable('primary')).toBe(true);
    const recovered = router.plan();
    if (recovered.ok) {
      expect(recovered.selected.id).toBe('primary');
    }
  });

  it('fails closed when the daily request budget is spent', async () => {
    const { router } = routerWith({ maxRequestsPerDay: 1 }, [primary]);
    const first = await router.run(router.plan(), async () => ({ ok: true, value: 'first' }));
    expect(first.ok).toBe(true);

    const exhausted = router.plan();
    expect(exhausted).toMatchObject({ ok: false, reason: 'free_capacity_exhausted' });
    if (!exhausted.ok) {
      expect(exhausted.rejected).toEqual([{ id: 'primary', reason: 'quota' }]);
    }
    expect(router.snapshot().activeModel).toBeNull();
  });

  it('refuses a reservation that would exceed the token budget', () => {
    let clock = 1_000_000;
    const ledger = createQuotaLedger({
      limits: { requestsPerDay: 10, tokensPerDay: 100 },
      now: () => clock,
    });
    ledger.settle('endpoint', 90);
    expect(ledger.reserve('endpoint', { tokens: 20 })).toMatchObject({
      ok: false,
      reason: 'token_budget',
    });
    expect(ledger.reserve('endpoint', { tokens: 10 })).toEqual({ ok: true });

    clock += 86_400_000;
    expect(ledger.snapshot('endpoint').tokensUsed).toBe(0);
  });

  it('reserves estimated tokens before an attempt and reconciles actual usage', async () => {
    const { router } = routerWith({ maxTokensPerDay: 100, maxRetries: 0 }, [primary]);
    const firstPlan = router.plan({ estimatedTokens: 80 });
    const stalePlan = router.plan({ estimatedTokens: 30 });
    expect(firstPlan.ok).toBe(true);
    expect(stalePlan.ok).toBe(true);

    let finish!: (value: { ok: true; value: string; tokens: number }) => void;
    const first = router.run(
      firstPlan,
      () => new Promise((resolve) => { finish = resolve; }),
    );
    expect(router.snapshot().endpoints[0]?.quota.tokensUsed).toBe(80);

    const unexpectedAttempt = jest.fn();
    const stale = await router.run(stalePlan, unexpectedAttempt);
    expect(stale).toMatchObject({
      ok: false,
      reason: 'all_attempts_failed',
      attempts: 0,
      errors: ['primary:token_budget'],
    });
    expect(unexpectedAttempt).not.toHaveBeenCalled();

    finish({ ok: true, value: 'answer', tokens: 25 });
    expect(await first).toMatchObject({ ok: true, attempts: 1 });
    expect(router.snapshot().endpoints[0]?.quota.tokensUsed).toBe(25);
    expect(router.plan({ estimatedTokens: 75 }).ok).toBe(true);
    expect(router.plan({ estimatedTokens: 76 }).ok).toBe(false);
  });

  it('retains the reservation when usage is unknown and blocks further calls after overrun', async () => {
    const { router } = routerWith({ maxTokensPerDay: 100, maxRetries: 0 }, [primary]);
    await router.run(router.plan({ estimatedTokens: 70 }), async () => ({
      ok: true, value: 'unmetered',
    }));
    expect(router.snapshot().endpoints[0]?.quota.tokensUsed).toBe(70);

    await router.run(router.plan({ estimatedTokens: 30 }), async () => ({
      ok: true, value: 'overrun', tokens: 50,
    }));
    expect(router.snapshot().endpoints[0]?.quota.tokensUsed).toBe(120);
    expect(router.plan()).toMatchObject({
      ok: false, reason: 'free_capacity_exhausted',
    });
  });

  it('rejects malformed token estimates rather than bypassing quota', () => {
    const { router } = routerWith();
    expect(router.plan({ estimatedTokens: -1 }).ok).toBe(false);
    expect(router.plan({ estimatedTokens: Number.NaN }).ok).toBe(false);
    expect(router.plan({ estimatedTokens: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it('rejects a plan when every endpoint is in cooldown', () => {
    const health = createEndpointHealth({ cooldownMs: 60_000, failureThreshold: 1 });
    const router = createFreeRouter({ endpoints: [primary], limits, health });
    health.recordFailure('primary', 'provider_error');
    expect(router.plan()).toMatchObject({ ok: false, reason: 'free_capacity_exhausted' });
  });
});

describe('model switch checkpoints', () => {
  it('permits a switch only before a turn or between tool calls', () => {
    expect(isSafeModelSwitchPoint('turn_start')).toBe(true);
    expect(isSafeModelSwitchPoint('between_tool_calls')).toBe(true);
    expect(isSafeModelSwitchPoint('streaming')).toBe(false);
    expect(isSafeModelSwitchPoint('tool_running')).toBe(false);
    expect(isSafeModelSwitchPoint('awaiting_approval')).toBe(false);
  });
});
