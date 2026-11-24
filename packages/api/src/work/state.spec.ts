import { persistTerminalWorkState, readEngineWorkState, workStateForJobStatus } from './state';

describe('native Work lifecycle persistence', () => {
  it('maps native generation states to typed Work lifecycle states', () => {
    expect(workStateForJobStatus('running')).toBe('running');
    expect(workStateForJobStatus('requires_action')).toBe('awaiting_approval');
    expect(workStateForJobStatus('complete')).toBe('completed');
    expect(workStateForJobStatus('error')).toBe('failed');
    expect(workStateForJobStatus('aborted')).toBe('cancelled');
    expect(workStateForJobStatus('unrecognized')).toBeNull();
  });

  it('persists terminal state only for an existing owner-scoped Work conversation', async () => {
    const store = {
      getConvo: jest.fn(async () => ({ isWork: true })),
      saveConvo: jest.fn(async () => undefined),
    };
    const persisted = await persistTerminalWorkState(
      { userId: 'user-a', conversationId: 'task-a', status: 'complete' },
      store,
    );

    expect(persisted).toBe(true);
    expect(store.getConvo).toHaveBeenCalledWith('user-a', 'task-a');
    expect(store.saveConvo).toHaveBeenCalledWith(
      { userId: 'user-a' },
      { conversationId: 'task-a', workState: 'completed' },
      { context: 'Work terminal generation state', noUpsert: true },
    );
  });

  it('does not mark ordinary, deleted, non-terminal, or unowned conversations as Work', async () => {
    const store = {
      getConvo: jest.fn(async () => ({ isWork: false })),
      saveConvo: jest.fn(async () => undefined),
    };
    await expect(
      persistTerminalWorkState(
        { userId: 'user-a', conversationId: 'chat-a', status: 'error' },
        store,
      ),
    ).resolves.toBe(false);
    await expect(
      persistTerminalWorkState(
        { userId: 'user-a', conversationId: 'task-a', status: 'running' },
        store,
      ),
    ).resolves.toBe(false);
    await expect(persistTerminalWorkState({ status: 'complete' }, store)).resolves.toBe(false);
    expect(store.saveConvo).not.toHaveBeenCalled();
  });
});

describe('durable engine run state', () => {
  const scope = { userId: 'user-a', tenantId: 'tenant-a', conversationId: 'task-a' };
  const runtimeFor = (state: string | null) => ({ state: jest.fn(async () => state) });
  const storeFor = (workState?: string) => ({
    getConvo: jest.fn(async () => ({ isWork: true, workState })),
    saveConvo: jest.fn(async () => undefined),
  });

  it('persists failed when an expired lease reports an interrupted run', async () => {
    const store = storeFor('running');

    await expect(readEngineWorkState(scope, runtimeFor('failed'), store)).resolves.toBe('failed');
    expect(store.saveConvo).toHaveBeenCalledWith(
      { userId: 'user-a' },
      { conversationId: 'task-a', workState: 'failed' },
      { context: 'Work terminal generation state', noUpsert: true },
    );
  });

  it('writes nothing for a live, cancelled or absent run', async () => {
    for (const state of ['running', 'cancelled', null]) {
      const store = storeFor('running');
      await expect(readEngineWorkState(scope, runtimeFor(state), store)).resolves.toBe(state);
      expect(store.saveConvo).not.toHaveBeenCalled();
    }
  });

  it('does not rewrite a conversation that already records the interruption', async () => {
    const store = storeFor('failed');

    await expect(readEngineWorkState(scope, runtimeFor('failed'), store)).resolves.toBe('failed');
    expect(store.saveConvo).not.toHaveBeenCalled();
  });

  it('still reports the interruption when persisting it fails', async () => {
    const store = {
      getConvo: jest.fn(async () => ({ isWork: true, workState: 'running' })),
      saveConvo: jest.fn(async () => {
        throw new Error('The store is unavailable.');
      }),
    };

    await expect(readEngineWorkState(scope, runtimeFor('failed'), store)).resolves.toBe('failed');
  });

  it('never promotes ordinary chat to a failed Work task', async () => {
    const store = {
      getConvo: jest.fn(async () => ({ isWork: false })),
      saveConvo: jest.fn(async () => undefined),
    };

    await expect(readEngineWorkState(scope, runtimeFor('failed'), store)).resolves.toBe('failed');
    expect(store.saveConvo).not.toHaveBeenCalled();
  });
});
