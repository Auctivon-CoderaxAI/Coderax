import type { FreeEndpoint } from 'coderax-data-provider';
import { probeFreeEndpoint, type FreeFetch } from './probe';

const endpoint: FreeEndpoint = {
  id: 'openrouter-reasoning-free',
  provider: 'openrouter',
  modelId: 'nvidia/nemotron-3.5-lightning:free',
  label: 'Reasoning fallback (free)',
  kind: 'fallback',
  baseURL: 'https://openrouter.ai/api/v1',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  pricing: {
    basis: 'free-model',
    verifiedAt: '2026-11-08',
    evidenceUrl: 'https://openrouter.ai/api/v1/models',
    note: 'Test fixture priced at 0.',
  },
  capabilities: { streaming: true, tools: true, reasoning: true },
  contextTokens: 1_000_000,
  routingPriority: 10,
};

function fetchReturning(payload: unknown) {
  return jest.fn(async (_input: string, _init: Parameters<FreeFetch>[1]) => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }));
}

describe('free inference probe', () => {
  it('verifies a reasoning-only completion and leaves room for reasoning tokens', async () => {
    const fetchImpl = fetchReturning({
      model: endpoint.modelId,
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            reasoning: 'The answer is OK.',
          },
        },
      ],
    });

    const result = await probeFreeEndpoint({ endpoint, apiKey: 'test-key', fetchImpl });

    expect(result).toMatchObject({
      ok: true,
      errorCode: null,
      modelEcho: endpoint.modelId,
    });
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body) as { max_tokens: number };
    expect(request.max_tokens).toBe(64);
  });

  it('still rejects a completion with no generated text', async () => {
    const fetchImpl = fetchReturning({
      choices: [{ message: { role: 'assistant', content: '', reasoning: '' } }],
    });

    const result = await probeFreeEndpoint({ endpoint, apiKey: 'test-key', fetchImpl });

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'invalid_response',
    });
  });
});
