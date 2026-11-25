import { createFreeInferenceBudget } from './budget';
import { getFreeRouterForConfig } from './service';
import { createQuotaLedger } from './quota';

const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const sibling = 'nvidia/nemotron-3.5-lightning:free';

describe('free inference transport budget', () => {
  it('shares one daily ledger with the Work routing snapshot', () => {
    const config = {
      freeInference: { enabled: true, maxRequestsPerDay: 17, maxTokensPerDay: 123_456 },
    };
    const budget = createFreeInferenceBudget({ config, modelId: model });

    expect(budget).toBeDefined();
    expect(budget!.admit(10)).toMatchObject({ ok: true, reservedTokens: 10 });

    const router = getFreeRouterForConfig(config, {
      credentialEnvNames: ['OPENROUTER_API_KEY'],
    });
    const openrouter = router.snapshot().endpoints.find((entry) => entry.provider === 'openrouter');

    expect(openrouter?.quota.requestsUsed).toBe(1);
    expect(openrouter?.quota.tokensUsed).toBe(10);
    expect(openrouter?.quota.requestsLimit).toBe(17);
  });

  it('denies a request once the daily request budget is spent', () => {
    const budget = createFreeInferenceBudget({
      config: { freeInference: { enabled: true, maxRequestsPerDay: 2 } },
      modelId: model,
      ledger: createQuotaLedger({ limits: { requestsPerDay: 2, tokensPerDay: 1_000 } }),
    })!;

    expect(budget.admit(0).ok).toBe(true);
    expect(budget.admit(0).ok).toBe(true);
    expect(budget.admit(0)).toMatchObject({ ok: false, reason: 'request_budget' });
    expect(budget.snapshot().requestsUsed).toBe(2);
  });

  it('shares the provider quota group across model aliases on one account', () => {
    const ledger = createQuotaLedger({ limits: { requestsPerDay: 1, tokensPerDay: 1_000 } });
    const config = { freeInference: { enabled: true } };
    const first = createFreeInferenceBudget({ config, modelId: model, ledger })!;
    const second = createFreeInferenceBudget({ config, modelId: sibling, ledger })!;

    expect(first.admit(0).ok).toBe(true);
    expect(second.admit(0)).toMatchObject({ ok: false, reason: 'request_budget' });
  });

  it('does not create a budget for an empty model id', () => {
    expect(createFreeInferenceBudget({ config: undefined, modelId: '  ' })).toBeUndefined();
  });
});
