import { MockAgent } from 'undici';
import { initializeModel, Providers } from '@librechat/agents';
import { getOpenAIConfig } from './config';
import { FREE_OPENROUTER_URL } from 'coderax-data-provider';
import { createFreeOpenRouterFetch } from './freeOpenRouter';

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

  it('keeps native streaming and function tools while stripping alternate routes and add-ons', async () => {
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
      provider: {
        require_parameters: true,
        max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
      },
    });
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
            body.provider?.max_price?.prompt === 0 &&
            body.provider?.max_price?.completion === 0 &&
            !body.models &&
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
        addParams: { models: ['paid/model'], plugins: [{ id: 'web' }], maxRetries: 0 },
        streaming: false,
      },
      'FreeOpenRouter',
    );
    const clientOptions = {
      ...llmConfig,
      configuration: { ...configOptions, fetchOptions: { dispatcher } },
    };
    const nativeModel = initializeModel({ provider: Providers.OPENROUTER, clientOptions });
    await expect(nativeModel.invoke('test')).resolves.toMatchObject({ content: 'ok' });
    dispatcher.assertNoPendingInterceptors();
  } finally {
    await dispatcher.close();
  }
});
