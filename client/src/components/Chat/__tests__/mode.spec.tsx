import type { PropsWithChildren } from 'react';
import { createStore, Provider } from 'jotai';
import { act, renderHook } from '@testing-library/react';
import { normaliseMode, useStoredConversationMode } from '../mode';

let testStore = createStore();

function wrapper({ children }: PropsWithChildren) {
  return <Provider store={testStore}>{children}</Provider>;
}

function renderModeHook<Result, Props>(
  callback: (props: Props) => Result,
  options?: { initialProps?: Props },
) {
  return renderHook(callback, { ...options, wrapper });
}

beforeEach(() => {
  localStorage.clear();
  // The application shares one atom per account. Each test must use a fresh
  // Jotai store so saved modes from earlier specs cannot leak through that atom.
  testStore = createStore();
});

it('can adopt an acknowledged conversation when stored mode data is null', () => {
  localStorage.setItem('conversationModes:owner', 'null');
  const { result, rerender } = renderModeHook(
    ({ conversationId }) =>
      useStoredConversationMode({ userId: 'owner', conversationId, initialMode: 'work' }),
    { initialProps: { conversationId: 'new' } },
  );
  act(() => result.current.adoptConversation('server-id'));
  rerender({ conversationId: 'server-id' });
  expect(result.current.mode).toBe('code');
});

it('restores a conversation mode after a reload and isolates it from other conversations and accounts', () => {
  const first = renderModeHook(() =>
    useStoredConversationMode({
      userId: 'owner-a',
      conversationId: 'conversation-a',
      initialMode: 'chat',
    }),
  );
  act(() => first.result.current.setMode('code'));
  first.unmount();
  const restored = renderModeHook(
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
  const { result, rerender } = renderModeHook(
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
  const savedChat = renderModeHook(() =>
    useStoredConversationMode({ userId: 'owner', conversationId: 'new', initialMode: 'chat' }),
  );
  act(() => savedChat.result.current.setMode('chat'));
  savedChat.unmount();

  const workLink = renderModeHook(() =>
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

it('opens a legacy stored work value on the code surface', () => {
  localStorage.setItem('conversationModes:owner', JSON.stringify({ legacy: 'work' }));
  const { result } = renderModeHook(() =>
    useStoredConversationMode({
      userId: 'owner',
      conversationId: 'legacy',
      initialMode: 'chat',
    }),
  );
  expect(result.current.mode).toBe('code');
});

it('stores the canonical name under the account-scoped key', () => {
  const { result } = renderModeHook(() =>
    useStoredConversationMode({
      userId: 'owner',
      conversationId: 'conversation-a',
      initialMode: 'chat',
    }),
  );
  act(() => result.current.setMode('work'));
  expect(JSON.parse(localStorage.getItem('conversationModes:owner') ?? '{}')).toEqual({
    'conversation-a': 'code',
  });
});

it('supports the review surface and normalises anything that names no mode', () => {
  const { result } = renderModeHook(() =>
    useStoredConversationMode({
      userId: 'owner',
      conversationId: 'conversation-a',
      initialMode: 'chat',
    }),
  );
  act(() => result.current.setMode('review'));
  expect(result.current.mode).toBe('review');

  expect(normaliseMode('work')).toBe('code');
  expect(normaliseMode(' CODE ')).toBe('code');
  expect(normaliseMode('Review')).toBe('review');
  expect(normaliseMode('builder')).toBeUndefined();
  expect(normaliseMode(null)).toBeUndefined();
  expect(normaliseMode(7)).toBeUndefined();
});

it('normalizes an unsupported stored draft mode before adopting its server conversation', () => {
  localStorage.setItem('conversationModes:owner', JSON.stringify({ new: 'builder' }));
  const { result, rerender } = renderModeHook(
    ({ conversationId }) =>
      useStoredConversationMode({ userId: 'owner', conversationId, initialMode: 'chat' }),
    { initialProps: { conversationId: 'new' } },
  );
  expect(result.current.mode).toBe('chat');

  act(() => result.current.adoptConversation('server-id'));
  expect(JSON.parse(localStorage.getItem('conversationModes:owner') ?? '{}')).toEqual({
    new: 'builder',
    'server-id': 'chat',
  });

  rerender({ conversationId: 'server-id' });
  expect(result.current.mode).toBe('chat');
});
