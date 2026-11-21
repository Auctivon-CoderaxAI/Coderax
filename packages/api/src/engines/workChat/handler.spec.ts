import type { Request, Response } from 'express';
import type { EngineWorkChatConfig, EngineWorkChatRunner, EngineWorkChatStore } from './types';
import type { EngineEvent, EngineResult, EngineRunHandle, EngineRunSummary } from '../types';
import { createEngineWorkChatHandler } from './handler';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const USER_MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

type StoredConversation = Awaited<ReturnType<EngineWorkChatStore['getConversation']>>;
type StartResult = Awaited<ReturnType<EngineWorkChatRunner['start']>>;
type StartScope = Parameters<EngineWorkChatRunner['start']>[0];
type RunScope = Parameters<EngineWorkChatRunner['state']>[0];
type ReleaseScope = Parameters<NonNullable<EngineWorkChatRunner['release']>>[0];

const enabledConfig = (
  overrides: Partial<EngineWorkChatConfig['engines']> = {},
): EngineWorkChatConfig =>
  ({
    engines: {
      workChat: { enabled: true, engine: 'opencode' },
      opencode: { enabled: true },
      ...overrides,
    },
  }) as EngineWorkChatConfig;

function fakeStore() {
  const getConversation = jest.fn(
    async (_conversationId: string): Promise<StoredConversation> => null,
  );
  const saveConversation = jest.fn(
    async (_input: Parameters<EngineWorkChatStore['saveConversation']>[0]): Promise<void> =>
      undefined,
  );
  const saveMessage = jest.fn(
    async (_input: Parameters<EngineWorkChatStore['saveMessage']>[0]): Promise<void> => undefined,
  );
  const loadTranscript = jest.fn(
    async (
      _conversationId: string,
    ): Promise<Array<{ text: string; isCreatedByUser: boolean }>> => [],
  );
  return {
    store: {
      getConversation,
      saveConversation,
      saveMessage,
      loadTranscript,
    } satisfies EngineWorkChatStore,
    getConversation,
    saveConversation,
    saveMessage,
    loadTranscript,
  };
}

function fakeHandle(
  events: EngineEvent[],
  result: EngineResult<EngineRunSummary> = {
    ok: true,
    value: { sessionId: 'session-1', toolCalls: 0, edits: 0 },
  },
): EngineRunHandle {
  return {
    sessionId: 'session-1',
    events: (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
    cancel: jest.fn(async () => undefined),
    result: Promise.resolve(result),
    close: jest.fn(async () => undefined),
  };
}

function fakeRunner(events: EngineEvent[] = [{ type: 'text_delta', text: 'hello' }]) {
  const handle = fakeHandle(events);
  const start = jest.fn(
    async (_input: StartScope): Promise<StartResult> => ({ ok: true, value: handle }),
  );
  const state = jest.fn((_input: RunScope): string | null => null);
  const release = jest.fn((_input: ReleaseScope): boolean => true);
  const runner: EngineWorkChatRunner = {
    start,
    state,
    cancel: jest.fn(async () => false),
    release,
    snapshot: () => ({ defaultEngine: 'opencode', engines: [] }),
  };
  return { runner, start, state, release, handle };
}

type FakeResponse = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  chunks: string[];
  writableEnded: boolean;
  destroyed: boolean;
  ended: boolean;
  listeners: Record<string, Array<() => void>>;
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  flushHeaders: jest.Mock;
  write: jest.Mock;
  end: jest.Mock;
  on: jest.Mock;
};

function fakeResponse(): FakeResponse {
  const response = {
    statusCode: 200,
    body: undefined,
    headers: {},
    chunks: [],
    writableEnded: false,
    destroyed: false,
    ended: false,
    listeners: {},
  } as unknown as FakeResponse;
  response.status = jest.fn((code: number) => {
    response.statusCode = code;
    return response;
  });
  response.json = jest.fn((body: unknown) => {
    response.body = body;
    response.ended = true;
    response.writableEnded = true;
    return response;
  });
  response.setHeader = jest.fn((name: string, value: string) => {
    response.headers[name] = value;
    return response;
  });
  response.flushHeaders = jest.fn();
  response.write = jest.fn((chunk: string) => {
    response.chunks.push(chunk);
    return true;
  });
  response.end = jest.fn(() => {
    response.ended = true;
    response.writableEnded = true;
    return response;
  });
  response.on = jest.fn((event: string, listener: () => void) => {
    (response.listeners[event] ??= []).push(listener);
    return response;
  });
  return response;
}

function sseEvents(response: FakeResponse): Array<Record<string, unknown>> {
  return response.chunks
    .join('')
    .split('\n\n')
    .filter(Boolean)
    .map(
      (block) =>
        JSON.parse(block.replace(/^event: message\ndata: /, '')) as Record<string, unknown>,
    );
}

type FakeRequestOptions = {
  method?: string;
  path?: string;
  body?: unknown;
  user?: { id?: string; role?: unknown; tenantId?: string | null } | null;
  config?: EngineWorkChatConfig | null;
};

function fakeRequest(options: FakeRequestOptions = {}): Request {
  return {
    method: options.method ?? 'POST',
    path: options.path ?? '/chat',
    body: options.body === undefined ? { text: 'Fix it', conversationId: 'new' } : options.body,
    user:
      options.user === undefined
        ? { id: 'owner', role: 'ADMIN', tenantId: 'tenant-1' }
        : options.user,
    config: { config: options.config === undefined ? enabledConfig() : options.config },
  } as unknown as Request;
}

async function runHandler(
  options: {
    body?: unknown;
    user?: FakeRequestOptions['user'];
    config?: EngineWorkChatConfig | null;
    store?: EngineWorkChatStore;
    runner?: EngineWorkChatRunner;
    reserveRun?: (input: RunScope) => boolean;
    releaseRun?: (input: RunScope) => boolean;
    response?: FakeResponse;
  } = {},
) {
  const response = options.response ?? fakeResponse();
  const next = jest.fn();
  const handler = createEngineWorkChatHandler({
    storeFor: () => options.store ?? fakeStore().store,
    runtimeFor: () => options.runner ?? fakeRunner().runner,
    reserveRun: options.reserveRun,
    releaseRun: options.releaseRun,
  });
  await handler(
    fakeRequest({ body: options.body, user: options.user, config: options.config }),
    response as unknown as Response,
    next,
  );
  return { response, next };
}

describe('createEngineWorkChatHandler', () => {
  it.each([
    { method: 'GET', path: '/chat' },
    { method: 'POST', path: '/chats' },
  ])('passes $method $path to the native handler', async ({ method, path }) => {
    const storeFor = jest.fn(() => fakeStore().store);
    const runtimeFor = jest.fn(() => fakeRunner().runner);
    const response = fakeResponse();
    const next = jest.fn();

    await createEngineWorkChatHandler({ storeFor, runtimeFor })(
      fakeRequest({ method, path }),
      response as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(storeFor).not.toHaveBeenCalled();
    expect(runtimeFor).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('passes a non-owner turn to the native handler', async () => {
    const { runner, start } = fakeRunner();
    const response = fakeResponse();
    const next = jest.fn();

    await createEngineWorkChatHandler({
      storeFor: () => fakeStore().store,
      runtimeFor: () => runner,
    })(
      fakeRequest({ user: { id: 'member', role: 'USER', tenantId: 'tenant-1' } }),
      response as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses added-conversation requests before starting', async () => {
    const { runner, start } = fakeRunner();
    const { response } = await runHandler({
      runner,
      body: { text: 'Fix it', conversationId: 'new', addedConvo: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: 'WORK_ENGINE_ADDED_CONVERSATION_UNSUPPORTED' });
    expect(start).not.toHaveBeenCalled();
  });

  it.each(['isRegenerate', 'compact', 'isEdited'] as const)(
    'refuses a %s turn before starting',
    async (field) => {
      const { runner, start } = fakeRunner();
      const { response } = await runHandler({
        runner,
        body: { text: 'Fix it', conversationId: 'new', [field]: true },
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toMatchObject({ code: 'WORK_ENGINE_TURN_UNSUPPORTED' });
      expect(start).not.toHaveBeenCalled();
    },
  );

  it.each([{ text: '' }, { text: '   ' }, {}])('requires a non-blank task', async (body) => {
    const { runner, start } = fakeRunner();
    const { response } = await runHandler({
      runner,
      body: { ...body, conversationId: 'new' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: 'WORK_ENGINE_TASK_REQUIRED' });
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses an owner without a user id', async () => {
    const { runner, start } = fakeRunner();
    const { response } = await runHandler({
      runner,
      user: { role: 'ADMIN', tenantId: 'tenant-1' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toMatchObject({ code: 'WORK_UNAUTHENTICATED' });
    expect(start).not.toHaveBeenCalled();
  });

  it('refuses a fabricated conversation id', async () => {
    const { runner, start } = fakeRunner();
    const { response } = await runHandler({
      runner,
      body: { text: 'Fix it', conversationId: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ code: 'WORK_ENGINE_CONVERSATION_INVALID' });
    expect(start).not.toHaveBeenCalled();
  });

  it('returns 503 when the conversation store cannot be opened', async () => {
    const runtimeFor = jest.fn(() => fakeRunner().runner);
    const response = fakeResponse();

    await createEngineWorkChatHandler({
      storeFor: () => {
        throw new Error('no database');
      },
      runtimeFor,
    })(fakeRequest(), response as unknown as Response, jest.fn());

    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({ code: 'WORK_ENGINE_STORE_UNAVAILABLE' });
    expect(runtimeFor).not.toHaveBeenCalled();
  });

  it('returns 503 when the engine runtime cannot be constructed', async () => {
    const response = fakeResponse();

    await createEngineWorkChatHandler({
      storeFor: () => fakeStore().store,
      runtimeFor: () => {
        throw new Error('no engine');
      },
    })(fakeRequest(), response as unknown as Response, jest.fn());

    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({ code: 'WORK_ENGINE_UNAVAILABLE' });
  });

  it('refuses a task whose shared reservation is already held', async () => {
    const { runner, start } = fakeRunner();
    const releaseRun = jest.fn(() => true);
    const { response } = await runHandler({
      runner,
      reserveRun: () => false,
      releaseRun,
      body: { text: 'Fix it', conversationId: CONVERSATION_ID },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ code: 'WORK_ENGINE_BUSY' });
    expect(start).not.toHaveBeenCalled();
    expect(releaseRun).not.toHaveBeenCalled();
  });

  it('refuses an active runtime and releases the reservation', async () => {
    const { runner, start, state } = fakeRunner();
    state.mockReturnValueOnce('running');
    const releaseRun = jest.fn(() => true);
    const { response } = await runHandler({
      runner,
      reserveRun: () => true,
      releaseRun,
      body: { text: 'Fix it', conversationId: CONVERSATION_ID },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ code: 'WORK_ENGINE_BUSY' });
    expect(start).not.toHaveBeenCalled();
    expect(releaseRun).toHaveBeenCalledWith({
      userId: 'owner',
      tenantId: 'tenant-1',
      conversationId: CONVERSATION_ID,
    });
  });

  it('keeps a conversation owned by another tenant invisible', async () => {
    const { store, getConversation } = fakeStore();
    getConversation.mockResolvedValueOnce({
      conversationId: CONVERSATION_ID,
      tenantId: 'tenant-2',
    });
    const { runner, start } = fakeRunner();
    const { response } = await runHandler({
      store,
      runner,
      body: { text: 'Fix it', conversationId: CONVERSATION_ID },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ code: 'WORK_TASK_NOT_FOUND' });
    expect(start).not.toHaveBeenCalled();
  });

  it('does not overwrite the active run when start reports busy', async () => {
    const { runner, start } = fakeRunner();
    start.mockResolvedValueOnce({
      ok: false,
      error: { code: 'busy', message: 'Another engine run is already active for this task.' },
    });
    const { store } = fakeStore();
    const { response } = await runHandler({
      runner,
      store,
      body: { text: 'Fix it', conversationId: 'new' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ code: 'WORK_ENGINE_START_FAILED', error: 'busy' });
    expect(store.saveConversation).not.toHaveBeenCalled();
  });

  it('records a failed state for a non-busy start failure', async () => {
    const { runner, start } = fakeRunner();
    start.mockResolvedValueOnce({
      ok: false,
      error: { code: 'timeout', message: 'The run timed out.' },
    });
    const { store } = fakeStore();
    const { response } = await runHandler({
      runner,
      store,
      body: { text: 'Fix it', conversationId: CONVERSATION_ID },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({
      code: 'WORK_ENGINE_START_FAILED',
      error: 'timeout',
      message: 'The OpenCode run timed out.',
    });
    expect(store.saveConversation).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      workState: 'failed',
    });
  });

  it('streams a completed turn, persists both messages, and releases its leases', async () => {
    const { store, getConversation, loadTranscript, saveMessage, saveConversation } = fakeStore();
    getConversation.mockResolvedValueOnce({
      conversationId: CONVERSATION_ID,
      title: 'Existing task',
      tenantId: 'tenant-1',
    });
    loadTranscript.mockResolvedValueOnce([{ text: 'earlier', isCreatedByUser: true }]);
    const { runner, start, release, handle } = fakeRunner([
      { type: 'text_delta', text: 'hello' },
      { type: 'text_replace', text: 'hello world' },
    ]);
    const reserveRun = jest.fn(() => true);
    const releaseRun = jest.fn(() => true);
    const { response } = await runHandler({
      store,
      runner,
      reserveRun,
      releaseRun,
      body: {
        text: 'Fix it',
        conversationId: CONVERSATION_ID,
        messageId: USER_MESSAGE_ID,
        parentMessageId: 'parent-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/event-stream');
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner',
        tenantId: 'tenant-1',
        conversationId: CONVERSATION_ID,
        prompt: expect.stringContaining('Earlier in this Work conversation:'),
      }),
    );
    const events = sseEvents(response);
    expect(events[0]).toMatchObject({
      created: true,
      streamId: CONVERSATION_ID,
      message: { messageId: USER_MESSAGE_ID, parentMessageId: 'parent-1' },
    });
    expect(events.find((event) => event.final === true)).toMatchObject({
      terminalStatus: 'complete',
      responseMessage: {
        messageId: `${USER_MESSAGE_ID}_`,
        text: 'hello world',
        unfinished: false,
      },
      conversation: { conversationId: CONVERSATION_ID, title: 'Existing task' },
    });
    expect(saveMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        messageId: USER_MESSAGE_ID,
        parentMessageId: 'parent-1',
        text: 'Fix it',
        isCreatedByUser: true,
      }),
    );
    expect(saveMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messageId: `${USER_MESSAGE_ID}_`,
        text: 'hello world',
        isCreatedByUser: false,
        unfinished: false,
      }),
    );
    expect(saveConversation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        title: 'Existing task',
        workState: 'running',
        create: false,
      }),
    );
    expect(saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        workState: 'completed',
        appendMessageIds: [`${USER_MESSAGE_ID}_`],
      }),
    );
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONVERSATION_ID, handle }),
    );
    expect(releaseRun).toHaveBeenCalledWith({
      userId: 'owner',
      tenantId: 'tenant-1',
      conversationId: CONVERSATION_ID,
    });
    expect(response.ended).toBe(true);
  });

  it('generates a message id and defaults a missing parent to 0', async () => {
    const { store, saveMessage } = fakeStore();
    const { runner } = fakeRunner([]);

    await runHandler({
      store,
      runner,
      body: { text: 'Fix it', conversationId: 'new' },
    });

    const saved = saveMessage.mock.calls[0][0] as {
      messageId: string;
      parentMessageId: string;
    };
    expect(saved.messageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(saved.parentMessageId).toBe('0');
  });

  it('cancels the run and records failure when the user message cannot be saved', async () => {
    const { store, saveMessage, saveConversation } = fakeStore();
    saveMessage.mockRejectedValueOnce(new Error('database offline'));
    const { runner, handle } = fakeRunner([]);
    const { response } = await runHandler({
      store,
      runner,
      body: { text: 'Fix it', conversationId: CONVERSATION_ID },
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({ code: 'WORK_ENGINE_STORE_UNAVAILABLE' });
    expect(handle.cancel).toHaveBeenCalled();
    expect(saveConversation).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      workState: 'failed',
    });
  });

  it('cancels a run when the client disconnects before startup finishes', async () => {
    const { store } = fakeStore();
    const handle = fakeHandle([]);
    let resolveStart: ((result: StartResult) => void) | undefined;
    let signalStart: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStart = resolve;
    });
    const start = jest.fn(
      () =>
        new Promise<StartResult>((resolve) => {
          resolveStart = resolve;
          signalStart?.();
        }),
    );
    const runner: EngineWorkChatRunner = {
      start,
      state: jest.fn(() => null),
      cancel: jest.fn(async () => false),
      snapshot: () => ({ defaultEngine: 'opencode', engines: [] }),
    };
    const response = fakeResponse();
    const pending = createEngineWorkChatHandler({
      storeFor: () => store,
      runtimeFor: () => runner,
    })(
      fakeRequest({ body: { text: 'Fix it', conversationId: CONVERSATION_ID } }),
      response as unknown as Response,
      jest.fn(),
    );

    await started;
    response.listeners.close?.forEach((listener) => listener());
    resolveStart!({ ok: true, value: handle });
    await pending;

    expect(handle.cancel).toHaveBeenCalled();
    expect(store.saveConversation).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      workState: 'cancelled',
    });
    expect(response.status).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
  });
});
