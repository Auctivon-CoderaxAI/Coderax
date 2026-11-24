import { createEngineWorkChatPersistence } from './persistence';

function fakeDb() {
  return {
    getConvo: jest.fn(async (..._args: unknown[]): Promise<unknown> => null),
    saveConvo: jest.fn(async (..._args: unknown[]): Promise<unknown> => ({})),
    saveMessage: jest.fn(async (..._args: unknown[]): Promise<unknown> => ({})),
    getMessages: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  };
}

const storeFor = (
  db: ReturnType<typeof fakeDb>,
  overrides: { tenantId?: string | null; isTemporary?: boolean } = {},
) =>
  createEngineWorkChatPersistence({
    db,
    userId: 'owner',
    tenantId: overrides.tenantId ?? null,
    isTemporary: overrides.isTemporary,
    interfaceConfig: {},
  });

describe('Work chat persistence adapter', () => {
  it('normalizes a conversation row and keeps a documented absence as null', async () => {
    const db = fakeDb();
    const store = storeFor(db);

    db.getConvo.mockResolvedValueOnce({
      conversationId: 'conversation-1',
      title: 'Fix the build',
      tenantId: 'tenant-1',
      isWork: true,
      ignored: 'not part of the contract',
    });
    await expect(store.getConversation('conversation-1')).resolves.toEqual({
      conversationId: 'conversation-1',
      title: 'Fix the build',
      tenantId: 'tenant-1',
      isWork: true,
    });

    db.getConvo.mockResolvedValueOnce(null);
    await expect(store.getConversation('conversation-2')).resolves.toBeNull();

    db.getConvo.mockResolvedValueOnce([]);
    await expect(store.getConversation('conversation-3')).resolves.toBeNull();
  });

  it('falls back to the requested id and drops fields of the wrong type', async () => {
    const db = fakeDb();
    const store = storeFor(db);

    db.getConvo.mockResolvedValueOnce({
      conversationId: '',
      title: '   ',
      tenantId: 7,
      isWork: 'yes',
    });
    await expect(store.getConversation('conversation-4')).resolves.toEqual({
      conversationId: 'conversation-4',
    });

    db.getConvo.mockResolvedValueOnce({ tenantId: null });
    await expect(store.getConversation('conversation-5')).resolves.toEqual({
      conversationId: 'conversation-5',
      tenantId: null,
    });
  });

  it('passes the request scope through and omits tenant when creating without one', async () => {
    const db = fakeDb();
    const store = createEngineWorkChatPersistence({
      db,
      userId: 'owner',
      tenantId: null,
      isTemporary: true,
      interfaceConfig: { interface: { customWelcome: 'hi' } },
    });

    await store.getConversation('conversation-1');
    expect(db.getConvo).toHaveBeenCalledWith('owner', 'conversation-1');

    await store.saveConversation({ conversationId: 'conversation-1', title: 'Fix', create: true });
    expect(db.saveConvo).toHaveBeenCalledWith(
      {
        userId: 'owner',
        isTemporary: true,
        interfaceConfig: { interface: { customWelcome: 'hi' } },
      },
      {
        conversationId: 'conversation-1',
        isWork: true,
        workModel: 'opencode',
        workAgent: 'opencode',
        title: 'Fix',
      },
      { context: 'Work OpenCode Agent chat conversation' },
    );

    await store.loadTranscript('conversation-1');
    expect(db.getMessages).toHaveBeenCalledWith(
      { user: 'owner', conversationId: 'conversation-1' },
      'messageId text isCreatedByUser createdAt',
      { sort: { createdAt: -1 }, limit: 24 },
    );
  });

  it('creates a Work conversation with its tenant and no upsert suppression', async () => {
    const db = fakeDb();
    const store = storeFor(db, { tenantId: 'tenant-1' });

    await store.saveConversation({
      conversationId: 'conversation-1',
      title: 'Fix the build',
      workState: 'running',
      create: true,
    });

    expect(db.saveConvo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner' }),
      {
        conversationId: 'conversation-1',
        isWork: true,
        workModel: 'opencode',
        workAgent: 'opencode',
        title: 'Fix the build',
        workState: 'running',
        tenantId: 'tenant-1',
      },
      { context: 'Work OpenCode Agent chat conversation' },
    );
  });

  it('labels Freebuff conversations and messages with the Freebuff engine', async () => {
    const db = fakeDb();
    const store = createEngineWorkChatPersistence({
      db,
      userId: 'owner',
      tenantId: null,
      interfaceConfig: {},
      engine: 'freebuff',
    });

    await store.saveConversation({ conversationId: 'conversation-1', workState: 'completed' });
    expect(db.saveConvo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner' }),
      expect.objectContaining({ workModel: 'freebuff', workState: 'completed' }),
      { context: 'Work FreeBuff Agent chat conversation', noUpsert: true },
    );

    await store.saveMessage({
      messageId: 'message-1',
      parentMessageId: 'message-0',
      conversationId: 'conversation-1',
      text: 'Done',
      isCreatedByUser: false,
    });
    expect(db.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner' }),
      expect.objectContaining({
        sender: 'FreeBuff Agent',
        model: 'freebuff',
        endpoint: 'freebuff',
      }),
      { context: 'Work FreeBuff Agent response' },
    );
  });

  it('updates without a tenant or upsert', async () => {
    const db = fakeDb();
    const store = storeFor(db, { tenantId: 'tenant-1' });

    await store.saveConversation({ conversationId: 'conversation-1', workState: 'completed' });

    expect(db.saveConvo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner' }),
      {
        conversationId: 'conversation-1',
        isWork: true,
        workModel: 'opencode',
        workAgent: 'opencode',
        workState: 'completed',
      },
      {
        context: 'Work OpenCode Agent chat conversation',
        noUpsert: true,
      },
    );
    const fields = db.saveConvo.mock.calls[0][1] as Record<string, unknown>;
    expect(fields).not.toHaveProperty('tenantId');
  });

  it('refuses to report a conversation the database did not save', async () => {
    const db = fakeDb();
    const store = storeFor(db);
    db.saveConvo.mockResolvedValueOnce(null);

    await expect(store.saveConversation({ conversationId: 'conversation-1' })).rejects.toThrow(
      'Work conversation could not be saved',
    );
  });

  it('marks the sender, model and endpoint on each saved message', async () => {
    const db = fakeDb();
    const store = storeFor(db);

    await store.saveMessage({
      messageId: 'message-1',
      parentMessageId: 'message-0',
      conversationId: 'conversation-1',
      text: 'Fix the build',
      isCreatedByUser: true,
    });
    expect(db.saveMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ userId: 'owner' }),
      {
        messageId: 'message-1',
        parentMessageId: 'message-0',
        conversationId: 'conversation-1',
        text: 'Fix the build',
        sender: 'User',
        isCreatedByUser: true,
        model: 'opencode',
        endpoint: 'opencode',
      },
      { context: 'Work OpenCode Agent user message' },
    );

    await store.saveMessage({
      messageId: 'message-2',
      parentMessageId: 'message-1',
      conversationId: 'conversation-1',
      text: 'partial',
      isCreatedByUser: false,
      unfinished: true,
      error: 'The run was cancelled.',
    });
    expect(db.saveMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ userId: 'owner' }),
      {
        messageId: 'message-2',
        parentMessageId: 'message-1',
        conversationId: 'conversation-1',
        text: 'partial',
        sender: 'OpenCode Agent',
        isCreatedByUser: false,
        model: 'opencode',
        endpoint: 'opencode',
        unfinished: true,
        error: 'The run was cancelled.',
      },
      { context: 'Work OpenCode Agent response' },
    );
  });

  it('stores the parts a reply streamed, and omits them when it streamed none', async () => {
    const db = fakeDb();
    const store = storeFor(db);
    const content = [
      { type: 'text', text: 'Listed it.' },
      {
        type: 'tool_call',
        tool_call: {
          id: 'call-1',
          name: 'bash',
          type: 'tool_call',
          progress: 1,
          args: { command: 'ls' },
          runStepStatus: 'completed',
          output: 'a.txt',
        },
      },
    ];

    await store.saveMessage({
      messageId: 'message-2',
      parentMessageId: 'message-1',
      conversationId: 'conversation-1',
      text: 'Listed it.',
      content,
      isCreatedByUser: false,
    });

    expect(db.saveMessage.mock.calls[0][1]).toMatchObject({
      messageId: 'message-2',
      text: 'Listed it.',
      content,
      sender: 'OpenCode Agent',
    });

    /* A turn that streamed no parts keeps the row it always wrote. */
    await store.saveMessage({
      messageId: 'message-3',
      parentMessageId: 'message-2',
      conversationId: 'conversation-1',
      text: 'Plain answer',
      isCreatedByUser: false,
    });
    expect(db.saveMessage.mock.calls[1][1]).not.toHaveProperty('content');
  });

  it('refuses to report a message the database did not save', async () => {
    const db = fakeDb();
    const store = storeFor(db);
    db.saveMessage.mockResolvedValueOnce(null);

    await expect(
      store.saveMessage({
        messageId: 'message-1',
        parentMessageId: 'message-0',
        conversationId: 'conversation-1',
        text: 'Fix the build',
        isCreatedByUser: true,
      }),
    ).rejects.toThrow('Work message could not be saved');
  });

  it('drops rows that are not messages and text that is blank', async () => {
    const db = fakeDb();
    const store = storeFor(db);
    db.getMessages.mockResolvedValueOnce([
      { text: 'newest', isCreatedByUser: false },
      { text: '   ', isCreatedByUser: true },
      { text: 42, isCreatedByUser: true },
      'not a row',
      null,
      { text: 'oldest', isCreatedByUser: true },
    ]);

    await expect(store.loadTranscript('conversation-1')).resolves.toEqual([
      { text: 'oldest', isCreatedByUser: true },
      { text: 'newest', isCreatedByUser: false },
    ]);
  });
});
