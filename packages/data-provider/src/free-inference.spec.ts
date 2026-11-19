import type { FreeEndpoint } from './free-inference';
import {
  assertZeroCostEndpoint,
  DEEPSEEK_R1_PRIMARY,
  describePrimaryStatus,
  FREE_ENDPOINTS,
  isFullDeepSeekR1,
  selectFreeEndpoints,
} from './free-inference';

const freeEndpoint: FreeEndpoint = {
  id: 'test-free',
  provider: 'openrouter',
  modelId: 'vendor/model:free',
  label: 'Test free',
  kind: 'fallback',
  baseURL: 'https://openrouter.ai/api/v1',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  pricing: {
    basis: 'free-model',
    verifiedAt: '2026-11-08',
    evidenceUrl: 'https://openrouter.ai/api/v1/models',
    note: 'Listed at price 0.',
  },
  capabilities: { streaming: true, tools: true, reasoning: false },
  contextTokens: 8_192,
  routingPriority: 1,
};

describe('DeepSeek-R1 671B identity', () => {
  it('accepts only the full checkpoint identifiers', () => {
    expect(isFullDeepSeekR1('deepseek/deepseek-r1-0528')).toBe(true);
    expect(isFullDeepSeekR1('deepseek-ai/DeepSeek-R1')).toBe(true);
    expect(isFullDeepSeekR1('deepseek-reasoner')).toBe(true);
  });

  it('rejects every distilled derivative and unrelated model', () => {
    expect(isFullDeepSeekR1('deepseek-ai/DeepSeek-R1-Distill-Qwen-32B')).toBe(false);
    expect(isFullDeepSeekR1('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b')).toBe(false);
    expect(isFullDeepSeekR1('deepseek-r1-distill-llama-70b')).toBe(false);
    expect(isFullDeepSeekR1('gpt-oss-120b')).toBe(false);
    expect(isFullDeepSeekR1('')).toBe(false);
  });

  it('records the primary as unavailable for a stated, checkable reason', () => {
    expect(DEEPSEEK_R1_PRIMARY.available).toBe(false);
    expect(DEEPSEEK_R1_PRIMARY.reason).toBe('no_verified_free_endpoint');
    expect(DEEPSEEK_R1_PRIMARY.evidence.length).toBeGreaterThan(0);
    expect(DEEPSEEK_R1_PRIMARY.evidence.every((item) => item.url.startsWith('https://'))).toBe(
      true,
    );
  });

  it('never reports a distilled endpoint as the preferred model', () => {
    const distilled: FreeEndpoint = {
      ...freeEndpoint,
      id: 'distill',
      kind: 'primary',
      modelId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    };
    expect(assertZeroCostEndpoint(distilled)).toEqual({
      ok: false,
      reason: 'distilled_model_as_primary',
    });
    expect(describePrimaryStatus([distilled]).available).toBe(false);
  });
});

describe('zero-cost endpoint enforcement', () => {
  it('accepts a verified free endpoint', () => {
    expect(assertZeroCostEndpoint(freeEndpoint)).toEqual({ ok: true });
  });

  it('rejects a provider outside the allowlist', () => {
    expect(assertZeroCostEndpoint({ ...freeEndpoint, provider: 'together' as never })).toEqual({
      ok: false,
      reason: 'unknown_provider',
    });
  });

  it('rejects unverified pricing, trial credits and non-zero rates', () => {
    expect(
      assertZeroCostEndpoint({
        ...freeEndpoint,
        pricing: { ...freeEndpoint.pricing, evidenceUrl: 'not-a-url' },
      }),
    ).toEqual({ ok: false, reason: 'unverified_pricing' });
    expect(
      assertZeroCostEndpoint({
        ...freeEndpoint,
        pricing: { ...freeEndpoint.pricing, basis: 'trial' as never },
      }),
    ).toEqual({ ok: false, reason: 'trial_credits' });
    expect(
      assertZeroCostEndpoint({
        ...freeEndpoint,
        pricing: { ...freeEndpoint.pricing, note: 'Uses trial credits until they run out.' },
      }),
    ).toEqual({ ok: false, reason: 'trial_credits' });
    expect(assertZeroCostEndpoint({ ...freeEndpoint, promptCostPerMillion: 0.5 })).toEqual({
      ok: false,
      reason: 'nonzero_price',
    });
  });

  it('routes only model-priced endpoints and rejects plan-dependent free tiers', () => {
    expect(FREE_ENDPOINTS.length).toBeGreaterThan(0);
    const selection = selectFreeEndpoints(FREE_ENDPOINTS);
    expect(selection.usable.every((endpoint) => assertZeroCostEndpoint(endpoint).ok)).toBe(true);
    expect(selection.usable.every((endpoint) => endpoint.pricing.basis === 'free-model')).toBe(
      true,
    );
    expect(selection.rejected).toEqual([
      { id: 'groq-gpt-oss-120b', reason: 'billing_plan_unverified' },
      { id: 'cloudflare-llama-3-3-70b-free', reason: 'billing_plan_unverified' },
    ]);
    expect(selection.usable.every((endpoint) => (endpoint.promptCostPerMillion ?? 0) === 0)).toBe(
      true,
    );
  });

  it('excludes endpoints that cannot call tools when a turn needs them', () => {
    const noTools: FreeEndpoint = {
      ...freeEndpoint,
      id: 'no-tools',
      capabilities: { streaming: true, tools: false, reasoning: false },
    };
    const selection = selectFreeEndpoints([freeEndpoint, noTools], { requireTools: true });
    expect(selection.usable.map((endpoint) => endpoint.id)).toEqual(['test-free']);
  });

  it('orders the preferred model first, then operator priority', () => {
    const primary: FreeEndpoint = {
      ...freeEndpoint,
      id: 'primary',
      kind: 'primary',
      modelId: 'deepseek/deepseek-r1-0528',
      routingPriority: 99,
    };
    const second: FreeEndpoint = { ...freeEndpoint, id: 'second', routingPriority: 2 };
    const third: FreeEndpoint = { ...freeEndpoint, id: 'third', routingPriority: 3 };
    expect(selectFreeEndpoints([third, second, primary]).usable.map((e) => e.id)).toEqual([
      'primary',
      'second',
      'third',
    ]);
    expect(describePrimaryStatus([primary]).available).toBe(true);
  });
});
