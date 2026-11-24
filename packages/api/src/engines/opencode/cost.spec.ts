import type { ExecutionEnginesConfig } from '../service';
import { describeExecutionEngines } from '../service';

const loadSdk = () =>
  ({
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
  }) as never;

function config(overrides: {
  mode?: 'private' | 'cloud';
  model?: string;
  privateRoot?: string;
  cloudRoot?: string;
}): ExecutionEnginesConfig {
  return {
    engines: {
      workspaces: {
        privateRoot: overrides.privateRoot ?? '/srv/coderax/private',
        cloudRoot: overrides.cloudRoot ?? '/srv/coderax/cloud',
      },
      opencode: {
        enabled: true,
        baseURL: 'http://127.0.0.1:4096',
        ...(overrides.model ? { model: overrides.model } : {}),
      },
      workChat: { enabled: true, mode: overrides.mode ?? 'private' },
    },
  };
}

function availability(overrides: Parameters<typeof config>[0]) {
  return describeExecutionEngines(config(overrides), loadSdk).engines[0]?.availability;
}

describe('engine zero-cost admission', () => {
  it('refuses to enable OpenCode without an explicit model', () => {
    const status = availability({});
    expect(status).toMatchObject({ available: false });
    expect(status && 'detail' in status ? status.detail : '').toContain('engines.opencode.model');
  });

  it('refuses a hosted free model in private mode', () => {
    const status = availability({ model: 'opencode/deepseek-v4.1-flash-free' });
    expect(status).toMatchObject({ available: false });
    expect(status && 'detail' in status ? status.detail : '').toContain('local model');
  });

  it('admits a local model in private mode', () => {
    expect(availability({ model: 'ollama/qwen2.5-coder:7b' })).toEqual({
      available: true,
      reason: 'ready',
    });
  });

  it('admits an allowlisted free model in cloud mode', () => {
    expect(availability({ mode: 'cloud', model: 'opencode/deepseek-v4.1-flash-free' })).toEqual({
      available: true,
      reason: 'ready',
    });
    expect(availability({ mode: 'cloud', model: 'opencode/claude-sonnet-4.5' })).toMatchObject({
      available: false,
    });
  });

  it('requires the root for the selected mode, not always the private root', () => {
    const status = availability({
      mode: 'cloud',
      model: 'opencode/big-pickle',
      privateRoot: '',
    });
    expect(status).toEqual({ available: true, reason: 'ready' });
    const missingCloud = availability({
      mode: 'cloud',
      model: 'opencode/big-pickle',
      cloudRoot: '',
    });
    expect(missingCloud).toMatchObject({ available: false });
    expect(missingCloud && 'detail' in missingCloud ? missingCloud.detail : '').toContain(
      'cloudRoot',
    );
  });
});
