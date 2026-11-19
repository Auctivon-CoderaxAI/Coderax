import type { EngineRegistryApi } from './registry';
import { EngineWorkChatRuntime } from './workChat';

function runtime() {
  const handle = {
    sessionId: 'ses_1',
    events: (async function* () {})(),
    cancel: jest.fn(async () => undefined),
    result: new Promise<never>(() => undefined),
    close: jest.fn(async () => undefined),
  };
  const registry = {
    start: jest.fn(async () => ({ ok: true as const, value: handle })),
    select: jest.fn(),
    snapshot: () => ({ defaultEngine: 'opencode' as const, engines: [] }),
    arbiter: {} as EngineRegistryApi['arbiter'],
  } as unknown as EngineRegistryApi;
  return { registry, handle };
}

describe('EngineWorkChatRuntime model and mode', () => {
  it('runs a cloud conversation in the cloud root with the pinned free model', async () => {
    const { registry } = runtime();
    const engine = new EngineWorkChatRuntime(
      registry,
      { private: '/private', cloud: '/cloud' },
      'cloud',
      { providerId: 'opencode', modelId: 'deepseek-v4.1-flash-free' },
    );
    const started = await engine.start({
      userId: 'owner',
      tenantId: null,
      conversationId: 'conversation-cloud',
      prompt: 'fix it',
    });
    expect(started.ok).toBe(true);
    expect(registry.start).toHaveBeenCalledWith({
      engine: 'opencode',
      request: expect.objectContaining({
        mode: 'cloud',
        workspaceRoot: '/cloud',
        model: { providerId: 'opencode', modelId: 'deepseek-v4.1-flash-free' },
      }),
    });
  });

  it('keeps a private conversation in the private root', async () => {
    const { registry } = runtime();
    const engine = new EngineWorkChatRuntime(
      registry,
      { private: '/private', cloud: '/cloud' },
      'private',
      { providerId: 'ollama', modelId: 'qwen2.5-coder:7b' },
    );
    await engine.start({
      userId: 'owner',
      tenantId: null,
      conversationId: 'conversation-private',
      prompt: 'fix it',
    });
    expect(registry.start).toHaveBeenCalledWith({
      engine: 'opencode',
      request: expect.objectContaining({
        mode: 'private',
        workspaceRoot: '/private',
        model: { providerId: 'ollama', modelId: 'qwen2.5-coder:7b' },
      }),
    });
  });
});
