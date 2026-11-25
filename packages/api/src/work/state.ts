import type { WorkTaskState } from './task';
import { isTerminalWorkState, normalizeWorkState } from './task';

type WorkStateStore = {
  getConvo: (
    userId: string,
    conversationId: string,
  ) => Promise<{ isWork?: boolean; workState?: string } | null | undefined>;
  saveConvo: (
    context: { userId: string },
    fields: { conversationId: string; workState: WorkTaskState; workRunId?: string | null },
    options: {
      context: string;
      noUpsert: true;
      workRunGeneration?: string;
      unsettledWorkRun?: boolean;
    },
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
 *
 * `fence` names the run the outcome belongs to. The write is then an atomic
 * compare-and-set on that generation: a newer run stamps its own as it starts,
 * so a late outcome from the run it replaced matches nothing and leaves the
 * newer run's state alone. A settled row detaches its generation, which is what
 * keeps a later reading of a dead lease from reopening a finished task.
 */
export async function persistTerminalWorkState(
  event: { userId?: string; conversationId?: string; status?: unknown } | null | undefined,
  store: WorkStateStore,
  fence?: { generation: string },
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
    {
      conversationId,
      workState,
      ...(fence ? { workRunId: null } : {}),
    },
    {
      context: 'Work terminal generation state',
      noUpsert: true,
      ...(fence ? { workRunGeneration: fence.generation, unsettledWorkRun: true } : {}),
    },
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
  /** The lease generation behind `state()`, when the runtime keeps durable leases. */
  generation?: (input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
  }) => Promise<string | null>;
};

type RunScope = { userId: string; tenantId: string | null; conversationId: string };

async function readRunGeneration(
  input: RunScope,
  runtime: EngineRunStateReader,
): Promise<string | null> {
  if (!runtime.generation) {
    return null;
  }
  try {
    return await runtime.generation(input);
  } catch {
    /** An unreadable generation costs the fence, not the outcome: the row itself
     *  still reports the interruption until cleanup reclaims it. */
    return null;
  }
}

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
  input: RunScope,
  runtime: EngineRunStateReader,
  store: WorkStateStore,
): Promise<string | null> {
  const state = await runtime.state(input);
  if (state === 'failed') {
    const generation = await readRunGeneration(input, runtime);
    await persistTerminalWorkState(
      { userId: input.userId, conversationId: input.conversationId, status: 'failed' },
      store,
      generation == null ? undefined : { generation },
    ).catch(() => false);
  }
  return state;
}

/** The engine runtime as far as cancellation is concerned; the route supplies it. */
export type EngineRunController = EngineRunStateReader & {
  cancel: (input: RunScope) => Promise<boolean>;
};

/**
 * Cancels an engine run, recording an interruption the lease store is about to
 * retire. Cancelling an expired lease deletes its row, so the `failed` outcome
 * has to reach the conversation before that evidence is gone; a live run is
 * only flagged, and reports `cancelled` through its own handler.
 */
export async function cancelEngineWorkRun(
  input: RunScope,
  runtime: EngineRunController,
  store: WorkStateStore,
): Promise<boolean> {
  await readEngineWorkState(input, runtime, store);
  return runtime.cancel(input);
}
