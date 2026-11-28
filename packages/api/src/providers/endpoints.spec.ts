jest.mock('coderax-data-provider', () => ({
  CATALOG_PROVIDERS: [
    {
      id: 'openrouter',
      label: 'OpenRouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
    },
    {
      id: 'groq',
      label: 'Groq',
      baseURL: 'https://api.groq.com/openai/v1',
      apiKeyEnv: 'GROQ_API_KEY',
    },
  ],
}));

import { buildCatalogCustomEndpoints, mergeCatalogCustomEndpoints } from './endpoints';
import type { CatalogModel, CatalogSnapshot } from 'coderax-data-provider';

const model = (overrides: Partial<CatalogModel>): CatalogModel => ({
  provider: 'openrouter',
  providerLabel: 'OpenRouter',
  id: 'free/model:free',
  label: 'Free Model',
  contextTokens: 1_000_000,
  pricing: { promptPerToken: 0, completionPerToken: 0, free: true, basis: 'per-model' },
  capabilities: { streaming: true, reasoning: true, tools: true, structuredOutputs: true },
  available: true,
  reason: 'available',
  chat: true,
  work: true,
  sourceURL: 'https://openrouter.ai/api/v1/models',
  discoveredAt: '2026-11-28T00:00:00.000Z',
  ...overrides,
});

const snapshot = (models: CatalogModel[]): CatalogSnapshot => ({
  generatedAt: '2026-11-28T00:00:00.000Z',
  providers: [],
  models,
  counts: {
    providers: 2,
    discoveredProviders: 1,
    models: models.length,
    availableModels: 0,
    workModels: 0,
  },
});

describe('buildCatalogCustomEndpoints', () => {
  it('groups eligible models per provider with a server-side credential reference', () => {
    const endpoints = buildCatalogCustomEndpoints(
      snapshot([
        model({ id: 'a:free' }),
        model({ id: 'b:free' }),
        // A published nonzero price never becomes an endpoint model.
        model({
          id: 'paid/model',
          available: false,
          chat: false,
          reason: 'nonzero_price',
          pricing: {
            promptPerToken: 0.000001,
            completionPerToken: 0.000001,
            free: false,
            basis: 'per-model',
          },
        }),
        // An account-plan provider stays visible in the catalog but has no route.
        model({
          provider: 'groq',
          providerLabel: 'Groq',
          id: 'openai/gpt-oss-120b',
          available: false,
          chat: false,
          reason: 'account_allowance_unverified',
        }),
      ]),
    );

    expect(endpoints).toEqual([
      {
        name: 'OpenRouter',
        catalogProvider: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: '${OPENROUTER_API_KEY}',
        modelDisplayLabel: 'OpenRouter',
        models: { default: ['a:free', 'b:free'] },
        titleConvo: false,
      },
    ]);
    expect(JSON.stringify(endpoints)).not.toContain('sk-');
  });

  it('adds nothing for a cold or empty catalog', () => {
    expect(buildCatalogCustomEndpoints(null)).toEqual([]);
    expect(buildCatalogCustomEndpoints(snapshot([]))).toEqual([]);
  });
});

describe('mergeCatalogCustomEndpoints', () => {
  it('preserves an operator endpoint with the same name', () => {
    const config = {
      endpoints: { custom: [{ name: 'OpenRouter', baseURL: 'https://proxy.internal/v1' }] },
    };
    expect(mergeCatalogCustomEndpoints(config, snapshot([model({})]))).toBe(config);
  });

  it('appends discovered endpoints without disturbing existing ones', () => {
    const config = {
      endpoints: { custom: [{ name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1' }] },
    };
    const merged = mergeCatalogCustomEndpoints(config, snapshot([model({})]));
    expect(merged.endpoints?.custom).toHaveLength(2);
    expect((merged.endpoints?.custom as Array<{ name: string }>)[0].name).toBe('Ollama');
  });
});
