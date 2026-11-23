import type { TWorkRoutingEndpoint, TWorkRoutingSnapshot } from 'coderax-data-provider';
import {
  workActiveEndpoint,
  workPrimaryAvailability,
  workProviderAvailability,
  workProviderRequestsRemaining,
} from '../workProviderState';

function endpoint(overrides: Partial<TWorkRoutingEndpoint> = {}): TWorkRoutingEndpoint {
  return {
    id: 'openrouter-nemotron-ultra-free',
    provider: 'openrouter',
    modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    label: 'NVIDIA Nemotron 3 Ultra (free)',
    kind: 'fallback',
    freeEligible: true,
    credentialPresent: true,
    healthy: true,
    available: true,
    rejectionReason: null,
    cooldownUntil: null,
    tools: true,
    quota: {
      requestsUsed: 10,
      requestsLimit: 200,
      tokensUsed: 1_000,
      tokensLimit: 400_000,
      resetAt: 0,
    },
    ...overrides,
  };
}

function snapshot(overrides: Partial<TWorkRoutingSnapshot> = {}): TWorkRoutingSnapshot {
  return {
    enabled: true,
    primary: {
      available: false,
      label: 'DeepSeek-R1 671B',
      modelIds: ['deepseek/deepseek-r1-0528'],
      reason: 'no_verified_free_endpoint',
      checkedAt: '2026-11-08',
      evidence: [],
    },
    activeModel: null,
    endpoints: [],
    paidRoutesEnabled: false,
    ...overrides,
  };
}

describe('workProviderAvailability', () => {
  it('reports an available endpoint with budget left', () => {
    expect(workProviderAvailability(endpoint())).toBe('available');
  });

  it('reports quota exhaustion before health', () => {
    expect(
      workProviderAvailability(
        endpoint({
          available: false,
          quota: { ...endpoint().quota, requestsUsed: 200 },
        }),
      ),
    ).toBe('quota_exhausted');
    expect(
      workProviderAvailability(endpoint({ quota: { ...endpoint().quota, tokensUsed: 400_000 } })),
    ).toBe('quota_exhausted');
  });

  it('reports a future cooldown as cooling down', () => {
    expect(workProviderAvailability(endpoint({ cooldownUntil: 2_000 }), 1_000)).toBe(
      'cooling_down',
    );
    expect(workProviderAvailability(endpoint({ cooldownUntil: 500 }), 1_000)).toBe('available');
  });

  it('does not turn an unavailable endpoint into an available one', () => {
    expect(workProviderAvailability(endpoint({ available: false }))).toBe('unavailable');
  });
});

describe('workProviderRequestsRemaining', () => {
  it('never reports a negative remainder', () => {
    expect(workProviderRequestsRemaining(endpoint())).toBe(190);
    expect(
      workProviderRequestsRemaining(
        endpoint({ quota: { ...endpoint().quota, requestsUsed: 250 } }),
      ),
    ).toBe(0);
  });
});

describe('workPrimaryAvailability', () => {
  it('treats a deployment without the opt-in as unconfigured', () => {
    expect(workPrimaryAvailability(snapshot({ enabled: false }))).toBe('unconfigured');
  });

  it('distinguishes a missing credential from an unverified free endpoint', () => {
    expect(
      workPrimaryAvailability(
        snapshot({
          primary: { ...snapshot().primary, reason: 'no_configured_credential' },
        }),
      ),
    ).toBe('unconfigured');
    expect(workPrimaryAvailability(snapshot())).toBe('unverified');
  });

  it('reports availability only when the server does', () => {
    expect(
      workPrimaryAvailability(
        snapshot({ primary: { ...snapshot().primary, available: true, reason: undefined } }),
      ),
    ).toBe('available');
  });
});

describe('workActiveEndpoint', () => {
  it('finds the endpoint row behind the active model', () => {
    const active = snapshot({
      activeModel: {
        provider: 'openrouter',
        modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        label: 'NVIDIA Nemotron 3 Ultra (free)',
      },
      endpoints: [endpoint()],
    });
    expect(workActiveEndpoint(active)?.id).toBe('openrouter-nemotron-ultra-free');
  });

  it('returns null when the server names no active model or lists no matching row', () => {
    expect(workActiveEndpoint(snapshot())).toBeNull();
    expect(
      workActiveEndpoint(
        snapshot({
          activeModel: { provider: 'groq', modelId: 'openai/gpt-oss-120b', label: 'GPT-OSS' },
          endpoints: [endpoint()],
        }),
      ),
    ).toBeNull();
  });
});
