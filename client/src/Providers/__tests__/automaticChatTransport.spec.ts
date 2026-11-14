import { EModelEndpoint, selectAutomaticChatModel } from 'coderax-data-provider';
import type { TEndpointsConfig, TPayload } from 'coderax-data-provider';
import type { Transport } from '~/hooks/Chat/contract';
import { createAutomaticChatTransport } from '../automaticChatTransport';

function makeTransport(start: jest.Mock): Transport {
  return { start } as unknown as Transport;
}

function makeRequest(endpoint: TPayload['endpoint'] = EModelEndpoint.openAI) {
  const payload: TPayload = {
    endpoint,
    endpointType: endpoint === 'openAI' ? EModelEndpoint.openAI : undefined,
    model: 'conversation-model',
    conversationId: 'conversation-1',
    clientRequestId: 'request-1',
    isContinued: false,
    isTemporary: false,
  };
  return { server: `https://coderax.example/api/agents/chat/${endpoint}`, payload };
}

const endpointsConfig = {
  openAI: { type: EModelEndpoint.openAI, modelDisplayLabel: 'OpenAI', order: 0 },
  ollama: { type: EModelEndpoint.custom, modelDisplayLabel: 'Local', order: 1 },
  openrouter: { type: EModelEndpoint.custom, modelDisplayLabel: 'OpenRouter', order: 2 },
} as TEndpointsConfig;

describe('automatic Chat model transport', () => {
  it('routes every standard model request through the selected model and fails over before streaming', async () => {
    const start = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ generationId: 'generation-1' });
    const selection = selectAutomaticChatModel([
      { id: 'primary:free', provider: 'openrouter', capability: 0.9 },
      { id: 'llama3', provider: 'ollama', local: true, capability: 0.8 },
      { id: 'paid-model', provider: 'openAI', capability: 1 },
    ]);
    const controller = createAutomaticChatTransport({
      transport: makeTransport(start),
      selection,
      endpointsConfig,
    });

    await expect(controller.transport.start(makeRequest())).resolves.toEqual({
      generationId: 'generation-1',
    });
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      server: 'https://coderax.example/api/agents/chat/openrouter',
      payload: { endpoint: 'openrouter', model: 'primary:free', endpointType: 'custom' },
    });
    expect(start.mock.calls[1]?.[0]).toMatchObject({
      server: 'https://coderax.example/api/agents/chat/ollama',
      payload: { endpoint: 'ollama', model: 'llama3', endpointType: 'custom' },
    });
    expect(start.mock.calls.map(([request]) => request.payload.model)).not.toContain('paid-model');
  });

  it('does not fail over after authorization, validation, or other non-availability errors', async () => {
    const start = jest.fn().mockRejectedValue({ response: { status: 401 } });
    const selection = selectAutomaticChatModel([
      { id: 'first:free', provider: 'openrouter' },
      { id: 'second', provider: 'ollama', local: true },
    ]);
    const controller = createAutomaticChatTransport({
      transport: makeTransport(start),
      selection,
      endpointsConfig,
    });

    await expect(controller.transport.start(makeRequest())).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not retry another model after cancellation', async () => {
    const start = jest.fn().mockRejectedValue({ response: { status: 503 } });
    const selection = selectAutomaticChatModel([
      { id: 'first:free', provider: 'openrouter' },
      { id: 'second', provider: 'ollama', local: true },
    ]);
    const controller = createAutomaticChatTransport({
      transport: makeTransport(start),
      selection,
      endpointsConfig,
    });
    const abort = new AbortController();
    abort.abort();

    await expect(
      controller.transport.start(makeRequest(), { signal: abort.signal }),
    ).rejects.toMatchObject({
      response: { status: 503 },
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('requires explicit consent before using a paid-only Chat catalog', async () => {
    const start = jest.fn().mockResolvedValue({ generationId: 'paid-generation' });
    const selection = selectAutomaticChatModel([
      {
        id: 'paid-model',
        provider: 'openAI',
        promptCost: 0.2,
        completionCost: 0.4,
      },
    ]);
    const controller = createAutomaticChatTransport({
      transport: makeTransport(start),
      selection,
      endpointsConfig,
    });

    await expect(controller.transport.start(makeRequest())).rejects.toThrow(
      'CHAT_PAID_MODEL_CONSENT_REQUIRED',
    );
    expect(start).not.toHaveBeenCalled();

    controller.approvePaidRequest();
    await expect(controller.transport.start(makeRequest())).resolves.toEqual({
      generationId: 'paid-generation',
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0].payload.model).toBe('paid-model');
    expect(start.mock.calls[0]?.[0].payload).toEqual(
      expect.objectContaining({ paidModelConsent: true }),
    );
  });

  it('keeps native agent and assistant conversations on their configured execution path', async () => {
    const start = jest.fn().mockResolvedValue({ generationId: 'agent-generation' });
    const selection = selectAutomaticChatModel([{ id: 'local', provider: 'ollama', local: true }]);
    const controller = createAutomaticChatTransport({
      transport: makeTransport(start),
      selection,
      endpointsConfig,
    });
    const request = makeRequest(EModelEndpoint.agents);

    await controller.transport.start(request);
    expect(start).toHaveBeenCalledWith(request, undefined);
  });
});
