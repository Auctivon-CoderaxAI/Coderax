import { act, renderHook } from '@testing-library/react';
import { useStoredConversationMode } from '../mode';

beforeEach(() => localStorage.clear());

it('can adopt an acknowledged conversation when stored mode data is null', () => {
  localStorage.setItem('conversationModes:owner', 'null');
  const { result, rerender } = renderHook(
    ({ conversationId }) =>
      useStoredConversationMode({ userId: 'owner', conversationId, initialMode: 'work' }),
    { initialProps: { conversationId: 'new' } },
  );
  act(() => result.current.adoptConversation('server-id'));
  rerender({ conversationId: 'server-id' });
  expect(result.current.mode).toBe('work');
});

it('restores a conversation mode after a reload and isolates it from other conversations and accounts', () => {
  const first = renderHook(() =>
    useStoredConversationMode({
      userId: 'owner-a',
      conversationId: 'conversation-a',
      initialMode: 'chat',
    }),
  );
  act(() => first.result.current.setMode('work'));
  first.unmount();
  const restored = renderHook(
    ({ userId, conversationId }) =>
      useStoredConversationMode({ userId, conversationId, initialMode: 'chat' }),
    { initialProps: { userId: 'owner-a', conversationId: 'conversation-a' } },
  );
  expect(restored.result.current.mode).toBe('work');
  restored.rerender({ userId: 'owner-a', conversationId: 'conversation-b' });
  expect(restored.result.current.mode).toBe('chat');
  restored.rerender({ userId: 'owner-b', conversationId: 'conversation-a' });
  expect(restored.result.current.mode).toBe('chat');
});

it('copies the latest mode only to an acknowledged server identity, not to an arbitrary visited conversation', () => {
  const { result, rerender } = renderHook(
    ({ conversationId }) =>
      useStoredConversationMode({ userId: 'owner', conversationId, initialMode: 'chat' }),
    { initialProps: { conversationId: 'new' } },
  );
  act(() => result.current.setMode('work'));
  const runningTurn = result.current;
  act(() => result.current.setMode('chat'));
  act(() => runningTurn.adoptConversation('server-id'));
  rerender({ conversationId: 'server-id' });
  expect(result.current.mode).toBe('chat');
  rerender({ conversationId: 'new' });
  act(() => result.current.setMode('work'));
  rerender({ conversationId: 'previous-chat' });
  expect(result.current.mode).toBe('chat');
});
