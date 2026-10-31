import { toWorkChatServer, withWorkModel } from '../workTransport';

describe('toWorkChatServer', () => {
  const nativeEndpoint = 'https://coderax.example/api/agents/chat';

  it('routes native model starts through Work and preserves path and query', () => {
    expect(
      toWorkChatServer(
        'https://coderax.example/api/agents/chat/openAI?generationProtocolVersion=2',
        nativeEndpoint,
      ),
    ).toBe('https://coderax.example/api/work/chat/openAI?generationProtocolVersion=2');
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

describe('withWorkModel', () => {
  it('sends the selected Work model through the native admission gate', () => {
    const payload = {
      isContinued: false,
      isTemporary: false,
      model: 'paid-default',
      conversationId: 'new',
    };
    expect(withWorkModel(payload, 'ollama/llama3')).toEqual({
      ...payload,
      model: 'ollama/llama3',
    });
    expect(withWorkModel(payload)).toBe(payload);
  });
});
