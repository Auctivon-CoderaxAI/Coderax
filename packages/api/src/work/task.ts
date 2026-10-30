/**
 * A Work task is a Coderax conversation, not a parallel task record. These
 * helpers keep that mapping in one place so the router and the client agree on
 * what counts as Work, how a task is titled, and when it is finished.
 */

/** Metadata marker stored on the conversation, alongside the normal convo fields. */
export const WORK_METADATA_KEY = 'work';

export const WORK_MAX_TASK_LENGTH = 4000;

/** States a Work run can report. Anything else is treated as still running. */
const TERMINAL_STATES = new Set([
  'complete',
  'completed',
  'done',
  'error',
  'failed',
  'success',
  'succeeded',
  'canceled',
  'cancelled',
]);

export type WorkConversation = {
  conversationId: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown> | null;
};

export type WorkTask = {
  id: string;
  title: string;
  state: string;
  createdAt?: string;
  updatedAt?: string;
};

/** A conversation is Work when its metadata carries the marker. */
export function isWorkConversation(conversation: {
  metadata?: Record<string, unknown> | null;
}): boolean {
  const metadata = conversation.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return metadata[WORK_METADATA_KEY] === true;
}

export function isTerminalWorkState(state: string): boolean {
  return TERMINAL_STATES.has(state.trim().toLowerCase());
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

/** Project a persisted conversation into the shape the Work surface renders. */
export function toWorkTask(conversation: WorkConversation, state = 'running'): WorkTask | null {
  if (!isWorkConversation(conversation)) {
    return null;
  }
  return {
    id: conversation.conversationId,
    title: conversation.title?.trim() || conversation.conversationId,
    state,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

/**
 * Work history is newest-first and bounded. Ordering falls back to creation
 * time because a conversation may not have been touched since it was created.
 */
export function toWorkHistory(conversations: WorkConversation[], limit = 50): WorkTask[] {
  return conversations
    .map((conversation) => toWorkTask(conversation))
    .filter((task): task is WorkTask => task !== null)
    .sort((a, b) => {
      const left = b.updatedAt ?? b.createdAt ?? '';
      const right = a.updatedAt ?? a.createdAt ?? '';
      return left.localeCompare(right);
    })
    .slice(0, limit);
}
