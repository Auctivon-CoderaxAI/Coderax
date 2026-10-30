/**
 * A Work task is a Coderax conversation, not a parallel task record. These
 * helpers keep that mapping in one place so the router and the client agree on
 * what counts as Work, how a task is titled, and when it is finished.
 */

export const WORK_MAX_TASK_LENGTH = 4000;

/** Run states the Work surface knows how to render. */
export type WorkTaskState = 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';

/**
 * A stored conversation proves a task existed, never that it is still running.
 * Run state lives in the live job registry, so a row with no resolved state is
 * `unknown` rather than a fabricated `running`.
 */
export const WORK_UNKNOWN_STATE: WorkTaskState = 'unknown';

/** The state Coderax itself may persist on the conversation when a run settles. */
const STATE_ALIASES: Record<string, WorkTaskState> = {
  running: 'running',
  in_progress: 'running',
  started: 'running',
  queued: 'running',
  complete: 'completed',
  completed: 'completed',
  done: 'completed',
  success: 'completed',
  succeeded: 'completed',
  error: 'failed',
  failed: 'failed',
  aborted: 'cancelled',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  unknown: 'unknown',
};

export type WorkConversation = {
  conversationId: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  isWork?: boolean;
  workModel?: string;
  workState?: string;
};

export type WorkTask = {
  id: string;
  title: string;
  state: WorkTaskState;
  createdAt?: string;
  updatedAt?: string;
};

/** A conversation is Work only when its persisted first-class flag is true. */
export function isWorkConversation(conversation: Pick<WorkConversation, 'isWork'>): boolean {
  return conversation.isWork === true;
}

/**
 * Map a raw state from the run registry or the stored row onto a renderable
 * state. Anything unrecognised stays `unknown`; guessing here is what made
 * every history entry look like it was still running.
 */
export function normalizeWorkState(value: unknown): WorkTaskState {
  if (typeof value !== 'string') {
    return WORK_UNKNOWN_STATE;
  }
  return STATE_ALIASES[value.trim().toLowerCase()] ?? WORK_UNKNOWN_STATE;
}

export function isTerminalWorkState(state: string): boolean {
  const normalized = normalizeWorkState(state);
  return normalized === 'completed' || normalized === 'failed' || normalized === 'cancelled';
}

/** A state can only be claimed as finished when it maps to a known terminal one. */
export function isResolvedWorkState(state: string): boolean {
  return normalizeWorkState(state) !== WORK_UNKNOWN_STATE;
}

/**
 * The state a conversation row can justify on its own: whatever the server
 * stamped when the run settled, otherwise `unknown`. It deliberately does not
 * consult the title, timestamps or message count.
 */
export function resolveStoredWorkState(conversation: WorkConversation): WorkTaskState {
  return normalizeWorkState(conversation.workState);
}

/**
 * A title is derived once from the submitted task so the conversation list and
 * the Work history agree. Whitespace is collapsed, and the result is bounded so
 * a pasted document cannot become a sidebar entry.
 */
export function workTitle(task: string, maxLength = 80): string {
  const collapsed = task.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function isValidWorkTask(task: unknown): task is string {
  return typeof task === 'string' && task.trim().length > 0 && task.length <= WORK_MAX_TASK_LENGTH;
}

/**
 * Project a persisted conversation into the shape the Work surface renders.
 * `state` wins when the caller has live run state; otherwise the stored state
 * is used, and a row that has neither reports `unknown`.
 */
export function toWorkTask(conversation: WorkConversation, state?: string | null): WorkTask | null {
  if (!isWorkConversation(conversation)) {
    return null;
  }
  return {
    id: conversation.conversationId,
    title: conversation.title?.trim() || conversation.conversationId,
    state: state == null ? resolveStoredWorkState(conversation) : normalizeWorkState(state),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

/** Live run state for a conversation, when the caller has a registry to ask. */
export type WorkStateResolver = (conversation: WorkConversation) => string | null | undefined;

/**
 * Work history is newest-first and bounded. Ordering falls back to creation
 * time because a conversation may not have been touched since it was created.
 * `resolveState` supplies live run state; without it each row reports only what
 * it can prove.
 */
export function toWorkHistory(
  conversations: WorkConversation[],
  limit = 50,
  resolveState?: WorkStateResolver,
): WorkTask[] {
  return conversations
    .map((conversation) => toWorkTask(conversation, resolveState?.(conversation)))
    .filter((task): task is WorkTask => task !== null)
    .sort((a, b) => {
      const left = b.updatedAt ?? b.createdAt ?? '';
      const right = a.updatedAt ?? a.createdAt ?? '';
      return left.localeCompare(right);
    })
    .slice(0, limit);
}
