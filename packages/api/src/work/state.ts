import type { WorkTaskState } from './task';
import { isTerminalWorkState, normalizeWorkState } from './task';

type WorkStateStore = {
  getConvo: (
    userId: string,
    conversationId: string,
  ) => Promise<
    { isWork?: boolean; workState?: string; workRunId?: string | null } | null | undefined
  >;
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
 *
 * Without a fence, a row that carries a generation cannot be settled: its run
 * is unknown, and an unconditional write could overwrite the run that owns it.
 * A legacy row with no generation is still recoverable, but only while it is
 * unsettled, so a completed outcome is never replaced.
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
  if (!fence && conversation.workRunId != null) {
    /** The run that owns this row is unknown; it must settle its own outcome. */
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
      ...(fence ? { workRunGeneration: fence.generation } : {}),
      unsettledWorkRun: true,
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
  /** State and generation from one lease snapshot, when the runtime keeps durable leases. */
  inspect?: (input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
  }) => Promise<{ state: string | null; generation: string | null }>;
};

type RunScope = { userId: string; tenantId: string | null; conversationId: string };

type RunSnapshot = { state: string | null; generation: string | null };

/**
 * Reads run state and its generation from one snapshot. The fallback for a
 * runtime without `inspect` names no generation; it never pairs a state read
 * with a token read that could belong to a replacement run.
 */
async function inspectRun(input: RunScope, runtime: EngineRunStateReader): Promise<RunSnapshot> {
  if (runtime.inspect) {
    return runtime.inspect(input);
  }
  return { state: await runtime.state(input), generation: null };
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
  const snapshot = await inspectRun(input, runtime);
  if (snapshot.state === 'failed') {
    await persistTerminalWorkState(
      { userId: input.userId, conversationId: input.conversationId, status: 'failed' },
      store,
      snapshot.generation == null ? undefined : { generation: snapshot.generation },
    ).catch(() => false);
  }
  return snapshot.state;
}

/** The engine runtime as far as cancellation is concerned; the route supplies it. */
export type EngineRunController = EngineRunStateReader & {
  cancel: (input: RunScope, generation?: string) => Promise<boolean>;
};

/**
 * Cancels an engine run, recording an interruption the lease store is about to
 * retire. Cancelling an expired lease deletes its row, so the `failed` outcome
 * has to reach the conversation before that evidence is gone; a live run is
 * only flagged, and reports `cancelled` through its own handler.
 *
 * The generation observed with the state is the only one this call may affect:
 * if a replacement run claimed the task in the meantime, its different token
 * makes the cancellation a no-op rather than a cancellation of the new run.
 */
export async function cancelEngineWorkRun(
  input: RunScope,
  runtime: EngineRunController,
  store: WorkStateStore,
): Promise<boolean> {
  const snapshot = await inspectRun(input, runtime);
  if (snapshot.state == null) {
    /** No run was observed, so there is nothing this cancellation may retire. */
    return false;
  }
  if (snapshot.state === 'failed') {
    const conversation = await store.getConvo(input.userId, input.conversationId);
    const recorded = normalizeWorkState(conversation?.workState) === 'failed';
    if (!recorded) {
      const persisted = await persistTerminalWorkState(
        { userId: input.userId, conversationId: input.conversationId, status: 'failed' },
        store,
        snapshot.generation == null ? undefined : { generation: snapshot.generation },
      ).catch(() => false);
      if (!persisted) {
        /** Retiring the lease would lose the only evidence of the interruption. */
        return false;
      }
    }
  }
  return runtime.cancel(input, snapshot.generation ?? undefined);
}
