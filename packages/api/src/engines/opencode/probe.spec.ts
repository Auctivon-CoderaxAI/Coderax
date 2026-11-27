import type { OpenCodeProbeResponse, OpenCodeTransport } from './adapter';
import { createOpenCodeAdapter, probeOpenCode, type OpenCodeProbeFetch } from './adapter';
import { openCodeAuthHeader } from './auth';

const roots = { private: '/tmp/coderax-private', cloud: '/tmp/coderax-cloud' };
const limits = { timeoutMs: 2_000, maxSummaryChars: 200 };

const transport = (): OpenCodeTransport => ({
  createSession: jest.fn(),
  subscribe: jest.fn(),
  prompt: jest.fn(),
  abort: jest.fn(),
});

const request = () => ({
  taskKey: 'task-1',
  conversationId: 'conversation-1',
  prompt: 'Fix it',
  mode: 'private' as const,
  workspaceRoot: roots.private,
});

describe('OpenCode server authentication and readiness', () => {
  it('builds a Basic header without echoing the password', () => {
    const header = openCodeAuthHeader({ password: 's3cret' });
    expect(header).toEqual({
      Authorization: `Basic ${Buffer.from('opencode:s3cret', 'utf8').toString('base64')}`,
    });
    expect(header?.Authorization).not.toContain('s3cret');
    expect(openCodeAuthHeader({})).toBeUndefined();
    expect(openCodeAuthHeader({ username: 'operator', password: 'p' })).toEqual({
      Authorization: `Basic ${Buffer.from('operator:p', 'utf8').toString('base64')}`,
    });
  });

  it('probes the official health route with the configured credential', async () => {
    const fetchImpl: jest.MockedFunction<OpenCodeProbeFetch> = jest.fn(
      async (_input: string, _init: Parameters<OpenCodeProbeFetch>[1]) => ({
        ok: true,
        status: 200,
        json: async () => ({ healthy: true, version: '1.19.6' }),
      }),
    );

    const availability = await probeOpenCode({
      enabled: true,
      transport: transport(),
      roots,
      limits,
      baseURL: 'http://127.0.0.1:4096',
      password: 's3cret',
      fetchImpl,
    });

    expect(availability).toEqual({ available: true, reason: 'ready' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4096/global/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('opencode:s3cret', 'utf8').toString('base64')}`,
        }),
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('s3cret');
  });

  it('rejects a server that answers 401 instead of claiming readiness', async () => {
    const fetchImpl: OpenCodeProbeFetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));

    const availability = await probeOpenCode({
      enabled: true,
      transport: transport(),
      roots,
      limits,
      baseURL: 'http://127.0.0.1:4096',
      password: 'wrong',
      fetchImpl,
    });

    expect(availability).toEqual(
      expect.objectContaining({
        available: false,
        reason: 'server_unavailable',
        detail: expect.stringContaining('credentials'),
      }),
    );
    expect(JSON.stringify(availability)).not.toContain('wrong');
  });

  it('requires an explicit healthy:true response', async () => {
    const fetchImpl: OpenCodeProbeFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: '1.19.6' }),
    }));

    await expect(
      probeOpenCode({
        enabled: true,
        transport: transport(),
        roots,
        limits,
        baseURL: 'http://127.0.0.1:4096',
        fetchImpl,
      }),
    ).resolves.toEqual(expect.objectContaining({ available: false, reason: 'server_unavailable' }));
  });

  it('bounds an unreachable server and never starts a session', async () => {
    const createSession = jest.fn();
    const fetchImpl: OpenCodeProbeFetch = (_url, init) =>
      new Promise<OpenCodeProbeResponse>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    const adapter = createOpenCodeAdapter({
      enabled: true,
      transport: { ...transport(), createSession },
      roots,
      limits,
      baseURL: 'http://127.0.0.1:4096',
      probeTimeoutMs: 10,
      fetchImpl,
    });

    expect(adapter.describe()).toEqual(
      expect.objectContaining({
        available: false,
        reason: 'server_unavailable',
        detail: expect.stringContaining('not been verified'),
      }),
    );
    await adapter.probe?.();
    expect(adapter.describe()).toEqual(
      expect.objectContaining({
        available: false,
        reason: 'server_unavailable',
        detail: expect.stringContaining('10 ms'),
      }),
    );

    const started = await adapter.start(request());
    expect(started).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'server_unavailable' }),
      }),
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it('describes start admission without a network probe', () => {
    const adapter = createOpenCodeAdapter({
      enabled: true,
      transport: transport(),
      roots,
      limits,
      baseURL: 'http://127.0.0.1:4096',
    });
    expect(adapter.describeForStart?.()).toEqual({ available: true, reason: 'ready' });
  });
});
