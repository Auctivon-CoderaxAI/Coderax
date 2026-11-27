import { atom } from 'jotai';

/**
 * How many conversations hold a reply the owner has not caught up with.
 *
 * Published by `ReplyNotifications` from `useUnseenConversations`, whose answer is
 * derived from the read state persisted on each conversation — `lastResponseAt`
 * compared with the server-stamped `lastSeenAt` — so the dot survives reloads and
 * agrees with another device, instead of being inferred from local storage.
 * Consumed by the Recents rail and the mobile panel switcher.
 */
export const unreadCountAtom = atom(0);
