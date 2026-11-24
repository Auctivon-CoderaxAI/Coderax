import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { createStorageAtom } from '~/store/jotai-utils';

/** Product surfaces a conversation can be worked in. */
export const CONVERSATION_MODES = ['chat', 'code', 'review'] as const;

export type ConversationMode = (typeof CONVERSATION_MODES)[number];

/** `work` is the name `code` carried before modes existed; it is never stored again. */
export type LegacyConversationMode = 'work';

/** Anything a stored record, an older server row or a legacy route can still carry. */
export type StoredConversationMode = ConversationMode | LegacyConversationMode;

export type ConversationModeRecord = Partial<Record<string, StoredConversationMode>>;

export const conversationModesStorageKey = (userId: string) => `conversationModes:${userId}`;

/** Keep exactly one Jotai storage atom per account so sidebar rows and the
 * active conversation observe mode changes in the same tab. */
const conversationModesAtoms = new Map<
  string,
  ReturnType<typeof createStorageAtom<ConversationModeRecord>>
>();

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

/** A sidebar row never writes a mode; it only reads this account's saved value.
 * Normalize old 'work' entries as canonical 'code', but leave absent/invalid
 * entries unbadged instead of guessing the route's default. */
export function useSavedConversationMode(
  userId: string | undefined,
  conversationId: string | undefined,
): ConversationMode | undefined {
  const modesAtom = useMemo(() => getConversationModesAtom(userId ?? ''), [userId]);
  const modes = useAtomValue(modesAtom);
  if (!conversationId) {
    return undefined;
  }
  return normaliseMode(modes?.[conversationId]);
}

/** Canonical mode for any stored or submitted value; `undefined` when it names none. */
export function normaliseMode(value: unknown): ConversationMode | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const mode = value.trim().toLowerCase();
  if (mode === 'work') {
    return 'code';
  }
  return (CONVERSATION_MODES as readonly string[]).includes(mode)
    ? (mode as ConversationMode)
    : undefined;
}

/** Adds or replaces one conversation's mode under its canonical name. */
export function recordMode(
  record: ConversationModeRecord,
  conversationId: string,
  mode: StoredConversationMode,
): ConversationModeRecord {
  const canonical = normaliseMode(mode);
  if (canonical == null) {
    return record;
  }
  return { ...record, [conversationId]: canonical };
}

export const ConversationModeContext = createContext<{
  selectionKey: string;
  mode: ConversationMode;
  setMode: (mode: StoredConversationMode) => void;
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
  initialMode: StoredConversationMode;
  forceInitialMode?: boolean;
}) {
  const modesAtom = useMemo(() => getConversationModesAtom(userId), [userId]);
  const [modes, setModes] = useAtom(modesAtom);
  const initial = normaliseMode(initialMode) ?? 'chat';
  const saved = modes?.[conversationId];
  const forcedModeKey = JSON.stringify([userId, conversationId]);
  const forcedModeKeyRef = useRef<string | null>(null);
  const shouldForceInitialMode = forceInitialMode && forcedModeKeyRef.current !== forcedModeKey;
  const mode: ConversationMode = shouldForceInitialMode
    ? (normaliseMode(initialMode) ?? 'chat')
    : (normaliseMode(saved) ?? normaliseMode(initialMode) ?? 'chat');

  useEffect(() => {
    if (!shouldForceInitialMode) {
      return;
    }
    forcedModeKeyRef.current = forcedModeKey;
    setModes((current) =>
      current?.[conversationId] === normaliseMode(initialMode)
        ? current
        : recordMode(current ?? {}, conversationId, initialMode),
    );
  }, [conversationId, forcedModeKey, initial, setModes, shouldForceInitialMode]);

  return useMemo(
    () => ({
      selectionKey: JSON.stringify([userId, conversationId]),
      mode,
      setMode: (next: StoredConversationMode) => {
        if (normaliseMode(next) === undefined) {
          return;
        }
        setModes((current) => recordMode(current ?? {}, conversationId, next));
      },
      adoptConversation: (id: string) => {
        if (conversationId === 'new' && id !== 'new' && id !== '') {
          setModes((current) =>
            recordMode(current ?? {}, id, normaliseMode(current?.[conversationId]) ?? mode),
          );
        }
        setModes((current) => {
          const drafted = normaliseMode(current?.[conversationId]) ?? mode;
          return current?.[id] === drafted ? current : recordMode(current ?? {}, id, drafted);
        });
      },
    }),
    [mode, userId, conversationId, setModes],
  );
}
