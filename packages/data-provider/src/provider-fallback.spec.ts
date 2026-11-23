import type { ProviderFallbackConfigLike } from './provider-fallback';
import {
  buildProviderFallbackCustomEndpoints,
  mergeProviderFallbackCustomEndpoints,
  providerFallbackEndpointMatches,
  providerFallbackForEndpoint,
  providerFallbackOrder,
} from './provider-fallback';
import { configSchema } from './config';

const env = {
  GEMINI_API_KEY: 'gemini-secret',
  CEREBRAS_API_KEY: 'cerebras-secret',
  GROQ_API_KEY: 'groq-secret',
  OPENCODEAI_API_KEY: 'opencode-secret',
  APINEX_KEY: 'apinex-secret',
  CLOUDFLARE_TOKEN: 'cloudflare-secret',
  CLOUDFLARE_ACCOUNT_ID: 'account-id',
  VERCEL_KEY: 'vercel-secret',
  FREEAI_API_KEY: 'freeai-secret',
  '100MILLIONSEEK_API_KEY': 'hundred-million-secret',
};

const enabled = (overrides: Partial<NonNullable<ProviderFallbackConfigLike>> = {}) => ({
  providerFallback: {
    enabled: true,
    order: [
      'gemini',
      'cerebras',
      'groq',
      'opencode',
      'apinex',
      'cloudflare',
      'vercel',
      'freeai',
      '100millionseek',
    ] as const,
  },
  endpoints: { custom: [] },
  ...overrides,
});

describe('provider fallback config', () => {
  it('is disabled by default and includes every supported provider', () => {
    const parsed = configSchema.parse({ version: '1.0.0' });

    expect(parsed.providerFallback.enabled).toBe(false);
    expect(parsed.providerFallback.order).toEqual([
      'gemini',
      'cerebras',
      'groq',
      'opencode',
      'apinex',
      'cloudflare',
      'vercel',
      'freeai',
      '100millionseek',
    ]);
    expect(parsed.providerFallback.models.apinex).toBe('free/deepseek-v4.1-flash');
    expect(parsed.providerFallback.models.cloudflare).toBe('@cf/openai/gpt-oss-120b');
    expect(parsed.providerFallback.models.vercel).toBe('nvidia/nemotron-3.5-lightning-free');
    expect(parsed.providerFallback.models.freeai).toBe('qwen7b');
    expect(parsed.providerFallback.models['100millionseek']).toBe('deepseek-v4.1-flash-free');
  });
});

describe('provider fallback catalog', () => {
  it('maps every credentialed provider to an OpenAI-compatible endpoint', () => {
    const endpoints = buildProviderFallbackCustomEndpoints(enabled(), env);

    expect(endpoints.map((endpoint) => endpoint.name)).toEqual([
      'Gemini',
      'Cerebras',
      'Groq',
      'OpenCode',
      'APInex',
      'Cloudflare',
      'Vercel',
      'FreeAI',
      '100MillionSeek',
    ]);
    expect(endpoints[0]).toEqual({
      name: 'Gemini',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: '${GEMINI_API_KEY}',
      modelDisplayLabel: 'Google Gemini',
      models: { default: ['gemini-3.5-flash-lite'] },
      titleConvo: false,
    });
    expect(endpoints.find((endpoint) => endpoint.name === 'Cloudflare')).toMatchObject({
      baseURL: 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1',
      apiKey: '${CLOUDFLARE_TOKEN}',
      models: { default: ['@cf/openai/gpt-oss-120b'] },
    });
  });

  it('honors configured models and gateway roots', () => {
    const endpoints = buildProviderFallbackCustomEndpoints(
      {
        providerFallback: {
          enabled: true,
          models: { opencode: 'custom-zen-model' },
          baseURLs: { opencode: 'https://gateway.example.test/v1/' },
        },
      },
      { OPENCODEAI_API_KEY: 'secret' },
    );

    expect(endpoints).toEqual([
      {
        name: 'OpenCode',
        baseURL: 'https://gateway.example.test/v1',
        apiKey: '${OPENCODEAI_API_KEY}',
        modelDisplayLabel: 'OpenCode Zen',
        models: { default: ['custom-zen-model'] },
        titleConvo: false,
      },
    ]);
  });

  it('does nothing while disabled or without credentials', () => {
    expect(buildProviderFallbackCustomEndpoints({ providerFallback: {} }, env)).toEqual([]);
    expect(buildProviderFallbackCustomEndpoints(enabled(), {})).toEqual([]);
  });

  it('requires a Cloudflare account id as well as its token', () => {
    const endpoints = buildProviderFallbackCustomEndpoints(enabled(), {
      CLOUDFLARE_TOKEN: 'cloudflare-secret',
    });

    expect(endpoints).toEqual([]);
  });

  it('starts the chain on the selected provider without duplicating it', () => {
    expect(providerFallbackOrder(enabled(), 'groq').map((provider) => provider.id)).toEqual([
      'groq',
      'gemini',
      'cerebras',
      'opencode',
      'apinex',
      'cloudflare',
      'vercel',
      'freeai',
      '100millionseek',
    ]);
    expect(providerFallbackOrder(enabled(), 'gemini').map((provider) => provider.id)).toEqual([
      'gemini',
      'cerebras',
      'groq',
      'opencode',
      'apinex',
      'cloudflare',
      'vercel',
      'freeai',
      '100millionseek',
    ]);
  });

  it('matches the reserved endpoint name, URL, key reference and model', () => {
    const endpoint = buildProviderFallbackCustomEndpoints(enabled(), env)[0];
    const provider = providerFallbackForEndpoint('gemini');

    expect(provider).not.toBeNull();
    expect(providerFallbackEndpointMatches(endpoint, provider!, enabled())).toBe(true);
    expect(
      providerFallbackEndpointMatches(
        { ...endpoint, baseURL: 'https://other.test' },
        provider!,
        enabled(),
      ),
    ).toBe(false);
    expect(
      providerFallbackEndpointMatches({ ...endpoint, name: 'My Gemini' }, provider!, enabled()),
    ).toBe(false);
  });
});

describe('provider fallback configuration merge', () => {
  it('appends providers without replacing existing custom endpoints', () => {
    const config = {
      ...enabled(),
      endpoints: {
        custom: [
          {
            name: 'Groq',
            baseURL: 'https://operator.example.test/v1',
            apiKey: '${OPERATOR_GROQ_KEY}',
            models: { default: ['operator-model'] },
          },
        ],
      },
    };

    const merged = mergeProviderFallbackCustomEndpoints(config, env);
    const custom = merged.endpoints.custom as Array<{ name: string; baseURL?: string }>;

    expect(custom.map((endpoint) => endpoint.name)).toEqual([
      'Groq',
      'Gemini',
      'Cerebras',
      'OpenCode',
      'APInex',
      'Cloudflare',
      'Vercel',
      'FreeAI',
      '100MillionSeek',
    ]);
    expect(custom[0].baseURL).toBe('https://operator.example.test/v1');
  });

  it('returns the original object when nothing is added', () => {
    const config = enabled({ providerFallback: { enabled: false } });
    expect(mergeProviderFallbackCustomEndpoints(config, env)).toBe(config);
  });
});
