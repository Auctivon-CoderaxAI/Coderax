import {
  WORK_UNKNOWN_STATE,
  isTerminalWorkState,
  isValidWorkTask,
  isWorkConversation,
  normalizeWorkState,
  resolveStoredWorkState,
  toWorkHistory,
  toWorkTask,
  workTitle,
} from './task';

const work = (extra: Record<string, unknown> = {}) => ({
  conversationId: 'c1',
  metadata: { work: true, ...extra },
});

describe('work task mapping', () => {
  it('treats only marked conversations as Work', () => {
    expect(isWorkConversation({ metadata: { work: true } })).toBe(true);
    expect(isWorkConversation({ metadata: { work: false } })).toBe(false);
    expect(isWorkConversation({ metadata: {} })).toBe(false);
    expect(isWorkConversation({})).toBe(false);
    expect(isWorkConversation({ metadata: null })).toBe(false);
  });

  it('derives a bounded title from the submitted task', () => {
    expect(workTitle('  Build   a launch plan ')).toBe('Build a launch plan');
    expect(workTitle('x'.repeat(200))).toHaveLength(80);
  });

  it('rejects empty and oversized tasks', () => {
    expect(isValidWorkTask('hello')).toBe(true);
    expect(isValidWorkTask('   ')).toBe(false);
    expect(isValidWorkTask('')).toBe(false);
    expect(isValidWorkTask('x'.repeat(4001))).toBe(false);
    expect(isValidWorkTask(undefined)).toBe(false);
  });

  it('normalises the states the run registry reports', () => {
    expect(normalizeWorkState('running')).toBe('running');
    expect(normalizeWorkState('IN_PROGRESS')).toBe('running');
    expect(normalizeWorkState('complete')).toBe('completed');
    expect(normalizeWorkState('error')).toBe('failed');
    expect(normalizeWorkState('aborted')).toBe('cancelled');
    expect(normalizeWorkState('cancelled')).toBe('cancelled');
    expect(normalizeWorkState('something-else')).toBe(WORK_UNKNOWN_STATE);
    expect(normalizeWorkState(undefined)).toBe(WORK_UNKNOWN_STATE);
  });

  it('reports terminal states without guessing', () => {
    expect(isTerminalWorkState('COMPLETED')).toBe(true);
    expect(isTerminalWorkState('failed')).toBe(true);
    expect(isTerminalWorkState('cancelled')).toBe(true);
    expect(isTerminalWorkState('running')).toBe(false);
    expect(isTerminalWorkState('')).toBe(false);
  });

  it('never labels a bare history row as running', () => {
    /** A stored conversation proves the task existed, not that it is in flight. */
    expect(toWorkTask(work())?.state).toBe(WORK_UNKNOWN_STATE);
    expect(resolveStoredWorkState(work())).toBe(WORK_UNKNOWN_STATE);
    expect(toWorkTask(work({ workState: 'bogus' }))?.state).toBe(WORK_UNKNOWN_STATE);
  });

  it('honours a state the server persisted when the run settled', () => {
    expect(toWorkTask(work({ workState: 'completed' }))?.state).toBe('completed');
    expect(toWorkTask(work({ workState: 'aborted' }))?.state).toBe('cancelled');
  });

  it('prefers live run state over the stored row', () => {
    expect(toWorkTask(work({ workState: 'completed' }), 'running')?.state).toBe('running');
    expect(toWorkTask(work(), 'failed')?.state).toBe('failed');
  });

  it('projects a conversation into a task and drops non-Work rows', () => {
    expect(toWorkTask({ conversationId: 'c1', title: 'Plan', metadata: { work: true } })).toEqual({
      id: 'c1',
      title: 'Plan',
      state: WORK_UNKNOWN_STATE,
      createdAt: undefined,
      updatedAt: undefined,
    });
    expect(toWorkTask({ conversationId: 'c2', metadata: {} })).toBeNull();
  });

  it('returns newest-first history and honours the limit', () => {
    const history = toWorkHistory(
      [
        { conversationId: 'old', updatedAt: '2026-01-01', metadata: { work: true } },
        { conversationId: 'new', updatedAt: '2026-03-01', metadata: { work: true } },
        { conversationId: 'chat', metadata: {} },
        { conversationId: 'mid', updatedAt: '2026-02-01', metadata: { work: true } },
      ],
      2,
    );
    expect(history.map((task) => task.id)).toEqual(['new', 'mid']);
  });

  it('asks the resolver for live state and leaves the rest unresolved', () => {
    const history = toWorkHistory(
      [
        { conversationId: 'live', metadata: { work: true } },
        { conversationId: 'settled', metadata: { work: true, workState: 'completed' } },
        { conversationId: 'quiet', metadata: { work: true } },
      ],
      10,
      (conversation) => (conversation.conversationId === 'live' ? 'running' : undefined),
    );
    expect(history.map((task) => [task.id, task.state])).toEqual([
      ['live', 'running'],
      ['settled', 'completed'],
      ['quiet', WORK_UNKNOWN_STATE],
    ]);
  });
});
