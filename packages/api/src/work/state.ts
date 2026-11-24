import type { WorkTaskState } from './task';
import { isTerminalWorkState, normalizeWorkState } from './task';

type WorkStateStore = {
  getConvo: (
    userId: string,
    conversationId: string,
  ) => Promise<{ isWork?: boolean; workState?: string } | null | undefined>;
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
 * A row that already records the outcome is left untouched, so observing the
 * same settled run twice costs a read instead of a write.
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
  /** Nothing to write: the conversation already settled on this outcome. */
  if (normalizeWorkState(conversation.workState) === workState) {
    return false;
  }
  await store.saveConvo(
    { userId },
    { conversationId, workState },
    { context: 'Work terminal generation state', noUpsert: true },
  );
  return true;
}

/** The engine runtime as far as run state is concerned; the route supplies it. */
export type EngineRunStateReader = {
  state: (input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
  }) => Promise<string | null>;
};

/**
 * Resolves a Work task's run state from the engine's durable lease.
 *
 * An interrupted run — a restart or crash, which shows up as a lease that
 * stopped heartbeating — has no handler left to report its outcome, so seeing
 * it is what persists `failed` on the conversation. That keeps the outcome after
 * the lease row is reclaimed; a failed write still reports the interruption,
 * because the row itself remains the evidence until cleanup.
 */
export async function readEngineWorkState(
  input: { userId: string; tenantId: string | null; conversationId: string },
  runtime: EngineRunStateReader,
  store: WorkStateStore,
): Promise<string | null> {
  const state = await runtime.state(input);
  if (state === 'failed') {
    await persistTerminalWorkState(
      { userId: input.userId, conversationId: input.conversationId, status: 'failed' },
      store,
    ).catch(() => false);
  }
  return state;
}
