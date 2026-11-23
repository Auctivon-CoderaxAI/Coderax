import { buildProviderFallbackCustomEndpoints } from 'coderax-data-provider';
import type { ProviderFallbackConfigLike } from 'coderax-data-provider';
import { buildProviderFallbackOptions } from './providerFallback';

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

const config: ProviderFallbackConfigLike = {
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
    ],
  },
  endpoints: { custom: [] },
};

function endpointFor(name: string) {
  return buildProviderFallbackCustomEndpoints(config, env).find(
    (endpoint) => endpoint.name === name,
  );
}

describe('buildProviderFallbackOptions', () => {
  it('does not attach account-tier or paid-capable automatic fallbacks', () => {
    const fallbacks = buildProviderFallbackOptions({
      endpoint: 'Gemini',
      endpointConfig: endpointFor('Gemini'),
      config,
      env,
      modelParameters: {
        model: 'gemini-3.5-flash-lite',
        temperature: 0.2,
        topP: 0.9,
        maxTokens: 1_024,
        stop: ['END'],
      },
    });

    expect(endpointFor('Gemini')).toBeUndefined();
    expect(fallbacks).toBeUndefined();
  });

  it('starts on the selected provider even when the configured order differs', () => {
    const groqConfig: ProviderFallbackConfigLike = {
      ...config,
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
        ],
      },
    };
    const fallbacks = buildProviderFallbackOptions({
      endpoint: 'Groq',
      endpointConfig: endpointFor('Groq'),
      config: groqConfig,
      env,
    });

    expect(fallbacks).toBeUndefined();
  });

  it('skips providers without a credential and stays disabled by default', () => {
    const onlyPrimary = buildProviderFallbackOptions({
      endpoint: 'Gemini',
      endpointConfig: endpointFor('Gemini'),
      config,
      env: { GEMINI_API_KEY: 'gemini-secret' },
    });
    expect(onlyPrimary).toBeUndefined();

    const disabled = buildProviderFallbackOptions({
      endpoint: 'Gemini',
      endpointConfig: endpointFor('Gemini'),
      config: { providerFallback: { enabled: false } },
      env,
    });
    expect(disabled).toBeUndefined();
  });

  it('does not attach fallbacks to an unrelated endpoint that reuses a provider name', () => {
    const fallbacks = buildProviderFallbackOptions({
      endpoint: 'Gemini',
      endpointConfig: {
        ...endpointFor('Gemini'),
        baseURL: 'https://operator.example.test/v1',
      },
      config,
      env,
    });

    expect(fallbacks).toBeUndefined();
  });
});
