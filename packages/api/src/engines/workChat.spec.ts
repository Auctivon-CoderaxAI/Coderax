import express from 'express';
import request from 'supertest';
import type { EngineRegistryApi } from './registry';
import type { EngineEvent, EngineResult, EngineRunHandle } from './types';
import type { EngineWorkChatConfig, EngineWorkChatRunner, EngineWorkChatStore } from './workChat';
import {
  EngineWorkChatRuntime,
  buildEnginePrompt,
  createEngineWorkChatHandler,
  isOwnerEngineWorkChat,
} from './workChat';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const USER_MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

const enabledConfig = (overrides: Partial<EngineWorkChatConfig['engines']> = {}) =>
  ({
    engines: {
      workChat: { enabled: true, engine: 'opencode' as const },
      opencode: { enabled: true },
      workspaces: { privateRoot: '/srv/coderax/private' },
      ...overrides,
    },
  }) as EngineWorkChatConfig;

function fakeStore(overrides: Partial<EngineWorkChatStore> = {}) {
  const conversations = new Map<
    string,
    { conversationId: string; title?: string; tenantId?: string | null; isWork?: boolean }
  >();
  const messages: Array<Record<string, unknown>> = [];
  const store: EngineWorkChatStore = {
    getConversation: async (conversationId) => conversations.get(conversationId) ?? null,
    saveConversation: async (input) => {
      const previous = conversations.get(input.conversationId);
      conversations.set(input.conversationId, {
        ...previous,
        conversationId: input.conversationId,
        ...(input.title ? { title: input.title } : {}),
        ...(input.workState ? { workState: input.workState } : {}),
        isWork: true,
      } as never);
    },
    saveMessage: async (message) => {
      messages.push(message as unknown as Record<string, unknown>);
    },
    loadTranscript: async () => [],
    ...overrides,
  };
  return { store, conversations, messages };
}

function fakeRunner(
  events: EngineEvent[] = [
    { type: 'text_delta', text: 'hello' },
    { type: 'completed', sessionId: 'session-1' },
  ],
  result: EngineResult<{
    sessionId: string;
    toolCalls: number;
    edits: number;
    summary?: string;
  }> = { ok: true, value: { sessionId: 'session-1', toolCalls: 0, edits: 0, summary: 'hello' } },
) {
  const cancel = jest.fn(async () => undefined);
  const handle: EngineRunHandle = {
    sessionId: 'session-1',
    events: (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
    cancel,
    result: Promise.resolve(result),
    close: jest.fn(async () => undefined),
  };
  const start = jest.fn(async () => ({ ok: true as const, value: handle }));
  const runner: EngineWorkChatRunner = {
    start,
    state: jest.fn(() => null),
    cancel: jest.fn(async () => false),
    snapshot: () => ({ defaultEngine: 'opencode', engines: [] }),
  };
  return { runner, start, cancel };
}

function app(options: {
  config?: EngineWorkChatConfig;
  user?: { id: string; role: string; tenantId?: string | null } | null;
  runner?: EngineWorkChatRunner;
  store?: EngineWorkChatStore;
}) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    const typed = req as typeof req & {
      user?: typeof options.user;
      config?: { config?: EngineWorkChatConfig; interfaceConfig?: unknown };
    };
    if (options.user !== null) {
      typed.user = options.user ?? { id: 'owner', role: 'ADMIN', tenantId: 'tenant-1' };
    }
    typed.config = { config: options.config ?? enabledConfig(), interfaceConfig: {} };
    next();
  });
  server.use(
    '/api/work',
    createEngineWorkChatHandler({
      runtimeFor: () => options.runner ?? fakeRunner().runner,
      storeFor: () => options.store ?? fakeStore().store,
    }),
  );
  server.use('/api/work', (_req, res) => {
    res.status(418).json({ code: 'NATIVE' });
  });
  return server;
}

describe('owner-gated OpenCode Work ingress', () => {
  it('keeps the native path when the flag is off', async () => {
    const { runner } = fakeRunner();
    const res = await request(
      app({ config: enabledConfig({ workChat: { enabled: false } }), runner }),
    )
      .post('/api/work/chat')
      .send({ text: 'Fix it', conversationId: 'new' });
    expect(res.status).toBe(418);
    expect(res.body.code).toBe('NATIVE');
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('keeps the native path for a non-owner even when the flag is on', async () => {
    const { runner } = fakeRunner();
    const res = await request(
      app({
        user: { id: 'member', role: 'USER', tenantId: 'tenant-1' },
        runner,
      }),
    )
      .post('/api/work/chat')
      .send({ text: 'Fix it', conversationId: 'new' });
    expect(res.status).toBe(418);
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('runs as the owner, streams SSE, and persists the Work turn', async () => {
    const { store, conversations, messages } = fakeStore();
    const { runner, start } = fakeRunner();
    const res = await request(app({ store, runner })).post('/api/work/chat').send({
      text: 'Fix the bug',
      conversationId: 'new',
      messageId: USER_MESSAGE_ID,
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('"created":true');
    expect(res.text).toContain('"text":"hello"');
    expect(res.text).toContain('"final":true');
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner',
        prompt: 'Fix the bug',
      }),
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Fix the bug', isCreatedByUser: true }),
        expect.objectContaining({ text: 'hello', isCreatedByUser: false }),
      ]),
    );
    expect(Array.from(conversations.values())).toEqual(
      expect.arrayContaining([expect.objectContaining({ workState: 'completed', isWork: true })]),
    );
  });

  it('adds the prior Work transcript to a follow-up without unbounded growth', () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      text: `message-${index}`,
      isCreatedByUser: index % 2 === 0,
    }));
    const prompt = buildEnginePrompt(history, 'continue');
    expect(prompt).toContain('Earlier in this Work conversation:');
    expect(prompt).toContain('Current request:\ncontinue');
    expect(prompt).not.toContain('message-0');
    expect(prompt).toContain('message-19');
  });

  it('keeps agent-selected turns on the native runner', async () => {
    const { runner } = fakeRunner();
    const res = await request(app({ runner }))
      .post('/api/work/chat')
      .send({ text: 'Fix it', conversationId: 'new', agent_id: 'saved-agent' });
    expect(res.status).toBe(418);
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('fails closed when OpenCode is configured into Work but not enabled', async () => {
    const { runner } = fakeRunner();
    const res = await request(
      app({ config: enabledConfig({ opencode: { enabled: false } }), runner }),
    )
      .post('/api/work/chat')
      .send({ text: 'Fix it', conversationId: 'new' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WORK_ENGINE_DISABLED');
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('rejects a second live run without saving a duplicate turn', async () => {
    const { store, messages } = fakeStore();
    const { runner } = fakeRunner();
    (runner.state as jest.Mock).mockReturnValue('running');
    const res = await request(app({ store, runner }))
      .post('/api/work/chat')
      .send({ text: 'Fix it', conversationId: CONVERSATION_ID });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WORK_ENGINE_BUSY');
    expect(messages).toHaveLength(0);
  });

  it('cancels and fails closed when the engine asks for an unsupported approval', async () => {
    const { store, conversations } = fakeStore();
    const { runner, cancel } = fakeRunner(
      [{ type: 'approval_required', callId: 'call-1', tool: 'bash' }],
      {
        ok: false,
        error: { code: 'cancelled', message: 'The run was cancelled.', retryable: false },
      },
    );
    const res = await request(app({ store, runner }))
      .post('/api/work/chat')
      .send({ text: 'Fix it', conversationId: 'new' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('cannot approve');
    expect(cancel).toHaveBeenCalled();
    expect(Array.from(conversations.values())).toEqual(
      expect.arrayContaining([expect.objectContaining({ workState: 'failed' })]),
    );
  });

  it('persists failed state when the engine event stream throws', async () => {
    const { store, conversations } = fakeStore();
    const { runner } = fakeRunner();
    (runner.start as jest.Mock).mockResolvedValueOnce({
      ok: true as const,
      value: {
        sessionId: 'session-1',
        events: (async function* () {
          yield { type: 'text_delta' as const, text: 'partial' };
          throw new Error('socket reset');
        })(),
        cancel: jest.fn(async () => undefined),
        result: Promise.resolve({
          ok: true as const,
          value: { sessionId: 'session-1', toolCalls: 0, edits: 0 },
        }),
        close: jest.fn(async () => undefined),
      },
    });
    const res = await request(app({ store, runner }))
      .post('/api/work/chat')
      .send({ text: 'Fix it', conversationId: 'new' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('The engine event stream failed.');
    expect(Array.from(conversations.values())).toEqual(
      expect.arrayContaining([expect.objectContaining({ workState: 'failed' })]),
    );
  });

  it('rejects attachments instead of silently dropping them', async () => {
    const { runner } = fakeRunner();
    const res = await request(app({ runner }))
      .post('/api/work/chat')
      .send({ text: 'Fix it', conversationId: 'new', files: [{ id: 'file-1' }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WORK_ENGINE_ATTACHMENTS_UNSUPPORTED');
  });

  it('only treats the exact owner flag as an engine request', () => {
    expect(
      isOwnerEngineWorkChat({
        config: enabledConfig(),
        user: { role: 'ADMIN' },
        body: {},
      }),
    ).toBe(true);
    expect(
      isOwnerEngineWorkChat({
        config: enabledConfig(),
        user: { role: 'USER' },
        body: {},
      }),
    ).toBe(false);
  });
});

describe('EngineWorkChatRuntime', () => {
  it('holds one run per conversation and cancels only its owner', async () => {
    const cancel = jest.fn(async () => undefined);
    const registry = {
      start: jest.fn(async () => ({
        ok: true as const,
        value: {
          sessionId: 'session-1',
          events: (async function* () {})(),
          cancel,
          result: new Promise<never>(() => undefined),
          close: jest.fn(async () => undefined),
        },
      })),
      select: jest.fn(),
      snapshot: () => ({ defaultEngine: 'opencode' as const, engines: [] }),
      arbiter: {} as EngineRegistryApi['arbiter'],
    } as unknown as EngineRegistryApi;
    const runtime = new EngineWorkChatRuntime(registry, '/srv/coderax/private');
    const first = await runtime.start({
      userId: 'owner',
      tenantId: 'tenant-1',
      conversationId: CONVERSATION_ID,
      prompt: 'Fix it',
    });
    expect(first.ok).toBe(true);
    expect(
      runtime.state({ userId: 'owner', tenantId: 'tenant-1', conversationId: CONVERSATION_ID }),
    ).toBe('running');
    expect(
      runtime.state({ userId: 'other', tenantId: 'tenant-1', conversationId: CONVERSATION_ID }),
    ).toBeNull();
    expect(
      await runtime.cancel({
        userId: 'other',
        tenantId: 'tenant-1',
        conversationId: CONVERSATION_ID,
      }),
    ).toBe(false);
    expect(
      await runtime.cancel({
        userId: 'owner',
        tenantId: 'tenant-1',
        conversationId: CONVERSATION_ID,
      }),
    ).toBe(true);
    expect(cancel).toHaveBeenCalled();
  });
});
