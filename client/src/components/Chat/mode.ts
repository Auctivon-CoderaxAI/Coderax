import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { createStorageAtom } from '~/store/jotai-utils';

export type ConversationMode = 'chat' | 'work';

/** Modes saved per conversation id, under the account that saved them. */
export type ConversationModeRecord = Record<string, ConversationMode>;

/**
 * `createStorageAtom` hands back a new atom on every call, and two atoms over the
 * same key do not see each other's writes inside one tab. The mode switcher and the
 * sidebar badges have to agree the instant the user flips one, so both read the
 * account's single atom from here instead of each creating its own.
 */
const conversationModesAtoms = new Map<
  string,
  ReturnType<typeof createStorageAtom<ConversationModeRecord>>
>();

export function conversationModesStorageKey(userId: string) {
  return `conversationModes:${userId}`;
}

export function getConversationModesAtom(userId: string) {
  const key = conversationModesStorageKey(userId);
  const cached = conversationModesAtoms.get(key);
  if (cached) {
    return cached;
  }
  const modesAtom = createStorageAtom<ConversationModeRecord>(key, {});
  conversationModesAtoms.set(key, modesAtom);
  return modesAtom;
}

function isConversationMode(value: unknown): value is ConversationMode {
  return value === 'chat' || value === 'work';
}

/**
 * One conversation's saved mode, or undefined when the user never chose one.
 * Read-only: a row nobody switched stays unbadged, and the sidebar never writes.
 */
export function useSavedConversationMode(
  userId: string | undefined,
  conversationId: string | undefined,
): ConversationMode | undefined {
  const modesAtom = useMemo(() => getConversationModesAtom(userId ?? ''), [userId]);
  const modes = useAtomValue(modesAtom);
  if (!conversationId) {
    return undefined;
  }
  const saved = modes?.[conversationId];
  return isConversationMode(saved) ? saved : undefined;
}

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
  const modesAtom = useMemo(() => getConversationModesAtom(userId), [userId]);
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
