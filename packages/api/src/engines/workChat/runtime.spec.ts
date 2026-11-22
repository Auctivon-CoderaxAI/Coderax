import type { EngineRegistryApi } from '../registry';
import type { EngineRunHandle } from '../types';
import { EngineWorkChatRuntime } from './runtime';

const roots = { private: '/srv/coderax/private', cloud: '/srv/coderax/cloud' };

function handle(sessionId: string): EngineRunHandle {
  return {
    sessionId,
    events: (async function* () {})(),
    cancel: jest.fn(async () => undefined),
    result: Promise.resolve({ ok: true as const, value: { sessionId, toolCalls: 0, edits: 0 } }),
    close: jest.fn(async () => undefined),
  };
}

function fakeRegistry(start: jest.Mock) {
  return {
    start,
    select: jest.fn(),
    snapshot: () => ({ defaultEngine: 'opencode' as const, engines: [] }),
    arbiter: {},
  } as unknown as EngineRegistryApi;
}

const scope = (
  conversationId: string,
  overrides: { userId?: string; tenantId?: string | null } = {},
) => ({
  userId: overrides.userId ?? 'owner',
  tenantId: overrides.tenantId === undefined ? 'tenant-1' : overrides.tenantId,
  conversationId,
});

describe('EngineWorkChatRuntime', () => {
  it('maps a private run onto the canonical engine request', async () => {
    const run = handle('session-private');
    const start = jest.fn(async () => ({ ok: true as const, value: run }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots);

    await expect(runtime.start({ ...scope('conversation-a'), prompt: 'Fix it' })).resolves.toEqual({
      ok: true,
      value: run,
    });
    expect(start).toHaveBeenCalledWith({
      engine: 'opencode',
      request: {
        taskKey: 'conversation-a',
        conversationId: 'conversation-a',
        prompt: 'Fix it',
        mode: 'private',
        workspaceRoot: '/srv/coderax/private',
      },
    });
    expect(runtime.state(scope('conversation-a'))).toBe('running');

    runtime.release(scope('conversation-a'));
  });

  it('sends cloud runs to the cloud root with the configured model', async () => {
    const start = jest.fn(async () => ({ ok: true as const, value: handle('session-cloud') }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots, 'cloud', {
      providerId: 'ollama',
      modelId: 'qwen3.5:4b',
    });

    await runtime.start({ ...scope('conversation-b'), prompt: 'Fix it' });
    expect(start).toHaveBeenCalledWith({
      engine: 'opencode',
      request: {
        taskKey: 'conversation-b',
        conversationId: 'conversation-b',
        prompt: 'Fix it',
        mode: 'cloud',
        workspaceRoot: '/srv/coderax/cloud',
        model: { providerId: 'ollama', modelId: 'qwen3.5:4b' },
      },
    });

    runtime.release(scope('conversation-b'));
  });

  it('refuses a second live run for the same tenant, user and conversation', async () => {
    const start = jest.fn(async () => ({ ok: true as const, value: handle('session-busy') }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots);
    const conversation = 'conversation-c';

    await runtime.start({ ...scope(conversation), prompt: 'First' });
    const second = await runtime.start({ ...scope(conversation), prompt: 'Second' });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('busy');
    expect(start).toHaveBeenCalledTimes(1);

    runtime.release(scope(conversation));
    await expect(runtime.start({ ...scope(conversation), prompt: 'Third' })).resolves.toMatchObject(
      {
        ok: true,
      },
    );
    runtime.release(scope(conversation));
  });

  it('keeps tenants, users and conversations in separate leases', async () => {
    const start = jest.fn(async () => ({ ok: true as const, value: handle('session-key') }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots);

    await runtime.start({ ...scope('conversation-d'), prompt: 'Owner' });
    await runtime.start({ ...scope('conversation-d', { tenantId: 'tenant-2' }), prompt: 'Other' });
    await runtime.start({ ...scope('conversation-d', { userId: 'other' }), prompt: 'Other' });
    await runtime.start({ ...scope('conversation-e'), prompt: 'Other' });
    expect(start).toHaveBeenCalledTimes(4);

    runtime.release(scope('conversation-d'));
    runtime.release(scope('conversation-d', { tenantId: 'tenant-2' }));
    runtime.release(scope('conversation-d', { userId: 'other' }));
    runtime.release(scope('conversation-e'));
  });

  it('does not hold a lease when the registry refuses to start', async () => {
    const start = jest.fn(async () => ({
      ok: false as const,
      error: { code: 'disabled' as const, message: 'The engine is disabled.' },
    }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots);
    const conversation = 'conversation-f';

    const refused = await runtime.start({ ...scope(conversation), prompt: 'Fix it' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'disabled' } });
    expect(runtime.state(scope(conversation))).toBeNull();

    await runtime.start({ ...scope(conversation), prompt: 'Retry' });
    expect(start).toHaveBeenCalledTimes(2);
    runtime.release(scope(conversation));
  });

  it('releases only the handle that owns the lease', async () => {
    const run = handle('session-owned');
    const start = jest.fn(async () => ({ ok: true as const, value: run }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots);
    const conversation = 'conversation-g';
    await runtime.start({ ...scope(conversation), prompt: 'Fix it' });

    expect(runtime.release({ ...scope(conversation), handle: handle('session-other') })).toBe(
      false,
    );
    expect(runtime.state(scope(conversation))).toBe('running');
    expect(runtime.release({ ...scope(conversation), handle: run })).toBe(true);
    expect(runtime.state(scope(conversation))).toBeNull();
  });

  it('reports the registry snapshot', () => {
    const runtime = new EngineWorkChatRuntime(fakeRegistry(jest.fn()), roots);
    expect(runtime.snapshot()).toEqual({ defaultEngine: 'opencode', engines: [] });
  });
});
