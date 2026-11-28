/**
 * Catalog service contract.
 *
 * The model catalog is mocked because these tests exercise the status
 * projection and the cache/refresh behavior the route depends on, not the
 * provider adapters (covered by packages/data-provider).
 */
const mockEnsureFresh = jest.fn();
const mockRefresh = jest.fn();

jest.mock('coderax-data-provider', () => ({
  ModelCatalog: jest.fn().mockImplementation(() => ({
    ensureFresh: () => mockEnsureFresh(),
    refresh: () => mockRefresh(),
  })),
  filterModels: (models: unknown[], filter: { mode?: string }) =>
    filter.mode === 'work'
      ? models.filter((model) => (model as { work?: boolean }).work === true)
      : models,
  planModelFallback: (models: unknown[], options: { preferredModelId?: string }) => {
    const list = models as Array<{ id: string }>;
    const preferred = list.find((model) => model.id === options.preferredModelId);
    return preferred ? [preferred] : list;
  },
}));

import { catalogReport, createProviderCatalog } from './catalog';
import type { CatalogSnapshot } from 'coderax-data-provider';

const snapshot = (overrides: Partial<CatalogSnapshot> = {}): CatalogSnapshot => ({
  generatedAt: '2026-11-28T00:00:00.000Z',
  providers: [
    {
      provider: 'openrouter',
      label: 'OpenRouter',
      credential: { status: 'present', env: 'OPENROUTER_API_KEY', legacy: false },
      status: 'ok',
      httpStatus: 200,
      error: null,
      modelCount: 2,
      discoveredAt: '2026-11-28T00:00:00.000Z',
    },
    {
      provider: 'cerebras',
      label: 'Cerebras',
      credential: { status: 'present', env: 'CEREBRAS_API_KEY', legacy: false },
      status: 'credential_rejected',
      httpStatus: 401,
      error: 'HTTP 401',
      modelCount: 0,
      discoveredAt: null,
    },
    {
      provider: 'gemini',
      label: 'Google Gemini',
      credential: { status: 'missing', env: null, legacy: false },
      status: 'credential_missing',
      httpStatus: null,
      error: null,
      modelCount: 0,
      discoveredAt: null,
    },
  ],
  models: [
    {
      provider: 'openrouter',
      providerLabel: 'OpenRouter',
      id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      label: 'Nemotron 3 Ultra (free)',
      contextTokens: 1_000_000,
      pricing: { promptPerToken: 0, completionPerToken: 0, free: true, basis: 'per-model' },
      capabilities: { streaming: true, reasoning: true, tools: true, structuredOutputs: true },
      available: true,
      reason: 'available',
      chat: true,
      work: true,
      sourceURL: 'https://openrouter.ai/api/v1/models',
      discoveredAt: '2026-11-28T00:00:00.000Z',
    },
    {
      provider: 'openrouter',
      providerLabel: 'OpenRouter',
      id: 'deepseek/deepseek-v4.1-flash',
      label: 'DeepSeek V4.1 Flash',
      contextTokens: 200_000,
      pricing: {
        promptPerToken: 0.000000051,
        completionPerToken: 0.000000567,
        free: false,
        basis: 'per-model',
      },
      capabilities: { streaming: true, reasoning: true, tools: true, structuredOutputs: true },
      available: false,
      reason: 'nonzero_price',
      chat: false,
      work: false,
      sourceURL: 'https://openrouter.ai/api/v1/models',
      discoveredAt: '2026-11-28T00:00:00.000Z',
    },
  ],
  counts: { providers: 3, discoveredProviders: 1, models: 2, availableModels: 1, workModels: 1 },
  ...overrides,
});

describe('catalogReport', () => {
  it('separates credential state, authentication, discovery and eligibility per provider', () => {
    const report = catalogReport(snapshot());

    expect(report.providers).toEqual([
      {
        provider: 'openrouter',
        label: 'OpenRouter',
        credential: { configured: true, env: 'OPENROUTER_API_KEY', legacy: false },
        authentication: 'authenticated',
        modelsDiscovered: 2,
        modelsEligible: 1,
        blockedReasons: { nonzero_price: 1 },
      },
      {
        provider: 'cerebras',
        label: 'Cerebras',
        credential: { configured: true, env: 'CEREBRAS_API_KEY', legacy: false },
        authentication: 'rejected',
        modelsDiscovered: 0,
        modelsEligible: 0,
        blockedReasons: {},
      },
      {
        provider: 'gemini',
        label: 'Google Gemini',
        credential: { configured: false, env: null, legacy: false },
        authentication: 'not_attempted',
        modelsDiscovered: 0,
        modelsEligible: 0,
        blockedReasons: {},
      },
    ]);
  });

  it('never exposes a credential value in the report', () => {
    const report = catalogReport(snapshot());
    expect(JSON.stringify(report)).not.toMatch(/api[-_]?key["']?\s*:\s*["'][^"']+["']/i);
    for (const provider of report.providers) {
      expect(Object.keys(provider.credential).sort()).toEqual(['configured', 'env', 'legacy']);
    }
  });
});

describe('createProviderCatalog', () => {
  beforeEach(() => {
    mockEnsureFresh.mockReset();
    mockRefresh.mockReset();
  });

  it('serves the cached snapshot for reads and a fresh one for refresh', async () => {
    mockEnsureFresh.mockResolvedValue(snapshot());
    mockRefresh.mockResolvedValue(snapshot({ generatedAt: '2026-11-28T01:00:00.000Z' }));
    const catalog = createProviderCatalog({});

    expect((await catalog.report()).generatedAt).toBe('2026-11-28T00:00:00.000Z');
    expect((await catalog.refresh()).generatedAt).toBe('2026-11-28T01:00:00.000Z');
    expect(mockEnsureFresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('filters Work selection to models verified for tool calling', async () => {
    mockEnsureFresh.mockResolvedValue(snapshot());
    const catalog = createProviderCatalog({});
    expect((await catalog.models({ mode: 'work' })).map((model) => model.id)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
    ]);
  });

  it('prefers the owner model only when it is eligible', async () => {
    mockEnsureFresh.mockResolvedValue(snapshot());
    const catalog = createProviderCatalog({});
    const selected = await catalog.select({
      mode: 'chat',
      preferredModelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    });
    expect(selected[0].id).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
  });
});
