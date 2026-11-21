import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useAtom } from 'jotai';
import { createStorageAtom } from '~/store/jotai-utils';

/** Surfaces a conversation can be worked in. `work` is the name `code` had before modes. */
export const CONVERSATION_MODES = ['chat', 'code', 'review'] as const;

export type ConversationMode = (typeof CONVERSATION_MODES)[number];

/** A stored or submitted value from before `work` became `code`. */
export type LegacyConversationMode = 'work';

/** Anything a saved record, a URL or an older caller can still carry. */
export type StoredConversationMode = ConversationMode | LegacyConversationMode;

export const MODE_ALIASES = {
  work: 'code',
} as const satisfies Record<LegacyConversationMode, ConversationMode>;

export type ConversationModeRecord = Partial<Record<string, StoredConversationMode>>;

export const conversationModesStorageKey = (userId: string) => `conversationModes:${userId}`;

/** Canonical mode for any stored or submitted value; `undefined` when it names none. */
export function normaliseMode(value: unknown): ConversationMode | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const mode = value.trim().toLowerCase();
  if (mode === 'work') {
    return MODE_ALIASES.work;
  }
  return (CONVERSATION_MODES as readonly string[]).includes(mode)
    ? (mode as ConversationMode)
    : undefined;
}

/** Adds or replaces one conversation's mode, held under its canonical name. */
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
  /** Route or conversation default; a legacy `work` value opens the `code` surface. */
  initialMode: StoredConversationMode;
  /** A legacy `/work` route pins the mode for this mount instead of deferring to storage. */
  forceInitialMode?: boolean;
}) {
  const modesAtom = useMemo(
    () => createStorageAtom<ConversationModeRecord>(conversationModesStorageKey(userId), {}),
    [userId],
  );
  const [modes, setModes] = useAtom(modesAtom);
  const initial = normaliseMode(initialMode) ?? 'chat';
  const saved = modes?.[conversationId];
  const forcedModeKey = JSON.stringify([userId, conversationId]);
  const forcedModeKeyRef = useRef<string | null>(null);
  const shouldForceInitialMode = forceInitialMode && forcedModeKeyRef.current !== forcedModeKey;
  const mode = shouldForceInitialMode ? initial : (normaliseMode(saved) ?? initial);

  useEffect(() => {
    if (!shouldForceInitialMode) {
      return;
    }
    forcedModeKeyRef.current = forcedModeKey;
    setModes((current) =>
      normaliseMode(current?.[conversationId]) === initial
        ? current
        : recordMode(current ?? {}, conversationId, initial),
    );
  }, [conversationId, forcedModeKey, initial, setModes, shouldForceInitialMode]);

  return useMemo(
    () => ({
      selectionKey: JSON.stringify([userId, conversationId]),
      mode,
      setMode: (next: StoredConversationMode) =>
        setModes((current) => recordMode(current ?? {}, conversationId, next)),
      adoptConversation: (id: string) => {
        if (conversationId !== 'new' || id === 'new' || id === '') {
          return;
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
