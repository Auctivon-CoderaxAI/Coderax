import { createEngineRegistry } from './registry';
import type { EngineAdapter, EngineRunHandle, EngineRunRequest } from './types';
import { engineFailure } from './types';

function handleFor(task: string): EngineRunHandle {
  return {
    sessionId: task,
    events: (async function* () {
      yield { type: 'completed' as const, sessionId: task };
    })(),
    cancel: async () => {},
    close: async () => {},
    result: Promise.resolve({
      ok: true as const,
      value: { sessionId: task, toolCalls: 0, edits: 0 },
    }),
  };
}

function adapter(
  id: 'opencode' | 'openhands',
  start: EngineAdapter['start'],
  available = true,
): EngineAdapter {
  return {
    id,
    capabilities: {
      streaming: true,
      tools: true,
      cancellation: true,
      modelSelection: true,
    },
    describe: () =>
      available
        ? { available: true, reason: 'ready' }
        : {
            available: false,
            reason: 'disabled',
            detail: `${id} is disabled.`,
          },
    start,
  };
}

const request: EngineRunRequest = {
  taskKey: 'conversation-1',
  conversationId: 'conversation-1',
  prompt: 'Fix the failing test',
  mode: 'private',
  workspaceRoot: '/tmp/workspace',
};

describe('engine registry', () => {
  it('runs the default engine exactly once and releases the task', async () => {
    const openCodeStart = jest.fn(async () => ({ ok: true as const, value: handleFor('a') }));
    const registry = createEngineRegistry({
      defaultEngine: 'opencode',
      adapters: {
        opencode: adapter('opencode', openCodeStart),
        openhands: adapter('openhands', jest.fn()),
      },
    });

    const started = await registry.start({ request });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    await expect(started.value.result).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(openCodeStart).toHaveBeenCalledTimes(1);
    expect(registry.arbiter.owner('conversation-1')).toBeNull();
  });

  it('never starts a second engine for a task that is already running', async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const openHandsStart = jest.fn(async () => ({
      ok: true as const,
      value: {
        ...handleFor('b'),
        result: pending.then(() => ({
          ok: true as const,
          value: { sessionId: 'b', toolCalls: 0, edits: 0 },
        })),
      },
    }));
    const registry = createEngineRegistry({
      defaultEngine: 'opencode',
      adapters: {
        opencode: adapter('opencode', async () => ({
          ok: true,
          value: {
            ...handleFor('a'),
            // A real run stays pending until its stream settles.
            result: new Promise<never>(() => {}),
          },
        })),
        openhands: adapter('openhands', openHandsStart),
      },
    });

    const first = await registry.start({ request });
    const second = await registry.start({ engine: 'openhands', request });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('busy');
    }
    expect(openHandsStart).not.toHaveBeenCalled();
    if (first.ok) {
      await first.value.close();
    }
    finish?.();
  });

  it('holds the task lease until cancellation cleanup finishes', async () => {
    let releaseCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const registry = createEngineRegistry({
      defaultEngine: 'opencode',
      adapters: {
        opencode: adapter('opencode', async () => ({
          ok: true as const,
          value: {
            ...handleFor('a'),
            cleanup,
            result: new Promise<never>(() => {}),
          },
        })),
      },
    });

    const first = await registry.start({ request });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const cancelPromise = first.value.cancel();
    await Promise.resolve();

    const second = await registry.start({ request });
    expect(second).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'busy' }),
      }),
    );

    releaseCleanup?.();
    await cancelPromise;
    expect(registry.arbiter.owner('conversation-1')).toBeNull();
  });

  it('holds the task lease while failed-start cleanup is pending', async () => {
    let finishCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const registry = createEngineRegistry({
      defaultEngine: 'opencode',
      adapters: {
        opencode: adapter('opencode', async () => ({
          ...engineFailure('timeout'),
          cleanup,
        })),
      },
    });

    const first = await registry.start({ request });
    expect(first.ok).toBe(false);
    expect(registry.arbiter.owner('conversation-1')).toBe('opencode');

    const second = await registry.start({ request });
    expect(second).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'busy' }),
      }),
    );

    finishCleanup?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.arbiter.owner('conversation-1')).toBeNull();
  });

  it('does not release ownership when failed-start cleanup rejects', async () => {
    let rejectCleanup: ((error: Error) => void) | undefined;
    const cleanup = new Promise<void>((_resolve, reject) => {
      rejectCleanup = reject;
    });
    const registry = createEngineRegistry({
      defaultEngine: 'opencode',
      adapters: {
        opencode: adapter('opencode', async () => ({
          ...engineFailure('timeout'),
          cleanup,
        })),
      },
    });

    const started = await registry.start({ request });
    expect(started.ok).toBe(false);

    rejectCleanup?.(new Error('cancel failed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.arbiter.owner('conversation-1')).toBe('opencode');
  });

  it('fails closed instead of falling back when the selected engine is unavailable', async () => {
    const openCodeStart = jest.fn();
    const registry = createEngineRegistry({
      defaultEngine: 'opencode',
      adapters: {
        opencode: adapter('opencode', openCodeStart, false),
        openhands: adapter('openhands', jest.fn()),
      },
    });

    const started = await registry.start({ engine: 'opencode', request });
    expect(started).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'disabled' }),
      }),
    );
    expect(openCodeStart).not.toHaveBeenCalled();
  });

  it('releases the lease when the adapter fails to start', async () => {
    const registry = createEngineRegistry({
      defaultEngine: 'opencode',
      adapters: {
        opencode: adapter('opencode', async () => engineFailure('server_unavailable')),
      },
    });

    const started = await registry.start({ request });
    expect(started.ok).toBe(false);
    expect(registry.arbiter.owner('conversation-1')).toBeNull();
  });

  it('reports engine status without secrets', () => {
    const registry = createEngineRegistry({
      defaultEngine: 'opencode',
      adapters: {
        opencode: adapter('opencode', jest.fn(), false),
      },
    });

    const snapshot = registry.snapshot();
    expect(snapshot.defaultEngine).toBe('opencode');
    expect(snapshot.engines).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/api[_-]?key|token|secret/i);
  });
});
