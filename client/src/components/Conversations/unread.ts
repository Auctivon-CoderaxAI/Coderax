/**
 * How many unread completions the Recents section itself holds.
 *
 * The unseen aggregate also covers pinned chats and chats filed in a project,
 * which have their own rows elsewhere. The Recents header counts only the
 * conversations this list is showing, so a completion in Pinned never lights
 * the Recents dot. Ids are compared rather than objects so a refresh that
 * returns the same rows cannot change the count.
 */
export function countUnreadInRecents(
  unseen: ReadonlyArray<{ conversationId: string }>,
  recentsIds: ReadonlySet<string>,
): number {
  const counted = new Set<string>();
  for (const conversation of unseen) {
    const id = conversation.conversationId;
    if (recentsIds.has(id) && !counted.has(id)) {
      counted.add(id);
    }
  }
  return counted.size;
}
