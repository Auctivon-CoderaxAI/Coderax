import { act, renderHook } from '@testing-library/react';
import { useStoredConversationMode } from '../mode';

beforeEach(() => localStorage.clear());

it('reads a legacy work record as the code surface and writes the canonical name back', () => {
  localStorage.setItem('conversationModes:owner', JSON.stringify({ 'conversation-a': 'work' }));

  const { result } = renderHook(() =>
    useStoredConversationMode({
      userId: 'owner',
      conversationId: 'conversation-a',
      initialMode: 'chat',
    }),
  );

  expect(result.current.mode).toBe('code');

  act(() => result.current.setMode('work'));

  expect(result.current.mode).toBe('code');
  expect(JSON.parse(localStorage.getItem('conversationModes:owner') ?? '{}')).toEqual({
    'conversation-a': 'code',
  });
});

it('keeps each conversation and account on its own mode under the existing storage key', () => {
  const first = renderHook(() =>
    useStoredConversationMode({
      userId: 'owner-a',
      conversationId: 'conversation-a',
      initialMode: 'chat',
    }),
  );
  act(() => first.result.current.setMode('code'));
  first.unmount();

  expect(JSON.parse(localStorage.getItem('conversationModes:owner-a') ?? '{}')).toEqual({
    'conversation-a': 'code',
  });

  const restored = renderHook(
    ({ userId, conversationId }) =>
      useStoredConversationMode({ userId, conversationId, initialMode: 'chat' }),
    { initialProps: { userId: 'owner-a', conversationId: 'conversation-a' } },
  );

  expect(restored.result.current.mode).toBe('code');

  restored.rerender({ userId: 'owner-a', conversationId: 'conversation-b' });
  expect(restored.result.current.mode).toBe('chat');

  restored.rerender({ userId: 'owner-b', conversationId: 'conversation-a' });
  expect(restored.result.current.mode).toBe('chat');
});

it('carries the draft mode to an acknowledged conversation on first save', () => {
  const { result, rerender } = renderHook(
    ({ conversationId }) =>
      useStoredConversationMode({ userId: 'owner', conversationId, initialMode: 'chat' }),
    { initialProps: { conversationId: 'new' } },
  );

  act(() => result.current.setMode('review'));
  act(() => result.current.adoptConversation('server-id'));
  rerender({ conversationId: 'server-id' });

  expect(result.current.mode).toBe('review');
  expect(JSON.parse(localStorage.getItem('conversationModes:owner') ?? '{}')).toEqual({
    new: 'review',
    'server-id': 'review',
  });
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
  act(() => result.current.setMode('code'));
  rerender({ conversationId: 'previous-chat' });
  expect(result.current.mode).toBe('chat');
});

it('can adopt an acknowledged conversation when stored mode data is null', () => {
  localStorage.setItem('conversationModes:owner', 'null');

  const { result, rerender } = renderHook(
    ({ conversationId }) =>
      useStoredConversationMode({ userId: 'owner', conversationId, initialMode: 'work' }),
    { initialProps: { conversationId: 'new' } },
  );

  act(() => result.current.adoptConversation('server-id'));
  rerender({ conversationId: 'server-id' });

  expect(result.current.mode).toBe('code');
});

it('honors an explicit Work deep link over a saved Chat mode', () => {
  const savedChat = renderHook(() =>
    useStoredConversationMode({ userId: 'owner', conversationId: 'new', initialMode: 'chat' }),
  );
  act(() => savedChat.result.current.setMode('chat'));
  savedChat.unmount();

  const workLink = renderHook(() =>
    useStoredConversationMode({
      userId: 'owner',
      conversationId: 'new',
      initialMode: 'work',
      forceInitialMode: true,
    }),
  );

  expect(workLink.result.current.mode).toBe('code');

  act(() => workLink.result.current.setMode('chat'));
  expect(workLink.result.current.mode).toBe('chat');
});
