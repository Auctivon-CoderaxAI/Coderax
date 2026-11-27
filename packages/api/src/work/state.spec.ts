import {
  cancelEngineWorkRun,
  persistTerminalWorkState,
  readEngineWorkState,
  workStateForJobStatus,
} from './state';

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
      {
        context: 'Work terminal generation state',
        noUpsert: true,
        unsettledWorkRun: true,
      },
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
  const storeFor = (workState?: string, workRunId?: string | null) => ({
    getConvo: jest.fn(async () => ({
      isWork: true,
      workState,
      ...(workRunId !== undefined ? { workRunId } : {}),
    })),
    saveConvo: jest.fn(async () => undefined),
  });

  it('reads the state and its generation from one lease snapshot', async () => {
    const store = storeFor('running', 'run-1');
    const runtime = {
      state: jest.fn(async () => {
        throw new Error('state must not be read separately');
      }),
      inspect: jest.fn(async () => ({ state: 'failed', generation: 'run-1' })),
    };

    await expect(readEngineWorkState(scope, runtime, store)).resolves.toBe('failed');
    expect(runtime.inspect).toHaveBeenCalledTimes(1);
    expect(runtime.state).not.toHaveBeenCalled();
    expect(store.saveConvo).toHaveBeenCalledWith(
      { userId: 'user-a' },
      { conversationId: 'task-a', workState: 'failed', workRunId: null },
      {
        context: 'Work terminal generation state',
        noUpsert: true,
        workRunGeneration: 'run-1',
        unsettledWorkRun: true,
      },
    );
  });

  it('persists failed when an expired lease reports an interrupted run', async () => {
    const store = storeFor('running');
    const runtime = { state: jest.fn(async () => 'failed') };

    await expect(readEngineWorkState(scope, runtime, store)).resolves.toBe('failed');
    expect(store.saveConvo).toHaveBeenCalledWith(
      { userId: 'user-a' },
      { conversationId: 'task-a', workState: 'failed' },
      {
        context: 'Work terminal generation state',
        noUpsert: true,
        unsettledWorkRun: true,
      },
    );
  });

  it('writes nothing for a live, cancelled or absent run', async () => {
    for (const state of ['running', 'cancelled', null]) {
      const store = storeFor('running');
      await expect(
        readEngineWorkState(scope, { state: jest.fn(async () => state) }, store),
      ).resolves.toBe(state);
      expect(store.saveConvo).not.toHaveBeenCalled();
    }
  });

  it('does not rewrite a conversation that already records the interruption', async () => {
    const store = storeFor('failed');

    await expect(
      readEngineWorkState(scope, { state: jest.fn(async () => 'failed') }, store),
    ).resolves.toBe('failed');
    expect(store.saveConvo).not.toHaveBeenCalled();
  });

  it('still reports the interruption when persisting it fails', async () => {
    const store = {
      getConvo: jest.fn(async () => ({ isWork: true, workState: 'running' })),
      saveConvo: jest.fn(async () => {
        throw new Error('The store is unavailable.');
      }),
    };

    await expect(
      readEngineWorkState(scope, { state: jest.fn(async () => 'failed') }, store),
    ).resolves.toBe('failed');
  });

  it('never promotes ordinary chat to a failed Work task', async () => {
    const store = {
      getConvo: jest.fn(async () => ({ isWork: false })),
      saveConvo: jest.fn(async () => undefined),
    };

    await expect(
      readEngineWorkState(scope, { state: jest.fn(async () => 'failed') }, store),
    ).resolves.toBe('failed');
    expect(store.saveConvo).not.toHaveBeenCalled();
  });

  it('does not overwrite another run when the generation cannot be read', async () => {
    const store = storeFor('running', 'run-2');
    const runtime = {
      state: jest.fn(async () => 'failed'),
      generation: jest.fn(async () => {
        throw new Error('lease store down');
      }),
    };

    await expect(readEngineWorkState(scope, runtime, store)).resolves.toBe('failed');
    /** A separate token read is exactly the unsafe pairing this path avoids. */
    expect(runtime.generation).not.toHaveBeenCalled();
    expect(store.saveConvo).not.toHaveBeenCalled();
  });

  it('records a legacy interruption only while its row is unsettled', async () => {
    const store = storeFor('running');
    const runtime = {
      state: jest.fn(async () => 'failed'),
      inspect: jest.fn(async () => ({ state: 'failed', generation: null })),
    };

    await expect(readEngineWorkState(scope, runtime, store)).resolves.toBe('failed');
    expect(store.saveConvo).toHaveBeenCalledWith(
      { userId: 'user-a' },
      { conversationId: 'task-a', workState: 'failed' },
      {
        context: 'Work terminal generation state',
        noUpsert: true,
        unsettledWorkRun: true,
      },
    );
  });

  it('records an interrupted run before the cancel retires its lease', async () => {
    const order: string[] = [];
    const store = {
      getConvo: jest.fn(async () => ({ isWork: true, workState: 'running', workRunId: 'run-1' })),
      saveConvo: jest.fn(async () => {
        order.push('persisted');
      }),
    };
    const runtime = {
      state: jest.fn(),
      inspect: jest.fn(async () => ({ state: 'failed', generation: 'run-1' })),
      cancel: jest.fn(async () => {
        order.push('cancelled');
        return true;
      }),
    };

    await expect(cancelEngineWorkRun(scope, runtime, store)).resolves.toBe(true);
    expect(order).toEqual(['persisted', 'cancelled']);
    expect(store.saveConvo).toHaveBeenCalledWith(
      { userId: 'user-a' },
      { conversationId: 'task-a', workState: 'failed', workRunId: null },
      expect.objectContaining({ workRunGeneration: 'run-1' }),
    );
    expect(runtime.cancel).toHaveBeenCalledWith(scope, 'run-1');
  });

  it('does not retire an expired lease when its interruption cannot be recorded', async () => {
    const store = {
      getConvo: jest.fn(async () => ({ isWork: true, workState: 'running', workRunId: 'run-1' })),
      saveConvo: jest.fn(async () => {
        throw new Error('The store is unavailable.');
      }),
    };
    const runtime = {
      state: jest.fn(),
      inspect: jest.fn(async () => ({ state: 'failed', generation: 'run-1' })),
      cancel: jest.fn(async () => true),
    };

    await expect(cancelEngineWorkRun(scope, runtime, store)).resolves.toBe(false);
    expect(runtime.cancel).not.toHaveBeenCalled();
  });

  it('cancels only the generation it observed', async () => {
    const store = storeFor('running');
    const runtime = {
      state: jest.fn(),
      inspect: jest.fn(async () => ({ state: 'running', generation: 'run-1' })),
      cancel: jest.fn(async () => true),
    };

    await expect(cancelEngineWorkRun(scope, runtime, store)).resolves.toBe(true);
    expect(store.saveConvo).not.toHaveBeenCalled();
    expect(runtime.cancel).toHaveBeenCalledWith(scope, 'run-1');
  });

  it('does not cancel a run that appeared after an empty observation', async () => {
    const store = storeFor('running');
    const runtime = {
      state: jest.fn(),
      inspect: jest.fn(async () => ({ state: null, generation: null })),
      cancel: jest.fn(async () => true),
    };

    await expect(cancelEngineWorkRun(scope, runtime, store)).resolves.toBe(false);
    expect(runtime.cancel).not.toHaveBeenCalled();
  });
});
