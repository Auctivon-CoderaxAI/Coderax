import { createContext, useContext, useMemo } from 'react';
import { useAtom } from 'jotai';
import { createStorageAtom } from '~/store/jotai-utils';

export type ConversationMode = 'chat' | 'work';

export const ConversationModeContext = createContext<{
  selectionKey: string;
  mode: ConversationMode;
  setMode: (mode: ConversationMode) => void;
  adoptConversation: (conversationId: string) => void;
}>({
  selectionKey: '',
  mode: 'chat',
  setMode: () => undefined,
  adoptConversation: () => undefined,
});

export const useConversationMode = () => useContext(ConversationModeContext);

/** Mode belongs to the account and conversation, not to its legacy URL. */
export function useStoredConversationMode({
  userId,
  conversationId,
  initialMode,
  forceInitialMode = false,
}: {
  userId: string;
  conversationId: string;
  initialMode: ConversationMode;
  forceInitialMode?: boolean;
}) {
  const modesAtom = useMemo(
    () => createStorageAtom<Record<string, ConversationMode>>(`conversationModes:${userId}`, {}),
    [userId],
  );
  const [modes, setModes] = useAtom(modesAtom);
  const saved = modes?.[conversationId];
  const mode = forceInitialMode
    ? initialMode
    : saved === 'chat' || saved === 'work'
      ? saved
      : initialMode;

  return useMemo(
    () => ({
      selectionKey: JSON.stringify([userId, conversationId]),
      mode,
      setMode: (next: ConversationMode) =>
        setModes((current) => ({ ...current, [conversationId]: next })),
      adoptConversation: (id: string) => {
        if (conversationId === 'new' && id !== 'new' && id !== '') {
          setModes((current) => ({ ...current, [id]: current?.[conversationId] ?? mode }));
        }
      },
    }),
    [mode, userId, conversationId, setModes],
  );
}
