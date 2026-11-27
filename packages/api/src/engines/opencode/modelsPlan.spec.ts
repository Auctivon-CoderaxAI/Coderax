import {
  AUTO_MODEL,
  OPENROUTER_API_KEY_ENV,
  OPENROUTER_FREE_MODEL_IDS,
  isModelAllowedForMode,
  parseEngineModel,
  resolveModelPlan,
} from './models';

const withKey = (name: string) => name === OPENROUTER_API_KEY_ENV;

describe('OpenCode model plan', () => {
  it('orders verified $0 OpenRouter models first when the credential exists', () => {
    const plan = resolveModelPlan({
      configured: AUTO_MODEL,
      mode: 'cloud',
      hasEnv: withKey,
      maxAttempts: 3,
    });
    expect(plan.auto).toBe(true);
    expect(plan.candidates).toHaveLength(3);
    expect(plan.candidates.map((candidate) => candidate.model)).toEqual(
      OPENROUTER_FREE_MODEL_IDS.map((modelId) => ({ providerId: 'openrouter', modelId })),
    );
    expect(plan.candidates.every((candidate) => candidate.model.modelId.endsWith(':free'))).toBe(
      true,
    );
    expect(plan.detail).toBeUndefined();
  });

  it('skips a provider whose credential the server does not hold', () => {
    const plan = resolveModelPlan({
      configured: AUTO_MODEL,
      mode: 'cloud',
      hasEnv: () => false,
      maxAttempts: 2,
    });
    expect(plan.candidates).toHaveLength(2);
    expect(plan.candidates.every((candidate) => candidate.model.providerId === 'opencode')).toBe(
      true,
    );
  });

  it('bounds the number of candidates below the catalog size', () => {
    const plan = resolveModelPlan({
      configured: AUTO_MODEL,
      mode: 'cloud',
      hasEnv: withKey,
      maxAttempts: 1,
    });
    expect(plan.candidates).toHaveLength(1);
  });

  it('refuses automatic selection in private mode', () => {
    const plan = resolveModelPlan({ configured: AUTO_MODEL, mode: 'private', hasEnv: withKey });
    expect(plan.candidates).toEqual([]);
    expect(plan.detail).toContain('workChat.mode');
  });

  it('keeps one pinned candidate and refuses a chargeable one', () => {
    const pinned = resolveModelPlan({
      configured: 'openrouter/nvidia/nemotron-3.5-lightning:free',
      mode: 'cloud',
      hasEnv: withKey,
    });
    expect(pinned.auto).toBe(false);
    expect(pinned.candidates).toEqual([
      { model: { providerId: 'openrouter', modelId: 'nvidia/nemotron-3.5-lightning:free' } },
    ]);

    const paid = resolveModelPlan({
      configured: 'openrouter/anthropic/claude-sonnet-5',
      mode: 'cloud',
      hasEnv: withKey,
    });
    expect(paid.candidates).toEqual([]);
    expect(paid.detail).toBeDefined();
  });

  it('admits a free OpenRouter model in cloud mode only', () => {
    const model = parseEngineModel('openrouter/nvidia/nemotron-3.5-lightning:free');
    expect(isModelAllowedForMode(model, 'cloud')).toBe(true);
    expect(isModelAllowedForMode(model, 'private')).toBe(false);
  });
});
