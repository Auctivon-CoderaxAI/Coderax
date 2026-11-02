import { persistTerminalWorkState, workStateForJobStatus } from './state';

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
