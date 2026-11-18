import type { ExecutionEnginesConfig } from './service';
import type { OpenHandsTransport } from './openhands/adapter';
import { createExecutionEngines, describeExecutionEngines } from './service';

const config = (overrides: ExecutionEnginesConfig = {}): ExecutionEnginesConfig => ({
  engines: {
    defaultEngine: 'opencode',
    workspaces: {
      privateRoot: '/srv/coderax/private',
      cloudRoot: '/srv/coderax/cloud',
    },
    opencode: { enabled: false },
    openhands: { enabled: false },
    ...(overrides?.engines ?? {}),
  },
});

describe('config-driven execution engines', () => {
  it('keeps both engines disabled by default', () => {
    const snapshot = describeExecutionEngines(null);
    expect(snapshot.defaultEngine).toBe('opencode');
    expect(snapshot.engines).toEqual([
      expect.objectContaining({
        id: 'opencode',
        availability: expect.objectContaining({ available: false, reason: 'disabled' }),
      }),
      expect.objectContaining({
        id: 'openhands',
        availability: expect.objectContaining({ available: false, reason: 'disabled' }),
      }),
    ]);
  });

  it('reports a missing workspace before trying to load the SDK', () => {
    const loadSdk = jest.fn();
    const snapshot = describeExecutionEngines(
      {
        engines: {
          opencode: {
            enabled: true,
            baseURL: 'http://127.0.0.1:4096',
            model: 'ollama/qwen2.5-coder:7b',
          },
          workspaces: {},
        },
      },
      loadSdk,
    );
    expect(loadSdk).not.toHaveBeenCalled();
    expect(snapshot.engines[0]?.availability).toEqual(
      expect.objectContaining({ available: false, reason: 'sdk_unavailable' }),
    );
  });

  it('loads the official SDK only when OpenCode is enabled and configured', () => {
    const loadSdk = jest.fn(() => ({
      ok: true as const,
      value: {
        module: { createOpencodeClient: jest.fn() },
        transport: {
          createSession: jest.fn(),
          subscribe: jest.fn(),
          prompt: jest.fn(),
          abort: jest.fn(),
        },
      },
    }));

    const disabled = describeExecutionEngines(
      config({ engines: { opencode: { enabled: false, baseURL: 'http://127.0.0.1:4096' } } }),
      loadSdk,
    );
    expect(loadSdk).not.toHaveBeenCalled();
    expect(disabled.engines[0]?.availability).toEqual(
      expect.objectContaining({ available: false, reason: 'disabled' }),
    );

    const enabled = describeExecutionEngines(
      config({
        engines: {
          opencode: {
            enabled: true,
            baseURL: 'http://127.0.0.1:4096',
            model: 'ollama/qwen2.5-coder:7b',
          },
        },
      }),
      loadSdk,
    );
    expect(loadSdk).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'http://127.0.0.1:4096' }),
    );
    expect(enabled.engines[0]?.availability).toEqual({ available: true, reason: 'ready' });
  });

  it('uses an OpenHands transport supplied by the caller', () => {
    const transport: OpenHandsTransport = {
      start: jest.fn(),
      cancel: jest.fn(),
    };
    const registry = createExecutionEngines(
      config({
        engines: {
          openhands: { enabled: true, agentServerUrl: 'http://127.0.0.1:3000' },
        },
      }),
      undefined,
      transport,
    );
    expect(registry.snapshot().engines[1]?.availability).toEqual({
      available: true,
      reason: 'ready',
    });
  });

  it('does not expose workspace roots or endpoints in status', () => {
    const snapshot = describeExecutionEngines(config());
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('/srv/coderax');
    expect(serialized).not.toContain('127.0.0.1');
    expect(serialized).not.toMatch(/api[_-]?key|token|secret/i);
  });

  it('fails closed on the selected engine instead of using the other one', async () => {
    const registry = createExecutionEngines(
      config({
        engines: {
          defaultEngine: 'openhands',
          openhands: { enabled: true },
        },
      }),
    );
    const started = await registry.start({
      request: {
        taskKey: 't',
        conversationId: 't',
        prompt: 'fix it',
        mode: 'private',
        workspaceRoot: '/srv/coderax/private',
      },
    });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.code).toBe('not_configured');
    }
  });
});
