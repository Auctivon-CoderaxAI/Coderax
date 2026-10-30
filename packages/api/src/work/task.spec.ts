import {
  isTerminalWorkState,
  isValidWorkTask,
  isWorkConversation,
  toWorkHistory,
  toWorkTask,
  workTitle,
} from './task';

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

  it('reports terminal states without guessing', () => {
    expect(isTerminalWorkState('COMPLETED')).toBe(true);
    expect(isTerminalWorkState('cancelled')).toBe(true);
    expect(isTerminalWorkState('running')).toBe(false);
    expect(isTerminalWorkState('')).toBe(false);
  });

  it('projects a conversation into a task and drops non-Work rows', () => {
    expect(
      toWorkTask({ conversationId: 'c1', title: 'Plan', metadata: { work: true } }),
    ).toEqual({ id: 'c1', title: 'Plan', state: 'running' });
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
});
