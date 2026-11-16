import {
  buildFreeInferenceCustomEndpoints,
  buildFreeInferenceWorkSources,
  describeFreeInferenceCatalog,
  mergeFreeInferenceCustomEndpoints,
} from './free-inference';

const enabled = { freeInference: { enabled: true } };
const openRouterKey = { OPENROUTER_API_KEY: 'test-key' };

describe('zero-cost catalog to Work projection', () => {
  it('adds nothing while free inference is disabled', () => {
    const state = describeFreeInferenceCatalog(
      { freeInference: { enabled: false } },
      openRouterKey,
    );
    expect(state.enabled).toBe(false);
    expect(state.endpoints.every((endpoint) => endpoint.blocked === 'disabled')).toBe(true);
    expect(buildFreeInferenceCustomEndpoints({}, openRouterKey)).toEqual([]);
    expect(buildFreeInferenceWorkSources({}, openRouterKey)).toEqual([]);
  });

  it('reports a missing credential without inventing an endpoint', () => {
    const state = describeFreeInferenceCatalog(enabled, {});
    const openRouter = state.endpoints.find((endpoint) => endpoint.provider === 'openrouter');
    expect(openRouter?.credentialPresent).toBe(false);
    expect(openRouter?.blocked).toBe('missing_credential');
    expect(state.executableProviders).toEqual([]);
    expect(buildFreeInferenceWorkSources(enabled, {})).toEqual([]);
  });

  it('turns a credentialed OpenRouter catalog into an executable custom endpoint', () => {
    const [endpoint] = buildFreeInferenceCustomEndpoints(enabled, openRouterKey);
    expect(endpoint).toMatchObject({
      name: 'FreeOpenRouter',
      baseURL: 'https://openrouter.ai/api/v1',
      modelDisplayLabel: 'OpenRouter (free)',
      models: {
        default: [
          'nvidia/nemotron-3-ultra-550b-a55b:free',
          'nvidia/nemotron-3.5-lightning:free',
          'google/gemma-4-31b-it:free',
        ],
      },
    });
    expect(endpoint.apiKey).toBe('${OPENROUTER_API_KEY}');
    expect(endpoint.apiKey).not.toContain('test-key');
  });

  it('offers only tool-capable endpoints to Work', () => {
    const sources = buildFreeInferenceWorkSources(enabled, openRouterKey);
    expect(sources).toHaveLength(3);
    expect(sources.every((source) => source.provider === 'FreeOpenRouter')).toBe(true);
    expect(sources.every((source) => source.free === true)).toBe(true);

    const groqOnly = buildFreeInferenceWorkSources(enabled, { GROQ_API_KEY: 'k' });
    expect(groqOnly).toEqual([]);
    expect(buildFreeInferenceCustomEndpoints(enabled, { GROQ_API_KEY: 'k' })).toEqual([]);
    expect(
      describeFreeInferenceCatalog(enabled, { GROQ_API_KEY: 'k' }).endpoints.find(
        (endpoint) => endpoint.provider === 'groq',
      )?.blocked,
    ).toBe('billing_plan_unverified');
  });

  it('does not route a free-tier provider when its account plan cannot be verified', () => {
    const state = describeFreeInferenceCatalog(enabled, {
      CLOUDFLARE_API_TOKEN: 'k',
      CLOUDFLARE_ACCOUNT_ID: 'acct',
    });
    const cloudflare = state.endpoints.find((endpoint) => endpoint.provider === 'cloudflare');
    expect(cloudflare?.blocked).toBe('billing_plan_unverified');
    expect(state.executableProviders).toEqual([]);
  });

  it('merges into a deployment config without replacing existing endpoints', () => {
    const config = {
      version: '1.3.17',
      freeInference: { enabled: true },
      endpoints: { custom: [{ name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1' }] },
    };
    const merged = mergeFreeInferenceCustomEndpoints(config, openRouterKey);
    expect(merged.endpoints.custom.map((entry) => entry.name)).toEqual([
      'Ollama',
      'FreeOpenRouter',
    ]);
    expect(mergeFreeInferenceCustomEndpoints(config, {})).toBe(config);
  });

  it('does not label a conflicting reserved endpoint name as free', () => {
    const modelId = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const config = {
      freeInference: { enabled: true },
      endpoints: {
        custom: [
          {
            name: 'FreeOpenRouter',
            baseURL: 'https://gateway.example/v1',
            models: { default: [modelId] },
          },
        ],
      },
    };

    const openRouter = describeFreeInferenceCatalog(config, openRouterKey).endpoints.find(
      (endpoint) => endpoint.provider === 'openrouter',
    );
    expect(openRouter?.blocked).toBe('endpoint_name_conflict');
    expect(buildFreeInferenceWorkSources(config, openRouterKey)).toEqual([]);
    expect(buildFreeInferenceCustomEndpoints(config, openRouterKey)).toEqual([]);
    expect(mergeFreeInferenceCustomEndpoints(config, openRouterKey)).toBe(config);
  });

  it('recognizes an existing canonical free endpoint without duplicating it', () => {
    const modelId = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const config = {
      freeInference: { enabled: true },
      endpoints: {
        custom: [
          {
            name: 'FreeOpenRouter',
            baseURL: 'https://openrouter.ai/api/v1',
            models: { default: [modelId] },
          },
        ],
      },
    };

    const openRouter = describeFreeInferenceCatalog(config, openRouterKey).endpoints.find(
      (endpoint) => endpoint.provider === 'openrouter',
    );
    expect(openRouter?.executable).toBe(true);
    expect(mergeFreeInferenceCustomEndpoints(config, openRouterKey)).toBe(config);
  });
});
