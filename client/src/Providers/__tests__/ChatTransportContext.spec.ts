import { createWorkChatTransport } from '../ChatTransportContext';
import { toWorkChatServer } from '../workTransport';

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
});

describe('createWorkChatTransport', () => {
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
