import { saveTurnConversation, seedTurnConversation } from './save';
import type { TurnConversationWrite } from './save';

type Write = Record<string, unknown>;

/** Records exactly what the store was asked to persist. */
function makeStore() {
  const fields: Write[] = [];
  return {
    fields,
    getConvo: async () => null,
    saveConvo: async (_ctx: unknown, payload: Write) => {
      fields.push(payload);
      return { conversationId: payload.conversationId as string };
    },
  };
}

const baseWrite = (overrides: Partial<TurnConversationWrite> = {}): TurnConversationWrite => ({
  conversationId: 'convo-1',
  endpoint: 'agents',
  endpointType: 'custom',
  endpointOptions: { model: 'llama3:latest' },
  context: 'test',
  ctx: { userId: 'user-1', isTemporary: false } as never,
  ...overrides,
});

/** Fresh per test: a turn write mutates `req.resolvedConversation`. */
const workReq = () => ({
  user: { id: 'user-1' },
  workContext: { isWork: true, workModel: 'llama3:latest' },
});

describe('Work marker persistence', () => {
  it('stamps the server-resolved marker on a turn save', async () => {
    const store = makeStore();
    await saveTurnConversation(store as never, baseWrite({ req: workReq() as never }));

    expect(store.fields).toHaveLength(1);
    expect(store.fields[0].isWork).toBe(true);
    expect(store.fields[0].workModel).toBe('llama3:latest');
  });

  it('stamps the marker when the turn seeds its conversation', async () => {
    const store = makeStore();
    await seedTurnConversation(store as never, baseWrite({ req: workReq() as never }));

    expect(store.fields).toHaveLength(1);
    expect(store.fields[0].isWork).toBe(true);
    expect(store.fields[0].workModel).toBe('llama3:latest');
  });

  it('writes no Work fields on an ordinary chat turn', async () => {
    const store = makeStore();
    await saveTurnConversation(
      store as never,
      baseWrite({ req: { user: { id: 'user-1' } } as never }),
    );

    expect(store.fields[0]).not.toHaveProperty('isWork');
    expect(store.fields[0]).not.toHaveProperty('workModel');
  });

  it('writes nothing when the context is present but not a Work turn', async () => {
    const store = makeStore();
    await saveTurnConversation(
      store as never,
      baseWrite({ req: { user: { id: 'user-1' }, workContext: { isWork: false } } as never }),
    );

    expect(store.fields[0]).not.toHaveProperty('isWork');
    expect(store.fields[0]).not.toHaveProperty('workModel');
  });

  it('never persists the auto sentinel as a model', async () => {
    const store = makeStore();
    await saveTurnConversation(
      store as never,
      baseWrite({ req: { user: { id: 'user-1' }, workContext: { isWork: true } } as never }),
    );

    expect(store.fields[0]).not.toHaveProperty('isWork');
    expect(store.fields[0].workModel).toBeUndefined();
  });

  it('does not let endpointOptions overwrite the marker', async () => {
    const store = makeStore();
    await saveTurnConversation(
      store as never,
      baseWrite({
        req: workReq() as never,
        endpointOptions: { model: 'other-model', isWork: false, workModel: 'gpt-4o' } as never,
      }),
    );

    expect(store.fields[0].isWork).toBe(true);
    expect(store.fields[0].workModel).toBe('llama3:latest');
  });
});
