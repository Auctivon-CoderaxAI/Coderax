/**
 * Per-model-call latency, measured on this side of the model call and persisted
 * on the response message as `metadata.modelTiming`.
 *
 * Ollama's OpenAI-compatible `/v1/chat/completions` does report native runtime
 * metrics: a `timings` object (`prompt_n`, `prompt_ms`, `predicted_n`,
 * `predicted_ms`) beside `usage`. It is an Ollama extension rather than an
 * OpenAI field, so the OpenAI SDK parses it away and it never reaches
 * `usage_metadata`; reading it would take a tap on the HTTP response itself.
 * Everything below is therefore measured from the SDK's events, and is not a
 * server-side metric.
 *
 * Those events cannot measure time-to-first-token on the installed
 * `@librechat/agents` (4.0.4). It defines `GraphEvents.CHAT_MODEL_START`
 * (`on_chat_model_start`) but never dispatches it, and the only event that marks
 * a model call's beginning — the `message_creation` run step — is dispatched by
 * the streaming handler from the chunk carrying the call's first delta. A
 * `run_step` anchor therefore opens at or after the first token, and timing it
 * would report a few milliseconds of streaming overhead as if it were the wait
 * for a reply. It bounds decode only. A `model_start` anchor is the request
 * boundary, and is measured whenever an SDK emits it.
 *
 * Nothing is guessed. A call with no start anchor yields no entry, a call whose
 * first delta preceded its anchor yields no first-token figure, and every field
 * that cannot be derived stays absent rather than zero — a fabricated latency
 * is indistinguishable from a measured one, while an absent one reads as "not
 * measured".
 */

/**
 * Where a call's start came from. `model_start` is the request boundary, so it
 * bounds time-to-first-token; `run_step` opens with the call's first chunk, so
 * it bounds decode only.
 */
export type ModelTimingAnchor = 'model_start' | 'run_step';

/**
 * Bounded so a long agent run cannot bloat the persisted message. The first
 * calls of a turn are the ones that explain its first-token latency, so those
 * are the ones kept.
 */
export const MAX_MODEL_CALL_TIMINGS = 20;

export interface ModelCallTiming {
  /** Which event anchored {@link ModelCallTiming.firstTokenMs}. */
  anchor: ModelTimingAnchor;
  stepId?: string;
  model?: string;
  provider?: string;
  /**
   * Milliseconds from a `model_start` anchor to the first streamed reasoning or
   * text delta. Absent for `run_step` anchors, and for a call whose first delta
   * arrived before its anchor.
   */
  firstTokenMs?: number;
  /** Milliseconds spent streaming output after that first delta. */
  decodeMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  /** Output tokens per second across {@link ModelCallTiming.decodeMs}. */
  outputTokensPerSecond?: number;
}

/** The provider-reported fields this module reads; the rest of a usage payload is ignored. */
export interface ModelTimingUsage {
  input_tokens?: number;
  output_tokens?: number;
  output_token_details?: { reasoning?: number; reasoning_tokens?: number };
  model?: string;
  provider?: string;
}

export interface ModelCallStart {
  anchor: ModelTimingAnchor;
  stepId?: string;
  observedAt?: number;
}

export interface ModelTimingTracker {
  /** Opens a call's window. The first anchor observed for a call is kept. */
  start(key: string, start: ModelCallStart): void;
  /**
   * Records the call's first streamed delta. Later deltas are ignored. A delta
   * that arrives before the call's window opens marks its anchor as late, which
   * suppresses first-token latency for that call.
   */
  firstDelta(key: string, observedAt?: number): void;
  /** Closes the call and returns what was derived; the window is cleared either way. */
  end(
    key: string,
    usage?: ModelTimingUsage | null,
    observedAt?: number,
  ): ModelCallTiming | undefined;
  /** Returns every timing recorded so far, oldest first, and clears the collection. */
  take(): ModelCallTiming[];
}

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const timestamp = (value: unknown): number | undefined => {
  const number = finiteNumber(value);
  return number != null && number >= 0 ? number : undefined;
};

const tokenCount = (value: unknown): number | undefined => {
  const number = timestamp(value);
  return number == null ? undefined : Math.floor(number);
};

type CallWindow = {
  anchor: ModelTimingAnchor;
  stepId?: string;
  startedAt: number;
  firstTokenAt?: number;
  /** A delta arrived before this window opened, so `startedAt` is not the call's start. */
  lateAnchor: boolean;
};

export function createModelTimingTracker({
  now = () => Date.now(),
}: { now?: () => number } = {}): ModelTimingTracker {
  const windows = new Map<string, CallWindow>();
  /** First delta seen per key while no window was open, i.e. before its anchor. */
  const orphanDeltas = new Map<string, number>();
  const completed: ModelCallTiming[] = [];

  return {
    start(key, { anchor, stepId, observedAt }) {
      if (windows.has(key)) {
        return;
      }
      const orphanedAt = orphanDeltas.get(key);
      if (orphanedAt != null) {
        orphanDeltas.delete(key);
      }
      windows.set(key, {
        anchor,
        ...(stepId == null ? {} : { stepId }),
        startedAt: timestamp(observedAt) ?? now(),
        lateAnchor: orphanedAt != null,
      });
    },

    firstDelta(key, observedAt) {
      const at = timestamp(observedAt) ?? now();
      const call = windows.get(key);
      if (call == null) {
        if (!orphanDeltas.has(key)) {
          orphanDeltas.set(key, at);
        }
        return;
      }
      if (call.firstTokenAt != null || call.lateAnchor) {
        return;
      }
      if (at < call.startedAt) {
        call.lateAnchor = true;
        return;
      }
      call.firstTokenAt = at;
    },

    end(key, usage, observedAt) {
      const call = windows.get(key);
      if (call == null) {
        /** The call never anchored, so its delta must not mark a later call late. */
        orphanDeltas.delete(key);
        return undefined;
      }
      windows.delete(key);

      const endedAt = timestamp(observedAt) ?? now();
      const firstTokenAt = call.firstTokenAt;
      const firstTokenMs =
        call.anchor !== 'model_start' || call.lateAnchor || firstTokenAt == null
          ? undefined
          : Math.max(0, firstTokenAt - call.startedAt);
      const decodeMs = firstTokenAt == null ? undefined : Math.max(0, endedAt - firstTokenAt);

      const promptTokens = tokenCount(usage?.input_tokens);
      const outputTokens = tokenCount(usage?.output_tokens);
      const reasoningTokens = tokenCount(
        usage?.output_token_details?.reasoning ?? usage?.output_token_details?.reasoning_tokens,
      );

      const timing: ModelCallTiming = {
        anchor: call.anchor,
        ...(call.stepId == null ? {} : { stepId: call.stepId }),
        ...(usage?.model == null ? {} : { model: usage.model }),
        ...(usage?.provider == null ? {} : { provider: usage.provider }),
        ...(firstTokenMs == null ? {} : { firstTokenMs }),
        ...(decodeMs == null ? {} : { decodeMs }),
        ...(promptTokens == null ? {} : { promptTokens }),
        ...(outputTokens == null ? {} : { outputTokens }),
        ...(reasoningTokens == null ? {} : { reasoningTokens }),
        ...(decodeMs == null || decodeMs <= 0 || outputTokens == null || outputTokens <= 0
          ? {}
          : { outputTokensPerSecond: Math.round((outputTokens * 10000) / decodeMs) / 10 }),
      };

      if (completed.length < MAX_MODEL_CALL_TIMINGS) {
        completed.push(timing);
      }
      return timing;
    },

    take() {
      orphanDeltas.clear();
      return completed.splice(0, completed.length);
    },
  };
}
