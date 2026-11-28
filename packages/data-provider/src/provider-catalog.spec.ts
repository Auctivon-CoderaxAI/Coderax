import type {
  CatalogFetch,
  CatalogModel,
  CatalogProvider,
  CatalogSnapshot,
} from './provider-catalog';
import {
  CATALOG_PROVIDERS,
  ModelCatalog,
  ProviderHealthTracker,
  ProviderQuotaLedger,
  dedupeModels,
  discoverCatalog,
  discoverProviderModels,
  filterModels,
  normalizeProviderModels,
  planModelFallback,
  resolveProviderCredential,
  searchModels,
} from './provider-catalog';

const provider = (id: string): CatalogProvider => {
  const found = CATALOG_PROVIDERS.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing provider ${id}`);
  return found;
};

/** OpenRouter's /models shape, trimmed to the fields the adapter reads. */
const openRouterPayload = {
  data: [
    {
      id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      name: 'NVIDIA: Nemotron 3 Ultra (free)',
      context_length: 1_000_000,
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: ['tools', 'reasoning', 'response_format', 'temperature'],
      architecture: { input_modalities: ['text'] },
      endpoints: ['/api/v1/chat/completions'],
    },
    {
      id: 'deepseek/deepseek-v4.1-flash',
      name: 'DeepSeek: V4.1 Flash',
      context_length: 200_000,
      pricing: { prompt: '0.000000051', completion: '0.000000567' },
      supported_parameters: ['tools', 'reasoning'],
      architecture: { input_modalities: ['text'] },
      endpoints: ['/api/v1/chat/completions'],
    },
    {
      id: 'acme/vision-only:free',
      name: 'Acme Vision (free)',
      context_length: 32_000,
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: ['tools'],
      architecture: { input_modalities: ['image'] },
      endpoints: ['/api/v1/chat/completions'],
    },
  ],
};

/** Groq's /models shape: context window and modalities, no pricing, no tools. */
const groqPayload = {
  data: [
    {
      id: 'openai/gpt-oss-120b',
      name: 'GPT-OSS 120B',
      active: true,
      context_window: 131_072,
      input_modalities: ['text'],
      output_modalities: ['text'],
    },
    { id: 'whisper-large-v3', name: 'Whisper', active: true, context_window: 448 },
  ],
};

/** Gemini's native /v1beta/models shape. */
const geminiPayload = {
  models: [
    {
      name: 'models/gemini-3.5-flash-lite',
      displayName: 'Gemini 3.5 Flash Lite',
      inputTokenLimit: 1_000_000,
      supportedGenerationMethods: ['generateContent', 'countTokens'],
    },
  ],
};

/** Free.ai publishes a $0 price but bills past a daily token pool. */
const freeaiPayload = {
  data: [
    {
      id: 'qwen7b',
      name: 'Qwen 3.6 35B',
      type: 'chat',
      self_hosted: true,
      pricing: { prompt: '0', completion: '0' },
    },
  ],
};

const okFetch =
  (payload: unknown, status = 200): CatalogFetch =>
  async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  });

const now = () => new Date('2026-11-28T00:00:00.000Z');

describe('credential resolution', () => {
  it('prefers the canonical variable and reports a legacy alias separately', () => {
    const hundredMillionSeek = provider('100millionseek');
    expect(
      resolveProviderCredential(hundredMillionSeek, {
        HMS_API_KEY: 'a',
        '100MILLIONSEEK_API_KEY': 'b',
      }),
    ).toEqual({ status: 'present', env: 'HMS_API_KEY', legacy: false });
    expect(
      resolveProviderCredential(hundredMillionSeek, { '100MILLIONSEEK_API_KEY': 'b' }),
    ).toEqual({ status: 'present', env: '100MILLIONSEEK_API_KEY', legacy: true });
    expect(resolveProviderCredential(hundredMillionSeek, {})).toEqual({
      status: 'missing',
      env: null,
      legacy: false,
    });
  });
});

describe('provider adapters', () => {
  it('normalizes OpenRouter pricing, capabilities and context per model', async () => {
    const { state, models } = await discoverProviderModels(provider('openrouter'), {
      env: { OPENROUTER_API_KEY: 'test' },
      fetch: okFetch(openRouterPayload),
      now,
    });
    expect(state.status).toBe('ok');
    expect(models).toHaveLength(3);

    const free = models.find((model) => model.id.endsWith(':free'));
    expect(free).toMatchObject({
      available: true,
      reason: 'available',
      chat: true,
      work: true,
      contextTokens: 1_000_000,
      capabilities: { streaming: true, tools: true, reasoning: true, structuredOutputs: true },
    });

    const paid = models.find((model) => model.id === 'deepseek/deepseek-v4.1-flash');
    expect(paid).toMatchObject({ available: false, reason: 'nonzero_price', work: false });
    expect(paid?.pricing).toEqual({
      promptPerToken: 0.000000051,
      completionPerToken: 0.000000567,
      free: false,
      basis: 'per-model',
    });
  });

  it('keeps non-Chat OpenRouter models visible without routing to them', async () => {
    const embedding = {
      ...openRouterPayload.data[0],
      id: 'acme/embed',
      architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] },
      endpoints: ['/api/v1/embeddings'],
    };
    const { models } = await discoverProviderModels(provider('openrouter'), {
      env: { OPENROUTER_API_KEY: 'test' },
      fetch: async (url) => {
        expect(new URL(url).searchParams.get('output_modalities')).toBe('all');
        return okFetch({ data: [...openRouterPayload.data, embedding] })(url, { headers: {} });
      },
      now,
    });
    for (const id of ['acme/embed', 'acme/vision-only:free']) {
      expect(models.find((model) => model.id === id)).toMatchObject({
        pricing: { free: true },
        available: true,
        chat: false,
        work: false,
      });
    }
    for (const mode of ['chat', 'work'] as const) {
      expect(planModelFallback(models, { mode }).map(({ id }) => id)).toEqual([
        openRouterPayload.data[0].id,
      ]);
    }
  });

  it.each([
    [{ prompt: '0', completion: '0', request: '0.01' }, false, 'nonzero_price'],
    [{ completion: '0', image: '0.01' }, false, 'nonzero_price'],
    [{ prompt: '0', completion: '0', input_cache_read: '0.01' }, false, 'nonzero_price'],
    [{ prompt: '0', completion: '0', overrides: [{ prompt: '0.01' }] }, false, 'nonzero_price'],
    [{ prompt: '0', completion: '0', request: 'unknown' }, null, 'pricing_unverified'],
    [{ prompt: '0' }, null, 'pricing_unverified'],
  ] as const)('keeps OpenRouter pricing %j out of routing', (pricing, free, reason) => {
    const models = normalizeProviderModels(
      provider('openrouter'),
      { data: [{ ...openRouterPayload.data[0], pricing }] },
      { status: 'present', env: 'OPENROUTER_API_KEY', legacy: false },
      now().toISOString(),
    );
    expect(models[0]).toMatchObject({ pricing: { free }, reason, available: false });
    expect(planModelFallback(models, { mode: 'chat' })).toEqual([]);
  });

  it.each([200, 503])('follows Gemini page tokens and handles a later HTTP %i', async (status) => {
    const token = 'next+/=';
    const fetch: CatalogFetch = async (url, init) => {
      expect(init.headers['x-goog-api-key']).toBe('test');
      const current = new URL(url).searchParams.get('pageToken');
      if (current === null) {
        return okFetch({ ...geminiPayload, nextPageToken: token })(url, init);
      }
      expect(current).toBe(token);
      return okFetch({ models: [{ name: 'models/second-page' }] }, status)(url, init);
    };
    const { state, models } = await discoverProviderModels(provider('gemini'), {
      env: { GEMINI_API_KEY: 'test' },
      fetch,
      now,
    });
    expect(state).toMatchObject({
      status: status === 200 ? 'ok' : 'provider_unreachable',
      httpStatus: status,
      modelCount: status === 200 ? 2 : 0,
    });
    expect(models.map(({ id }) => id)).toEqual(
      status === 200 ? ['gemini-3.5-flash-lite', 'second-page'] : [],
    );
  });

  it('reads Gemini names, strips the models/ prefix and keeps account-plan models visible', async () => {
    const { state, models } = await discoverProviderModels(provider('gemini'), {
      env: { GEMINI_API_KEY: 'test' },
      fetch: okFetch(geminiPayload),
      now,
    });
    expect(state.status).toBe('ok');
    expect(models[0]).toMatchObject({
      id: 'gemini-3.5-flash-lite',
      label: 'Gemini 3.5 Flash Lite',
      contextTokens: 1_000_000,
      available: false,
      reason: 'account_allowance_unverified',
      chat: false,
      work: false,
    });
  });

  it('keeps Groq models visible with their context windows and no invented tool support', async () => {
    const { models } = await discoverProviderModels(provider('groq'), {
      env: { GROQ_API_KEY: 'test' },
      fetch: okFetch(groqPayload),
      now,
    });
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      id: 'openai/gpt-oss-120b',
      contextTokens: 131_072,
      capabilities: { tools: null, structuredOutputs: null },
      reason: 'account_allowance_unverified',
    });
  });

  it('disables a $0-priced metered-allowance model instead of treating the price as proof', async () => {
    const { models } = await discoverProviderModels(provider('freeai'), {
      env: { FREEAI_API_KEY: 'test' },
      fetch: okFetch(freeaiPayload),
      now,
    });
    expect(models[0]).toMatchObject({
      id: 'qwen7b',
      pricing: { promptPerToken: 0, completionPerToken: 0, free: true },
      available: false,
      reason: 'account_allowance_unverified',
    });
  });

  it('marks an inactive model unavailable', () => {
    const models = normalizeProviderModels(
      provider('groq'),
      { data: [{ id: 'retired-model', active: false, context_window: 8192 }] },
      { status: 'present', env: 'GROQ_API_KEY', legacy: false },
      '2026-11-28T00:00:00.000Z',
    );
    expect(models[0].reason).toBe('model_inactive');
  });
});

describe('discovery states', () => {
  it('lists a provider with no credential instead of hiding it', async () => {
    const { state, models } = await discoverProviderModels(provider('cerebras'), {
      env: {},
      fetch: okFetch({ data: [] }),
      now,
    });
    expect(state).toMatchObject({ status: 'credential_missing', modelCount: 0 });
    expect(state.credential).toEqual({ status: 'missing', env: null, legacy: false });
    expect(models).toEqual([]);
  });

  it('reports a rejected credential rather than an empty catalog', async () => {
    for (const status of [401, 403]) {
      const { state, models } = await discoverProviderModels(provider('apinex'), {
        env: { APINEX_KEY: 'test' },
        fetch: okFetch({ error: 'unauthorized' }, status),
        now,
      });
      expect(state).toMatchObject({ status: 'credential_rejected', httpStatus: status });
      expect(models).toEqual([]);
    }
  });

  it('reports an unreachable provider and keeps its credential state', async () => {
    const { state } = await discoverProviderModels(provider('opencodeai'), {
      env: { OPENCODEAI_API_KEY: 'test' },
      fetch: async () => {
        throw new Error('network down');
      },
      now,
    });
    expect(state).toMatchObject({ status: 'provider_unreachable', error: 'network down' });
  });
});

describe('catalog discovery', () => {
  const routedFetch: CatalogFetch = async (url) => {
    if (url.includes('openrouter'))
      return { status: 200, ok: true, json: async () => openRouterPayload };
    if (url.includes('generativelanguage'))
      return { status: 200, ok: true, json: async () => geminiPayload };
    if (url.includes('groq')) return { status: 200, ok: true, json: async () => groqPayload };
    if (url.includes('free.ai')) return { status: 200, ok: true, json: async () => freeaiPayload };
    if (url.includes('cerebras')) return { status: 401, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => ({ data: [{ id: 'provider-model' }] }) };
  };

  it('discovers all eight providers and records each one independently', async () => {
    const snapshot = await discoverCatalog({
      env: {
        OPENROUTER_API_KEY: 'a',
        GEMINI_API_KEY: 'b',
        CEREBRAS_API_KEY: 'c',
        GROQ_API_KEY: 'd',
        OPENCODEAI_API_KEY: 'e',
        APINEX_KEY: 'f',
        FREEAI_API_KEY: 'g',
        HMS_API_KEY: 'h',
      },
      fetch: routedFetch,
      now,
    });
    expect(snapshot.counts.providers).toBe(8);
    expect(snapshot.providers.map((entry) => entry.provider)).toEqual(
      CATALOG_PROVIDERS.map((entry) => entry.id),
    );
    expect(snapshot.providers.find((entry) => entry.provider === 'cerebras')?.status).toBe(
      'credential_rejected',
    );
    // Two OpenRouter $0 models pass; only the one advertising tools is Work-capable.
    expect(snapshot.counts.availableModels).toBe(2);
    expect(snapshot.counts.workModels).toBe(1);
  });

  it.each([
    [{ error: 'maintenance' }, 'provider_unreachable', 0],
    [{ data: [] }, 'ok', 1],
  ] as const)('reports the discovery status for %j', async (payload, status, discovered) => {
    const snapshot = await discoverCatalog({
      providers: [provider('openrouter')],
      env: { OPENROUTER_API_KEY: 'test' },
      fetch: okFetch(payload),
      now,
    });
    expect(snapshot.providers[0]).toMatchObject({ status, modelCount: 0, httpStatus: 200 });
    expect(snapshot.counts.discoveredProviders).toBe(discovered);
  });

  it('reports missing credentials per provider without dropping the others', async () => {
    const snapshot = await discoverCatalog({
      env: { OPENROUTER_API_KEY: 'a' },
      fetch: routedFetch,
      now,
    });
    expect(
      snapshot.providers.filter((entry) => entry.status === 'credential_missing'),
    ).toHaveLength(7);
    expect(snapshot.models.map(({ id }) => id)).toEqual(openRouterPayload.data.map(({ id }) => id));
  });
});

describe('search, filter and deduplication', () => {
  const models = normalizeProviderModels(
    provider('openrouter'),
    openRouterPayload,
    { status: 'present', env: 'OPENROUTER_API_KEY', legacy: false },
    '2026-11-28T00:00:00.000Z',
  );

  it('searches by identifier, label and provider', () => {
    expect(searchModels(models, 'nemotron')).toHaveLength(1);
    expect(searchModels(models, 'deepseek').map((model) => model.id)).toEqual([
      'deepseek/deepseek-v4.1-flash',
    ]);
    expect(searchModels(models, '')).toHaveLength(3);
  });

  it('filters Work to models with verified tool calling', () => {
    expect(filterModels(models, { mode: 'work' }).map((model) => model.id)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
    ]);
    expect(filterModels(models, { availableOnly: true })).toHaveLength(2);
    expect(filterModels(models, { minContextTokens: 500_000 })).toHaveLength(1);
  });

  it('deduplicates repeated identifiers per provider', () => {
    expect(dedupeModels([...models, models[0]])).toHaveLength(3);
  });
});

describe('fallback, health and quota', () => {
  const build = (): CatalogModel[] => [
    {
      provider: 'openrouter',
      providerLabel: 'OpenRouter',
      id: 'deepseek/deepseek-v4.1-flash-fast:free',
      label: 'DeepSeek V4.1 Flash Fast (free)',
      contextTokens: 200_000,
      pricing: { promptPerToken: 0, completionPerToken: 0, free: true, basis: 'per-model' },
      capabilities: { streaming: true, reasoning: true, tools: true, structuredOutputs: true },
      chat: true,
      work: true,
      available: true,
      reason: 'available',
      sourceURL: 'https://openrouter.ai/api/v1/models',
      discoveredAt: '2026-11-28T00:00:00.000Z',
    },
    {
      provider: 'groq',
      providerLabel: 'Groq',
      id: 'openai/gpt-oss-120b',
      label: 'GPT-OSS 120B',
      contextTokens: 131_072,
      pricing: {
        promptPerToken: null,
        completionPerToken: null,
        free: null,
        basis: 'account-plan',
      },
      capabilities: { streaming: true, reasoning: null, tools: null, structuredOutputs: null },
      chat: false,
      work: false,
      available: false,
      reason: 'account_allowance_unverified',
      sourceURL: 'https://console.groq.com/docs/models',
      discoveredAt: '2026-11-28T00:00:00.000Z',
    },
    {
      provider: '100millionseek',
      providerLabel: '100MillionSeek',
      id: 'deepseek-v4.1-flash-free',
      label: 'DeepSeek V4.1 Flash (100MillionSeek)',
      contextTokens: 198_000,
      pricing: {
        promptPerToken: null,
        completionPerToken: null,
        free: null,
        basis: 'account-plan',
      },
      capabilities: { streaming: true, reasoning: null, tools: true, structuredOutputs: null },
      chat: false,
      work: false,
      available: false,
      reason: 'account_allowance_unverified',
      sourceURL: 'https://100milionseek.top/docs',
      discoveredAt: '2026-11-28T00:00:00.000Z',
    },
  ];

  it('plans only zero-cost models and prefers the owner model when eligible', () => {
    expect(planModelFallback(build(), { mode: 'chat' }).map((model) => model.id)).toEqual([
      'deepseek/deepseek-v4.1-flash-fast:free',
    ]);
    expect(
      planModelFallback(build(), {
        mode: 'work',
        preferredModelId: 'deepseek/deepseek-v4.1-flash-fast:free',
      })[0].id,
    ).toBe('deepseek/deepseek-v4.1-flash-fast:free');
  });

  it('never routes Work to a model without verified tools', () => {
    const models = build().map((model) => ({ ...model, work: false }));
    expect(planModelFallback(models, { mode: 'work' })).toEqual([]);
  });

  it('skips a provider that is cooling down after a failure', () => {
    const health = new ProviderHealthTracker();
    health.recordFailure('openrouter', 'HTTP 429', 1_000);
    expect(health.isAvailable('openrouter', 2_000)).toBe(false);
    expect(planModelFallback(build(), { mode: 'chat', now: 2_000, health })).toEqual([]);
    expect(planModelFallback(build(), { mode: 'chat', now: 31_001, health })).toHaveLength(1);
  });

  it('uses the current limit without changing recorded usage', () => {
    const quota = new ProviderQuotaLedger();
    expect(quota.consume('openrouter', 1_000, 2)).toBe(true);
    expect(
      planModelFallback(build(), {
        mode: 'chat',
        now: 1_000,
        quota,
        providerLimits: { openrouter: 1 },
      }),
    ).toEqual([]);
    expect(quota.consume('openrouter', 1_000, 1)).toBe(false);
    expect(quota.remaining('openrouter', 1_000, 3)).toBe(2);
    expect(quota.remaining('openrouter', 86_400_000, 1)).toBe(1);
  });

  it('leaves spent usage intact when the request count is invalid', () => {
    const quota = new ProviderQuotaLedger();
    expect(quota.consume('openrouter', 1_000, 1)).toBe(true);
    for (const invalid of [-1, NaN, Infinity, 0.5]) {
      expect(quota.consume('openrouter', 1_000, 1, invalid)).toBe(false);
    }
    expect(quota.consume('openrouter', 1_000, 1)).toBe(false);
    expect(quota.remaining('openrouter', 1_000, 1)).toBe(0);
  });

  it.each([0, -1])('excludes a limit of %i without a ledger', (limit) => {
    expect(
      planModelFallback(build(), {
        mode: 'chat',
        providerLimits: { openrouter: limit },
      }),
    ).toEqual([]);
  });

  it('stops routing once the provider daily quota is spent', () => {
    const quota = new ProviderQuotaLedger();
    const limits = { openrouter: 2 };
    expect(quota.consume('openrouter', 1_000, 2)).toBe(true);
    expect(quota.consume('openrouter', 1_000, 2)).toBe(true);
    expect(quota.consume('openrouter', 1_000, 2)).toBe(false);
    expect(quota.remaining('openrouter', 1_000, 2)).toBe(0);
    expect(
      planModelFallback(build(), { mode: 'chat', now: 1_000, quota, providerLimits: limits }),
    ).toEqual([]);
  });
});

describe('catalog cache', () => {
  const snapshot = (at: string, models: CatalogModel[]): CatalogSnapshot => ({
    generatedAt: at,
    providers: [],
    models,
    counts: {
      providers: 8,
      discoveredProviders: 1,
      models: models.length,
      availableModels: 1,
      workModels: 1,
    },
  });
  const model = normalizeProviderModels(
    provider('openrouter'),
    openRouterPayload,
    { status: 'present', env: 'OPENROUTER_API_KEY', legacy: false },
    '2026-11-28T00:00:00.000Z',
  );

  it('serves a cached snapshot inside the TTL and refreshes after it expires', async () => {
    let clock = 0;
    let calls = 0;
    const catalog = new ModelCatalog({
      ttlMs: 1_000,
      now: () => clock,
      discover: async () => {
        calls += 1;
        return snapshot(`t${calls}`, model);
      },
    });
    await catalog.ensureFresh();
    clock = 500;
    await catalog.ensureFresh();
    expect(calls).toBe(1);
    clock = 1_500;
    await catalog.ensureFresh();
    expect(calls).toBe(2);
  });

  it('shares one in-flight refresh between concurrent readers', async () => {
    let calls = 0;
    const catalog = new ModelCatalog({
      now: () => 0,
      discover: async () => {
        calls += 1;
        return snapshot('t1', model);
      },
    });
    await Promise.all([catalog.refresh(), catalog.refresh()]);
    expect(calls).toBe(1);
  });

  it('retains disabled rows on a resolved HTTP outage, then retries a valid empty catalog', async () => {
    let clock = 0;
    let response = okFetch(openRouterPayload);
    const catalog = new ModelCatalog({
      now: () => clock,
      env: { OPENROUTER_API_KEY: 'test' },
      fetch: (url, init) => response(url, init),
    });
    const good = await catalog.ensureFresh();
    expect(good.counts.availableModels).toBeGreaterThan(0);
    clock = 100;
    response = okFetch({}, 503);
    const failed = await catalog.refresh();
    expect(failed.generatedAt).toBe(good.generatedAt);
    expect(failed.models.map(({ id, discoveredAt }) => ({ id, discoveredAt }))).toEqual(
      good.models.map(({ id, discoveredAt }) => ({ id, discoveredAt })),
    );
    expect(failed.providers[0]).toMatchObject({ status: 'provider_unreachable', httpStatus: 503 });
    expect(failed.counts).toMatchObject({
      discoveredProviders: 0,
      availableModels: 0,
      workModels: 0,
    });
    expect(planModelFallback(failed.models, { mode: 'chat' })).toEqual([]);
    expect(planModelFallback(failed.models, { mode: 'work' })).toEqual([]);
    expect(catalog.isStale()).toBe(true);

    clock = 200;
    response = okFetch({ data: [] });
    const recovered = await catalog.ensureFresh();
    expect(recovered.counts.discoveredProviders).toBe(1);
    expect(recovered.models).toEqual([]);
    expect(catalog.isStale()).toBe(false);
  });

  it('keeps the last good snapshot when a refresh fails', async () => {
    let calls = 0;
    const catalog = new ModelCatalog({
      ttlMs: 1,
      now: () => calls * 10,
      discover: async () => {
        calls += 1;
        if (calls === 1) return snapshot('t1', model);
        throw new Error('network down');
      },
    });
    await catalog.ensureFresh();
    await catalog.refresh();
    expect(catalog.current()?.generatedAt).toBe('t1');
  });
});
