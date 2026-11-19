import { EModelEndpoint } from 'coderax-data-provider';
import type { ChatTransportRequest } from 'coderax-data-provider';
import type { WorkOptions } from '~/components/Chat/Input/workSelection';
import { toWorkOptions } from '~/components/Chat/Input/workSelection';
import { createWorkChatTransport } from '../ChatTransportContext';
import { toWorkChatServer, toWorkEngineChatServer, toWorkEngineStreamUrl } from '../workTransport';

describe('toWorkChatServer', () => {
  const nativeEndpoint = 'https://coderax.example/api/agents/chat';

  it('routes native agent starts through Work and preserves path and query', () => {
    expect(
      toWorkChatServer(
        'https://coderax.example/api/agents/chat/agents?generationProtocolVersion=2',
        nativeEndpoint,
      ),
    ).toBe('https://coderax.example/api/work/chat/agents?generationProtocolVersion=2');
  });

  it('keeps the configured application base path', () => {
    expect(
      toWorkChatServer(
        '/coderax/api/agents/chat/agents',
        'https://coderax.example/coderax/api/agents/chat',
      ),
    ).toBe('https://coderax.example/coderax/api/work/chat/agents');
  });

  it('refuses endpoints outside the authenticated native agent route', () => {
    expect(() =>
      toWorkChatServer('https://coderax.example/api/assistants/v2/chat', nativeEndpoint),
    ).toThrow('Work starts through Coderax native agents');
  });

  it('refuses a generation URL on another origin', () => {
    expect(() =>
      toWorkChatServer('https://other.example/api/agents/chat/openAI', nativeEndpoint),
    ).toThrow('same-origin Coderax native agent endpoint');
  });

  it('routes the engine directly to the configured Work origin', () => {
    expect(toWorkEngineChatServer('https://work.example')).toBe(
      'https://work.example/api/work/chat',
    );
    expect(toWorkEngineChatServer()).toMatch(/\/api\/work\/chat$/);
  });

  it('routes a resumable engine attachment directly while preserving its path and query', () => {
    expect(
      toWorkEngineStreamUrl(
        'https://coderax.example/api/agents/chat/stream/generation-1?resume=true',
        'https://work.example',
      ),
    ).toBe('https://work.example/api/agents/chat/stream/generation-1?resume=true');
  });
});

describe('createWorkChatTransport', () => {
  const options: WorkOptions = {
    models: [{ id: 'local-free', label: 'Local free', provider: 'ollama' }],
    auto: {
      id: 'auto',
      label: 'Automatic',
      auto: true,
      target: { id: 'local-free', label: 'Local free', provider: 'ollama' },
    },
    agents: [
      { id: 'reviewer', name: 'Reviewer', model: 'local-free', provider: 'ollama', members: [] },
    ],
  };
  const chatRequest: ChatTransportRequest = {
    server: '/api/agents/chat/openAI',
    payload: {
      conversationId: 'same-conversation',
      endpoint: EModelEndpoint.openAI,
      model: 'paid-model',
      isContinued: false,
      isTemporary: false,
    },
  };

  it('uses the offered free automatic model without changing the existing conversation id', async () => {
    const start = jest.fn().mockResolvedValue({ generationId: 'work-generation' });
    const transport = createWorkChatTransport({ start } as never, options);
    await transport.start(chatRequest);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        server: expect.stringContaining('/api/work/chat/openAI'),
        payload: expect.objectContaining({
          conversationId: 'same-conversation',
          endpoint: 'ollama',
          endpointType: 'ollama',
          model: 'local-free',
          agent_id: undefined,
        }),
      }),
      undefined,
    );
    expect(chatRequest.payload.model).toBe('paid-model');
  });

  it('uses automatic local inference even when no saved agents are accessible', async () => {
    const start = jest.fn().mockResolvedValue({});
    const catalog = toWorkOptions([options.auto!, ...options.models], []);
    const transport = createWorkChatTransport({ start } as never, catalog);

    await transport.start(chatRequest);
    expect(start.mock.calls[0][0].payload).toMatchObject({
      conversationId: 'same-conversation',
      endpoint: 'ollama',
      model: 'local-free',
      agent_id: undefined,
    });
  });

  it('applies the selected agent and its concrete model only to the new Work request', async () => {
    const start = jest.fn().mockResolvedValue({});
    const transport = createWorkChatTransport({ start } as never, options, {
      agentId: 'reviewer',
      modelKey: 'auto',
    });
    await transport.start(chatRequest);
    expect(start.mock.calls[0][0].payload).toMatchObject({
      conversationId: 'same-conversation',
      endpoint: 'agents',
      model: 'local-free',
      agent_id: 'reviewer',
    });
  });

  it('routes the OpenCode engine without a provider endpoint or agent', async () => {
    const start = jest.fn().mockResolvedValue({});
    const transport = createWorkChatTransport(
      { start } as never,
      {
        ...options,
        models: [
          ...options.models,
          { id: 'opencode', label: 'OpenCode', provider: 'opencode', engine: 'opencode' },
        ],
      },
      { agentId: 'auto', modelKey: '["opencode","opencode"]' },
      'https://work.example',
    );
    await transport.start(chatRequest);
    const request = start.mock.calls[0][0];
    expect(request.server).toBe('https://work.example/api/work/chat');
    expect(request.payload.model).toBe('opencode');
    expect(request.payload.endpoint).toBeUndefined();
    expect(request.payload.endpointType).toBeUndefined();
    expect(request.payload.agent_id).toBeUndefined();
  });

  it('keeps a resumable engine attachment on the direct origin after an engine start', async () => {
    const reconnectToStream = jest.fn().mockReturnValue({ closed: false });
    const stream = jest.fn().mockReturnValue({ send: jest.fn(), reconnectToStream });
    const start = jest.fn().mockResolvedValue({});
    const transport = createWorkChatTransport(
      { start, stream } as never,
      {
        ...options,
        models: [
          ...options.models,
          { id: 'opencode', label: 'OpenCode', provider: 'opencode', engine: 'opencode' },
        ],
      },
      { agentId: 'auto', modelKey: '["opencode","opencode"]' },
      'https://work.example',
    );

    await transport.start(chatRequest);
    transport
      .stream({ token: 'token' })
      .reconnectToStream(
        { url: 'https://coderax.example/api/agents/chat/stream/generation-1?resume=true' },
        {} as never,
      );

    expect(reconnectToStream).toHaveBeenCalledWith(
      { url: 'https://work.example/api/agents/chat/stream/generation-1?resume=true' },
      {},
    );
  });

  it('routes an Assistants conversation to the native Work agent endpoint', async () => {
    const start = jest.fn().mockResolvedValue({});
    const transport = createWorkChatTransport({ start } as never, options);
    await transport.start({
      server: '/api/assistants/v2/chat/completions',
      payload: {
        ...chatRequest.payload,
        endpoint: EModelEndpoint.assistants,
      },
    });
    expect(start.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        server: expect.stringMatching(/\/api\/work\/chat$/),
        payload: expect.objectContaining({
          endpoint: 'ollama',
          model: 'local-free',
        }),
      }),
    );
  });

  it('fails closed before sending when no free model is offered', () => {
    const start = jest.fn();
    const transport = createWorkChatTransport({ start } as never, {
      models: [],
      agents: [],
      auto: null,
    });
    expect(() => transport.start(chatRequest)).toThrow('WORK_NO_FREE_MODEL');
    expect(start).not.toHaveBeenCalled();
  });

  it('routes the selected accessible agent through Work without replacing its request fields', async () => {
    const start = jest.fn().mockResolvedValue({ generationId: 'work-generation' });
    const transport = createWorkChatTransport({ start } as never);
    const payload = {
      endpoint: 'agents',
      agent_id: 'agent-work-1',
      model: 'llama3:latest',
      isContinued: false,
      isTemporary: false,
      conversationId: 'new',
    };
    const request = {
      server: '/api/agents/chat/agents',
      payload,
    } as never;

    await expect(transport.start(request)).resolves.toEqual({ generationId: 'work-generation' });
    expect(start).toHaveBeenCalledWith(
      {
        server: expect.stringMatching(/\/api\/work\/chat\/agents$/),
        payload,
      },
      undefined,
    );
  });
});
