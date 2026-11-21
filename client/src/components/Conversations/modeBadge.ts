import type { TranslationKeys } from '~/hooks/useLocalize';
import type { ConversationMode } from '~/components/Chat/mode';

export type ConversationModeBadgeDescriptor = {
  mode: ConversationMode;
  /** Already in the catalogue, so the badge needs no new locale entry. */
  labelKey: TranslationKeys;
};

/**
 * Only a mode that changes what the row is gets a badge. Chat is the default every
 * conversation starts in, so marking it would put the same badge on the whole list.
 */
export function resolveConversationModeBadge(
  mode: ConversationMode | null | undefined,
): ConversationModeBadgeDescriptor | null {
  if (mode === 'work') {
    return { mode, labelKey: 'com_ui_work' };
  }
  return null;
}
