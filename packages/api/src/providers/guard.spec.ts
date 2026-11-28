import type { CatalogModel, CatalogSnapshot } from 'coderax-data-provider';
import { ModelRouteBlockedError, admitModelRoute, checkModelRoute } from './guard';

const NOW = Date.parse('2026-11-28T12:00:00.000Z');

function model(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    id: 'deepseek/deepseek-r1:free',
    label: 'DeepSeek R1 (free)',
    contextTokens: 163840,
    pricing: { promptPerToken: 0, completionPerToken: 0, free: true, basis: 'per-model' },
    capabilities: { streaming: true, reasoning: true, tools: true, structuredOutputs: false },
    available: true,
    reason: 'available',
    chat: true,
    work: true,
    ...overrides,
  } as CatalogModel;
}

function snapshot(
  models: CatalogModel[],
  generatedAt = new Date(NOW).toISOString(),
): CatalogSnapshot {
  return {
    generatedAt,
    counts: {
      providers: 1,
      discoveredProviders: 1,
      models: models.length,
      availableModels: 1,
      workModels: 1,
    },
    providers: [],
    models,
  } as CatalogSnapshot;
}

const selection = { provider: 'openrouter', model: 'deepseek/deepseek-r1:free' };

describe('checkModelRoute', () => {
  it('admits a verified free model', () => {
    const result = checkModelRoute(snapshot([model()]), selection, { now: NOW });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.model.id).toBe(selection.model);
    }
  });

  it('blocks a model that is no longer in the catalog', () => {
    const result = checkModelRoute(
      snapshot([model()]),
      { ...selection, model: 'gone' },
      { now: NOW },
    );
    expect(result).toMatchObject({ allowed: false, reason: 'model_not_in_catalog' });
  });

  it('blocks a paid model with the exact reason', () => {
    const paid = model({ available: false, reason: 'nonzero_price' });
    expect(checkModelRoute(snapshot([paid]), selection, { now: NOW })).toMatchObject({
      allowed: false,
      reason: 'nonzero_price',
    });
  });

  it('blocks unverified pricing and account allowances', () => {
    expect(
      checkModelRoute(
        snapshot([model({ available: false, reason: 'pricing_unverified' })]),
        selection,
        {
          now: NOW,
        },
      ),
    ).toMatchObject({ allowed: false, reason: 'pricing_unverified' });
    expect(
      checkModelRoute(
        snapshot([model({ available: false, reason: 'account_allowance_unverified' })]),
        selection,
        { now: NOW },
      ),
    ).toMatchObject({ allowed: false, reason: 'account_allowance_unverified' });
  });

  it('maps provider credential failures to provider_unavailable', () => {
    const rejectedReasons = [
      'credential_missing',
      'credential_rejected',
      'provider_unreachable',
    ] as const;
    for (const reason of rejectedReasons) {
      expect(
        checkModelRoute(snapshot([model({ available: false, reason })]), selection, { now: NOW }),
      ).toMatchObject({ allowed: false, reason: 'provider_unavailable' });
    }
  });

  it('blocks a snapshot too old to prove a $0 price', () => {
    const stale = new Date(NOW - 60 * 60_000).toISOString();
    const result = checkModelRoute(snapshot([model()], stale), selection, { now: NOW });
    expect(result).toMatchObject({ allowed: false, reason: 'catalog_stale' });
  });

  it('re-checks the snapshot on every call so a retry cannot reuse old evidence', async () => {
    const snapshots = [
      snapshot([model()]),
      snapshot([model({ available: false, reason: 'nonzero_price' })]),
    ];
    let calls = 0;
    const catalog = { snapshot: async () => snapshots[calls++] } as never;

    await expect(admitModelRoute(catalog, selection, { now: NOW })).resolves.toMatchObject({
      id: selection.model,
    });
    await expect(admitModelRoute(catalog, selection, { now: NOW })).rejects.toMatchObject({
      reason: 'nonzero_price',
    });
    expect(calls).toBe(2);
  });

  it('throws a typed error carrying the stable reason', async () => {
    const catalog = { snapshot: async () => snapshot([]) } as never;
    await expect(admitModelRoute(catalog, selection, { now: NOW })).rejects.toBeInstanceOf(
      ModelRouteBlockedError,
    );
  });
});
