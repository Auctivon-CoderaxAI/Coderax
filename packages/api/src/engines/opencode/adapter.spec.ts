import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { EngineEvent, EngineRunRequest } from '../types';
import type { OpenCodeTransport } from './adapter';
import { createOpenCodeAdapter, startOpenCodeRun } from './adapter';

const limits = { timeoutMs: 2_000, maxSummaryChars: 200 };

function request(workspaceRoot: string): EngineRunRequest {
  return {
    taskKey: 'task-1',
    conversationId: 'conversation-1',
    prompt: 'Fix the failing test',
    mode: 'private',
    workspaceRoot,
  };
}

async function collect(events: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
}

describe('OpenCode adapter', () => {
  let base: string;
  let privateRoot: string;
  let cloudRoot: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'coderax-opencode-'));
    privateRoot = path.join(base, 'private');
    cloudRoot = path.join(base, 'cloud');
    await mkdir(privateRoot);
    await mkdir(cloudRoot);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('fails closed when disabled or missing its SDK', async () => {
    const disabled = await startOpenCodeRun(
      { enabled: false, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      request(privateRoot),
    );
    expect(disabled).toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'disabled' }) }),
    );

    const missing = await startOpenCodeRun(
      { enabled: true, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      request(privateRoot),
    );
    expect(missing).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'sdk_unavailable' }),
      }),
    );
  });

  it('streams text and tool evidence, then completes', async () => {
    const events = [
      {
        type: 'message.part.updated',
        properties: {
          sessionID: 's1',
          part: { id: 'p', sessionID: 's1', type: 'text', text: 'Editing the test' },
        },
      },
      {
        type: 'file.edited',
        properties: { file: 'sum.test.ts' },
      },
      {
        type: 'session.idle',
        properties: { sessionID: 's1' },
      },
    ];
    const transport: OpenCodeTransport = {
      createSession: async () => ({ id: 's1' }),
      subscribe: async () => ({
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
      }),
      prompt: async () => {},
      abort: async () => {},
    };

    const started = await startOpenCodeRun(
      { enabled: true, transport, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      request(privateRoot),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }

    const seen = await collect(started.value.events);
    expect(seen).toEqual([
      { type: 'started', sessionId: 's1' },
      { type: 'text_delta', text: 'Editing the test' },
      { type: 'file_edit', path: 'sum.test.ts' },
      { type: 'completed', sessionId: 's1' },
    ]);
    await expect(started.value.result).resolves.toEqual({
      ok: true,
      value: {
        sessionId: 's1',
        toolCalls: 0,
        edits: 1,
        summary: 'Editing the test',
      },
    });
  });

  it('retries a provider refusal on the next candidate without aborting the task', async () => {
    let sessions = 0;
    const prompt = jest.fn(async () => {});
    const abort = jest.fn(async () => {});
    const transport: OpenCodeTransport = {
      createSession: async () => ({ id: `s${(sessions += 1)}` }),
      subscribe: async ({ sessionId }) => {
        if (sessionId === 's1') {
          return (async function* () {
            yield {
              type: 'session.error',
              properties: { sessionID: 's1', error: { name: 'ProviderAuthError' } },
            };
          })();
        }
        return (async function* () {
          yield {
            type: 'message.part.updated',
            properties: {
              sessionID: 's2',
              part: { id: 'p', sessionID: 's2', type: 'text', text: 'second' },
            },
          };
          yield { type: 'session.idle', properties: { sessionID: 's2' } };
        })();
      },
      prompt,
      abort,
    };

    const started = await startOpenCodeRun(
      {
        enabled: true,
        transport,
        roots: { private: privateRoot, cloud: cloudRoot },
        limits,
        models: [
          { providerId: 'openrouter', modelId: 'a:free' },
          { providerId: 'openrouter', modelId: 'b:free' },
        ],
        firstEventTimeoutMs: 1_000,
      },
      request(privateRoot),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    expect(started.value.sessionId).toBe('s2');
    await expect(collect(started.value.events)).resolves.toEqual([
      { type: 'started', sessionId: 's2' },
      { type: 'text_delta', text: 'second' },
      { type: 'completed', sessionId: 's2' },
    ]);
    expect(prompt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: { providerId: 'openrouter', modelId: 'a:free' } }),
    );
    expect(prompt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: { providerId: 'openrouter', modelId: 'b:free' } }),
    );
    expect(abort).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }));
    await started.value.close();
  });

  it('treats a stream that ends without a terminal event as a failure', async () => {
    const transport: OpenCodeTransport = {
      createSession: async () => ({ id: 's1' }),
      subscribe: async () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'message.part.updated',
            properties: {
              sessionID: 's1',
              part: { id: 'p', sessionID: 's1', type: 'text', text: 'looks done' },
            },
          };
        },
      }),
      prompt: async () => {},
      abort: async () => {},
    };

    const started = await startOpenCodeRun(
      { enabled: true, transport, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      request(privateRoot),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    await expect(started.value.result).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'protocol_error' }),
      }),
    );
  });

  it('cancels the session exactly once and never reports success', async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const abort = jest.fn(async () => {
      release?.();
    });
    const transport: OpenCodeTransport = {
      createSession: async () => ({ id: 's1' }),
      subscribe: async () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'message.part.updated',
            properties: {
              sessionID: 's1',
              part: { id: 'p', sessionID: 's1', type: 'text', text: 'working' },
            },
          };
          await waiting;
        },
      }),
      prompt: async () => {},
      abort,
    };

    const started = await startOpenCodeRun(
      { enabled: true, transport, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      request(privateRoot),
    );
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const eventsPromise = collect(started.value.events);
    await started.value.cancel();
    await started.value.cancel();

    expect(abort).toHaveBeenCalledTimes(1);
    await expect(started.value.result).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'cancelled' }),
      }),
    );
    const seen = await eventsPromise;
    expect(seen[seen.length - 1]).toEqual({ type: 'cancelled', sessionId: 's1' });
    expect(seen.some((event) => event.type === 'completed')).toBe(false);
  });

  it('bounds session startup and never leaves a late session untracked', async () => {
    let resolveSession: ((value: { id: string }) => void) | undefined;
    const createSession = jest.fn(
      () => new Promise<{ id: string }>((resolve) => (resolveSession = resolve)),
    );
    const abort = jest.fn(async () => {});
    const transport: OpenCodeTransport = {
      createSession,
      subscribe: jest.fn(),
      prompt: jest.fn(),
      abort,
    };

    const started = await startOpenCodeRun(
      { enabled: true, transport, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      { ...request(privateRoot), timeoutMs: 25 },
    );
    expect(started).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'timeout' }),
      }),
    );

    if (started.ok) {
      throw new Error('expected session startup to time out');
    }
    expect(started.cleanup).toBeDefined();
    resolveSession?.({ id: 'late-session' });
    await started.cleanup;
    expect(abort).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'late-session' }));
  });

  it('does not send a prompt after the caller cancels startup', async () => {
    const controller = new AbortController();
    const prompt = jest.fn();
    const abort = jest.fn(async () => {});
    const transport: OpenCodeTransport = {
      createSession: async () => ({ id: 's1' }),
      subscribe: async () => {
        controller.abort();
        return { async *[Symbol.asyncIterator]() {} };
      },
      prompt,
      abort,
    };

    const started = await startOpenCodeRun(
      { enabled: true, transport, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      { ...request(privateRoot), signal: controller.signal },
    );
    expect(started).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'cancelled' }),
      }),
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }));
  });

  it('stops the remote session when prompt submission fails', async () => {
    const abort = jest.fn(async () => {});
    const transport: OpenCodeTransport = {
      createSession: async () => ({ id: 's1' }),
      subscribe: async () => ({ async *[Symbol.asyncIterator]() {} }),
      prompt: async () => {
        throw new Error('rejected');
      },
      abort,
    };

    const started = await startOpenCodeRun(
      { enabled: true, transport, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      request(privateRoot),
    );
    expect(started).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'server_unavailable' }),
      }),
    );
    expect(abort).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }));
  });

  it('refuses to start a cloud run in the private workspace', async () => {
    const transport: OpenCodeTransport = {
      createSession: jest.fn(),
      subscribe: jest.fn(),
      prompt: jest.fn(),
      abort: jest.fn(),
    };
    const started = await startOpenCodeRun(
      { enabled: true, transport, roots: { private: privateRoot, cloud: cloudRoot }, limits },
      { ...request(privateRoot), mode: 'cloud' },
    );
    expect(started).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'workspace_denied' }),
      }),
    );
    expect(transport.createSession).not.toHaveBeenCalled();
  });

  it('exposes availability without leaking a path or key', () => {
    const adapter = createOpenCodeAdapter({
      enabled: false,
      roots: { private: privateRoot, cloud: cloudRoot },
      limits,
    });
    expect(adapter.describe()).toEqual(
      expect.objectContaining({ available: false, reason: 'disabled' }),
    );
    expect(JSON.stringify(adapter.describe())).not.toContain(base);
  });
});
