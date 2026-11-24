import os from 'node:os';
import path from 'node:path';
import { mkdtemp, realpath, rm, symlink, rmdir } from 'node:fs/promises';
import type { EngineRegistryApi } from '../registry';
import type { EngineRunHandle } from '../types';
import { EngineWorkChatRuntime } from './runtime';

let cloudRoot = '';
const roots = {
  private: '/srv/coderax/private',
  get cloud() {
    return cloudRoot;
  },
};

beforeAll(async () => {
  cloudRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'coderax-runtime-')));
});

afterAll(async () => {
  await rm(cloudRoot, { recursive: true, force: true });
});

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
    probe: jest.fn(async () => undefined),
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
  engine: 'opencode' as const,
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
        taskKey: JSON.stringify(['tenant-1', 'owner', 'conversation-b']),
        conversationId: 'conversation-b',
        prompt: 'Fix it',
        mode: 'cloud',
        workspaceRoot: expect.stringMatching(/work-opencode-[a-f0-9]{64}$/),
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

  it('isolates cloud workspaces by tenant, user, conversation and engine', async () => {
    const start = jest.fn<
      ReturnType<EngineRegistryApi['start']>,
      Parameters<EngineRegistryApi['start']>
    >(async () => ({ ok: true, value: handle('session-key') }));
    const runtime = new EngineWorkChatRuntime(fakeRegistry(start), roots, 'cloud');
    const scopes = [
      scope('conversation-d'),
      scope('conversation-d', { tenantId: 'tenant-2' }),
      scope('conversation-d', { userId: 'other' }),
      scope('conversation-e'),
      { ...scope('conversation-d'), engine: 'freebuff' as const },
    ];

    for (const runScope of scopes) {
      await expect(runtime.start({ ...runScope, prompt: 'Run' })).resolves.toMatchObject({
        ok: true,
      });
      runtime.release(runScope);
    }
    const workspaces = start.mock.calls.map(([input]) => input.request.workspaceRoot);
    expect(new Set(workspaces).size).toBe(scopes.length);
    expect(workspaces.map((workspace) => path.dirname(workspace))).toEqual(
      scopes.map(() => cloudRoot),
    );

    await runtime.start({ ...scopes[0], prompt: 'Continue' });
    expect(start.mock.lastCall?.[0].request.workspaceRoot).toBe(workspaces[0]);
    runtime.release(scopes[0]);

    await rmdir(workspaces[0]);
    await symlink(workspaces[1], workspaces[0], 'dir');
    start.mockClear();
    await expect(runtime.start({ ...scopes[0], prompt: 'Continue' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'workspace_denied' },
    });
    expect(start).not.toHaveBeenCalled();
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

  it('waits for readiness before taking the registry snapshot', async () => {
    const registry = fakeRegistry(jest.fn());
    const snapshot = jest.spyOn(registry, 'snapshot');
    let finishProbe!: () => void;
    jest.spyOn(registry, 'probe').mockReturnValue(
      new Promise((resolve) => {
        finishProbe = resolve;
      }),
    );
    const runtime = new EngineWorkChatRuntime(registry, roots);
    const refreshed = runtime.refreshSnapshot();
    expect(snapshot).not.toHaveBeenCalled();
    finishProbe();
    await expect(refreshed).resolves.toEqual({ defaultEngine: 'opencode', engines: [] });
  });
});
