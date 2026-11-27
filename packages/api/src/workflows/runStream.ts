/**
 * Cursors for the durable workflow run stream.
 *
 * A run keeps an append-only `events` log. Each entry is stamped with a `seq`
 * when it is written, and truncation drops the oldest entries, so a sequence is
 * stable for the lifetime of the run: replaying from it can neither skip nor
 * duplicate an event. Sequence 0 means "nothing delivered yet".
 */

export interface WorkflowRunStreamCursor {
  runId: string;
  sequence: number;
}

export interface SequencedRunEvent<T> {
  sequence: number;
  event: T;
}

interface SequencedEventLike {
  seq?: number;
}

/** The SSE `id` a run frame carries. Run ids are UUIDs, so the last colon splits. */
export function formatWorkflowRunStreamId(runId: string, sequence: number): string {
  return `${runId}:${sequence}`;
}

export function parseWorkflowRunStreamId(value: unknown): WorkflowRunStreamCursor | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  const split = trimmed.lastIndexOf(':');
  if (split <= 0 || split === trimmed.length - 1) {
    return null;
  }
  const runId = trimmed.slice(0, split);
  const raw = trimmed.slice(split + 1);
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const sequence = Number(raw);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    return null;
  }
  return { runId, sequence };
}

/**
 * The sequence an event was stored under. Rows written before the sequence was
 * persisted fall back to their position, which is only approximate once the log
 * has been truncated; every row written since carries its own.
 */
export function runEventSequence(event: SequencedEventLike, index: number): number {
  return typeof event.seq === 'number' && Number.isSafeInteger(event.seq) && event.seq > 0
    ? event.seq
    : index + 1;
}

/** The events a client that has acknowledged `afterSequence` still needs. */
export function sequenceRunEvents<T extends SequencedEventLike>(
  events: readonly T[] | undefined,
  afterSequence = 0,
): SequencedRunEvent<T>[] {
  const sequenced: SequencedRunEvent<T>[] = [];
  (events ?? []).forEach((event, index) => {
    const sequence = runEventSequence(event, index);
    if (sequence > afterSequence) {
      sequenced.push({ sequence, event });
    }
  });
  return sequenced;
}

/** The cursor a snapshot covers: every event it already contains. */
export function latestRunSequence(events: readonly SequencedEventLike[] | undefined): number {
  let latest = 0;
  (events ?? []).forEach((event, index) => {
    latest = Math.max(latest, runEventSequence(event, index));
  });
  return latest;
}

/** One server-sent event. `data` is serialized as a single JSON line. */
export function toServerSentEventFrame(frame: {
  event?: string;
  id?: string;
  data: unknown;
}): string {
  const lines: string[] = [];
  if (frame.event != null && frame.event.length > 0) {
    lines.push(`event: ${frame.event}`);
  }
  if (frame.id != null && frame.id.length > 0) {
    lines.push(`id: ${frame.id}`);
  }
  lines.push(`data: ${JSON.stringify(frame.data)}`);
  return `${lines.join('\n')}\n\n`;
}
