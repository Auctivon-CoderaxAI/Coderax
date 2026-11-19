import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
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
  const forcedModeKey = JSON.stringify([userId, conversationId]);
  const forcedModeKeyRef = useRef<string | null>(null);
  const shouldForceInitialMode = forceInitialMode && forcedModeKeyRef.current !== forcedModeKey;
  const mode = shouldForceInitialMode
    ? initialMode
    : saved === 'chat' || saved === 'work'
      ? saved
      : initialMode;

  useEffect(() => {
    if (!shouldForceInitialMode) {
      return;
    }
    forcedModeKeyRef.current = forcedModeKey;
    setModes((current) =>
      current?.[conversationId] === initialMode
        ? current
        : { ...current, [conversationId]: initialMode },
    );
  }, [conversationId, forcedModeKey, initialMode, setModes, shouldForceInitialMode]);

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
