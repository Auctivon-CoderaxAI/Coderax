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
  it('puts the other credentialed providers after the selected one', () => {
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

    expect(fallbacks).toEqual([
      {
        provider: 'openAI',
        maxContextTokens: 65_536,
        clientOptions: {
          model: 'gpt-oss-120b',
          apiKey: 'cerebras-secret',
          configuration: { baseURL: 'https://api.cerebras.ai/v1' },
          temperature: 0.2,
          topP: 0.9,
          maxTokens: 1_024,
          stop: ['END'],
        },
      },
      {
        provider: 'openAI',
        maxContextTokens: 32_768,
        clientOptions: {
          model: 'openai/gpt-oss-120b',
          apiKey: 'groq-secret',
          configuration: { baseURL: 'https://api.groq.com/openai/v1' },
          temperature: 0.2,
          topP: 0.9,
          maxTokens: 1_024,
          stop: ['END'],
        },
      },
      {
        provider: 'openAI',
        maxContextTokens: 200_000,
        clientOptions: {
          model: 'deepseek-v4.1-flash-free',
          apiKey: 'opencode-secret',
          configuration: { baseURL: 'https://opencode.ai/zen/v1' },
          temperature: 0.2,
          topP: 0.9,
          maxTokens: 1_024,
          stop: ['END'],
        },
      },
      {
        provider: 'openAI',
        maxContextTokens: 1_000_000,
        clientOptions: {
          model: 'free/deepseek-v4.1-flash',
          apiKey: 'apinex-secret',
          configuration: { baseURL: 'https://api.apinex.bond/v1' },
          temperature: 0.2,
          topP: 0.9,
          maxTokens: 1_024,
          stop: ['END'],
        },
      },
      {
        provider: 'openAI',
        maxContextTokens: 128_000,
        clientOptions: {
          model: '@cf/openai/gpt-oss-120b',
          apiKey: 'cloudflare-secret',
          configuration: {
            baseURL: 'https://api.cloudflare.com/client/v4/accounts/account-id/ai/v1',
          },
          temperature: 0.2,
          topP: 0.9,
          maxTokens: 1_024,
          stop: ['END'],
        },
      },
      {
        provider: 'openAI',
        maxContextTokens: 32_768,
        clientOptions: {
          model: 'qwen7b',
          apiKey: 'freeai-secret',
          configuration: { baseURL: 'https://api.free.ai/v1' },
          temperature: 0.2,
          topP: 0.9,
          maxTokens: 1_024,
          stop: ['END'],
        },
      },
      {
        provider: 'openAI',
        maxContextTokens: 198_000,
        clientOptions: {
          model: 'deepseek-v4.1-flash-free',
          apiKey: 'hundred-million-secret',
          configuration: { baseURL: 'https://100milionseek.top/v1' },
          temperature: 0.2,
          topP: 0.9,
          maxTokens: 1_024,
          stop: ['END'],
        },
      },
    ]);
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

    expect(fallbacks?.map((fallback) => fallback.clientOptions?.model)).toEqual([
      'gemini-3.5-flash-lite',
      'gpt-oss-120b',
      'deepseek-v4.1-flash-free',
      'free/deepseek-v4.1-flash',
      '@cf/openai/gpt-oss-120b',
      'qwen7b',
      'deepseek-v4.1-flash-free',
    ]);
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
