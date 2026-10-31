import type { WorkTaskState } from './task';
import { isTerminalWorkState, normalizeWorkState } from './task';

type WorkStateStore = {
  getConvo: (
    userId: string,
    conversationId: string,
  ) => Promise<{ isWork?: boolean } | null | undefined>;
  saveConvo: (
    context: { userId: string },
    fields: { conversationId: string; workState: WorkTaskState },
    options: { context: string; noUpsert: true },
  ) => Promise<unknown>;
};

/** Native job status is transient; map it to the durable Work lifecycle shape. */
export function workStateForJobStatus(status: unknown): WorkTaskState | null {
  const state = normalizeWorkState(status);
  return state === 'unknown' ? null : state;
}

/**
 * Persist terminal state only on an existing Work row owned by the settled
 * generation's user. `noUpsert` prevents a late event from recreating deleted
 * history, and checking the marker prevents ordinary Chat from being promoted.
 */
export async function persistTerminalWorkState(
  event: { userId?: string; conversationId?: string; status?: unknown } | null | undefined,
  store: WorkStateStore,
): Promise<boolean> {
  const workState = workStateForJobStatus(event?.status);
  if (!workState || !isTerminalWorkState(workState)) {
    return false;
  }
  const { userId, conversationId } = event ?? {};
  if (!userId || !conversationId) {
    return false;
  }
  const conversation = await store.getConvo(userId, conversationId);
  if (conversation?.isWork !== true) {
    return false;
  }
  await store.saveConvo(
    { userId },
    { conversationId, workState },
    { context: 'Work terminal generation state', noUpsert: true },
  );
  return true;
}
