import { MockAgent } from 'undici';
import { FREE_OPENROUTER_URL } from 'coderax-data-provider';
import { initializeModel, Providers } from '@librechat/agents';
import { createFreeInferenceBudget } from '../../routing/budget';
import { createFreeOpenRouterFetch } from './freeOpenRouter';
import { createQuotaLedger } from '../../routing/quota';
import { getOpenAIConfig } from './config';

const url = `${FREE_OPENROUTER_URL}/chat/completions`;
const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const messages = [{ role: 'user', content: 'hello' }];

function request(body: object) {
  return { method: 'POST', body: JSON.stringify(body) };
}

describe('free OpenRouter transport', () => {
  const send = jest.fn();
  const fetch = createFreeOpenRouterFetch(send);

  beforeEach(() => send.mockClear());

  it('keeps streaming and tools while pinning free-only fallbacks and privacy policy', async () => {
    const tools = [{ type: 'function', function: { name: 'example' } }];
    await fetch(
      url,
      request({
        model,
        messages,
        stream: true,
        tools,
        models: ['paid/model'],
        route: 'fallback',
        provider: { max_price: { prompt: 99 } },
        plugins: [{ id: 'web' }],
        max_completion_tokens: 12_000,
      }),
    );
    expect(send).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    );
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({
      model,
      messages,
      stream: true,
      tools,
      max_tokens: 4096,
      models: ['nvidia/nemotron-3.5-lightning:free', 'google/gemma-4-31b-it:free'],
      provider: {
        require_parameters: true,
        allow_fallbacks: false,
        data_collection: 'deny',
        zdr: true,
        max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
      },
    });
  });

  it.each([
    [{ max_completion_tokens: 12_000 }, 8192],
    [{ max_tokens: 6000 }, 6000],
    [{ max_tokens: -1 }, 8192],
    [{}, 8192],
  ])('enforces the configured ceiling with request limits %j', async (limits, expected) => {
    const configuredFetch = createFreeOpenRouterFetch(send, 8192);
    await configuredFetch(url, request({ model, messages, ...limits }));
    expect(JSON.parse(send.mock.calls[0][1].body).max_tokens).toBe(expected);
  });

  it.each(['openrouter/auto', 'unlisted/model:free', model.replace(':free', '')])(
    'blocks %s before contacting the provider',
    async (unapprovedModel) => {
      await expect(fetch(url, request({ model: unapprovedModel, messages }))).rejects.toThrow(
        'The selected free OpenRouter model is unavailable.',
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    url + '?x=1',
    FREE_OPENROUTER_URL + '/responses',
    'https://example.com/chat/completions',
  ])('rejects a noncanonical destination %s', async (destination) => {
    await expect(fetch(destination, request({ model, messages }))).rejects.toThrow(
      'Invalid free OpenRouter request.',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects built-in provider tools', async () => {
    await expect(
      fetch(url, request({ model, messages, tools: [{ type: 'web_search' }] })),
    ).rejects.toThrow('Only function tools');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('free OpenRouter daily budget', () => {
  const budgetSend = jest.fn();

  beforeEach(() => budgetSend.mockClear());

  const config = {
    freeInference: { enabled: true, maxRequestsPerDay: 5, maxTokensPerDay: 10_000 },
  };

  function jsonResponse(body: unknown, status = 200) {
    return {
      ok: status < 400,
      status,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => ({ json: async () => body }) as Response,
    } as unknown as Response;
  }

  function budgetWith(requestsPerDay: number, tokensPerDay = 10_000) {
    return createFreeInferenceBudget({
      config: { freeInference: { ...config.freeInference, maxRequestsPerDay: requestsPerDay } },
      modelId: model,
      ledger: createQuotaLedger({
        limits: { requestsPerDay, tokensPerDay },
      }),
    })!;
  }

  it('debits one request and settles measured usage', async () => {
    const budget = budgetWith(5);
    const guarded = createFreeOpenRouterFetch(budgetSend, 8192, budget);
    budgetSend.mockResolvedValueOnce(
      jsonResponse({ usage: { prompt_tokens: 11, completion_tokens: 4 } }),
    );

    await guarded(url, request({ model, messages }));

    expect(budget.snapshot()).toMatchObject({ requestsUsed: 1, tokensUsed: 15 });
  });

  it('stops before the provider once the daily request budget is spent', async () => {
    const budget = budgetWith(1);
    const guarded = createFreeOpenRouterFetch(budgetSend, 8192, budget);
    budgetSend.mockResolvedValueOnce(jsonResponse({ usage: { total_tokens: 3 } }));

    await guarded(url, request({ model, messages }));
    await expect(guarded(url, request({ model, messages }))).rejects.toThrow(
      'The free inference daily budget is exhausted; no paid provider was used.',
    );
    expect(budgetSend).toHaveBeenCalledTimes(1);
  });

  it('releases the token reservation when the provider declines without usage', async () => {
    const budget = budgetWith(5);
    const guarded = createFreeOpenRouterFetch(budgetSend, 8192, budget);
    budgetSend.mockResolvedValueOnce(jsonResponse({ error: { message: 'rate limited' } }, 429));

    await guarded(url, request({ model, messages }));

    expect(budget.snapshot()).toMatchObject({ requestsUsed: 1, tokensUsed: 0 });
  });

  it('refuses a prompt that cannot fit the remaining token budget', async () => {
    const budget = budgetWith(5, 1);
    const guarded = createFreeOpenRouterFetch(budgetSend, 8192, budget);

    await expect(
      guarded(url, request({ model, messages: [{ role: 'user', content: 'x'.repeat(400) }] })),
    ).rejects.toThrow('The free inference daily budget is exhausted');
    expect(budgetSend).not.toHaveBeenCalled();
  });

  it('keeps the reservation when a streaming response reports no usage', async () => {
    const budget = budgetWith(5);
    const guarded = createFreeOpenRouterFetch(budgetSend, 8192, budget);
    budgetSend.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
    } as unknown as Response);

    await guarded(url, request({ model, messages }));

    expect(budget.snapshot()).toMatchObject({ requestsUsed: 1 });
    expect(budget.snapshot().tokensUsed).toBeGreaterThan(0);
  });

  it('leaves the transport unguarded when no budget is supplied', async () => {
    const unguarded = createFreeOpenRouterFetch(budgetSend, 8192);
    budgetSend.mockResolvedValueOnce(jsonResponse({}));

    await unguarded(url, request({ model, messages }));
    await unguarded(url, request({ model, messages }));

    expect(budgetSend).toHaveBeenCalledTimes(2);
  });
});

it('sends the native agent SDK completion through the guarded transport', async () => {
  const dispatcher = new MockAgent();
  dispatcher.disableNetConnect();
  try {
    const origin = new URL(url).origin;
    dispatcher
      .get(origin)
      .intercept({
        path: '/api/v1/chat/completions',
        method: 'POST',
        body: (raw) => {
          const body = JSON.parse(raw);
          return (
            body.model === model &&
            body.max_tokens === 8192 &&
            body.provider?.allow_fallbacks === false &&
            body.provider?.data_collection === 'deny' &&
            body.provider?.zdr === true &&
            body.provider?.max_price?.prompt === 0 &&
            body.provider?.max_price?.completion === 0 &&
            body.models?.join(',') ===
              'nvidia/nemotron-3.5-lightning:free,google/gemma-4-31b-it:free' &&
            !body.plugins
          );
        },
      })
      .reply(
        200,
        {
          id: 'mock',
          object: 'chat.completion',
          created: 1,
          model,
          choices: [
            { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
          ],
        },
        { headers: { 'Content-Type': 'application/json' } },
      );

    const { llmConfig, configOptions } = getOpenAIConfig(
      'fake-key',
      {
        reverseProxyUrl: FREE_OPENROUTER_URL,
        modelOptions: { model },
        freeOpenRouterMaxOutputTokens: 8192,
        addParams: { models: ['paid/model'], plugins: [{ id: 'web' }], maxRetries: 0 },
        streaming: false,
      },
      'FreeOpenRouter',
    );
    const clientOptions = {
      ...llmConfig,
      configuration: { ...configOptions, fetchOptions: { dispatcher } },
    };
    const nativeModel = initializeModel<string>({ provider: Providers.OPENROUTER, clientOptions });
    await expect(nativeModel.invoke('test')).resolves.toMatchObject({ content: 'ok' });
    dispatcher.assertNoPendingInterceptors();
  } finally {
    await dispatcher.close();
  }
});
