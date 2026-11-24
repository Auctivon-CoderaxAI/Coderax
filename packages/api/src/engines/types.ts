/**
 * Contract shared by every coding-agent execution engine.
 *
 * Execution engines run a task in a workspace and report what they did. They
 * never own Coderax persistence, streaming transport or authorization: the
 * caller passes a confined workspace, a task key and an abort signal, and the
 * engine reports normalized events. This keeps OpenCode and OpenHands
 * interchangeable without giving either one a second task runner.
 */

/** Coding-agent execution engines Coderax can select. */
export type EngineId = 'opencode' | 'openhands' | 'freebuff';

/**
 * Data modes are a security boundary, not a UI preference. Private content and
 * cloud content have separate workspaces and may not reference each other.
 */
export type DataMode = 'private' | 'cloud';

export type EngineFailureCode =
  | 'disabled'
  | 'sdk_unavailable'
  | 'not_configured'
  | 'server_unavailable'
  | 'workspace_denied'
  | 'busy'
  | 'timeout'
  | 'cancelled'
  | 'protocol_error'
  | 'provider_error';

export type EngineFailure = {
  ok: false;
  error: {
    code: EngineFailureCode;
    /** User-safe text: no stack, provider payload, path or credential. */
    message?: string;
    retryable?: boolean;
  };
  /**
   * Cancellation cleanup that must settle before task ownership is released.
   * A failed cleanup deliberately remains pending so ownership is not lost.
   */
  cleanup?: Promise<void>;
};

export type EngineSuccess<T> = { ok: true; value: T };

export type EngineResult<T> = EngineSuccess<T> | EngineFailure;

export function engineFailure(
  code: EngineFailureCode,
  message?: string,
  retryable = false,
): EngineFailure {
  return { ok: false, error: { code, retryable, ...(message ? { message } : {}) } };
}

export function engineFailureWithCleanup(
  code: EngineFailureCode,
  cleanup: Promise<void>,
  message?: string,
  retryable = false,
): EngineFailure {
  return { ...engineFailure(code, message, retryable), cleanup };
}

/** One normalized event from an engine run. */
export type EngineEvent =
  | { type: 'started'; sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text_replace'; text: string }
  | { type: 'tool_call'; callId: string; tool: string; input?: unknown }
  | { type: 'tool_result'; callId: string; tool: string; ok: boolean; output?: string }
  | { type: 'file_edit'; path: string }
  | {
      type: 'approval_required';
      callId: string;
      tool: string;
      description?: string;
    }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'completed'; sessionId: string; summary?: string }
  | { type: 'failed'; sessionId?: string; code: EngineFailureCode; message?: string }
  | { type: 'cancelled'; sessionId?: string };

export type EngineCapabilities = {
  streaming: boolean;
  tools: boolean;
  cancellation: boolean;
  /** True when the adapter accepts a provider/model selection per run. */
  modelSelection: boolean;
};

export type EngineRunRequest = {
  /** Stable identity of the logical task; one engine at a time may hold it. */
  taskKey: string;
  conversationId: string;
  prompt: string;
  mode: DataMode;
  workspaceRoot: string;
  model?: { providerId: string; modelId: string };
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type EngineRunSummary = {
  sessionId: string;
  toolCalls: number;
  edits: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Engine-reported final text, already bounded by the adapter. */
  summary?: string;
};

export type EngineRunHandle = {
  sessionId: string;
  events: AsyncIterable<EngineEvent>;
  cancel: () => Promise<void>;
  /** Resolves once the run reaches a terminal event or the stream closes. */
  result: Promise<EngineResult<EngineRunSummary>>;
  /**
   * Resolves after engine-side cancellation cleanup. The registry keeps the
   * task lease until this settles, so a new run cannot overlap an abort that is
   * still in flight.
   */
  cleanup?: Promise<void>;
  /** Releases engine-side resources; safe to call more than once. */
  close: () => Promise<void>;
};

export type EngineAvailability =
  | { available: true; reason: 'ready' }
  | {
      available: false;
      reason:
        | 'disabled'
        | 'sdk_unavailable'
        | 'not_configured'
        | 'server_unavailable'
        | 'model_missing'
        | 'context_too_small'
        | 'context_unavailable';
      /** User-safe explanation; never contains a key, token or absolute path. */
      detail: string;
    };

export type EngineAdapter = {
  id: EngineId;
  capabilities: EngineCapabilities;
  describe: () => EngineAvailability;
  /** Checks admission prerequisites when start itself verifies runtime readiness. */
  describeForStart?: () => EngineAvailability;
  /** Refreshes runtime readiness; safe adapters return before a bounded timeout. */
  probe?: () => Promise<void>;
  /** Starts one run. A failure here means no session and no side effect. */
  start: (request: EngineRunRequest) => Promise<EngineResult<EngineRunHandle>>;
};

/** Bounds applied to every adapter so one engine cannot hold a task forever. */
export type EngineLimits = {
  timeoutMs: number;
  /** Final text kept on the summary; the full stream is the transcript. */
  maxSummaryChars: number;
};
