import type { z } from 'zod';
import type {
  AgentList,
  CancelRequest,
  ChatReply,
  ChatRequest,
  Conversation,
  ConversationList,
  ExecutionEvent,
  HealthReport,
  MemoryList,
  ModelList,
  NotificationList,
  PermissionDecisionRequest,
  PermissionList,
  Problem,
  ReadinessReport,
  ResumeRequest,
  RetryRequest,
  TaskAccepted,
  TaskControlResult,
  TaskStatus,
  WorkSubmitRequest,
} from './contracts';
import { contractSchemas, isTerminalEvent } from './contracts';
import { DEFAULT_CONTRACT_VERSION } from './config';
import { readSseFrames, SseReadError } from './sse';

const schemas = contractSchemas();

/**
 * The only Coderax-side HTTP client for the WorkflowEngine.
 *
 * Credentials never leave this module: the caller supplies a token that was read
 * from the server environment, and every owner operation attaches it as an
 * `Authorization` header. The token is never placed in a URL, a log line or an
 * error, redirects are refused, and every documented response is parsed with the
 * contract schema before a caller sees it. A shape the contract does not
 * describe is a protocol error, not a value.
 */

export type GatewayFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect: 'error';
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  body: ReadableStream<Uint8Array> | null;
}>;

export type GatewayTransportErrorCode =
  | 'engine_unreachable'
  | 'engine_timeout'
  | 'submission_outcome_unknown'
  | 'protocol_error'
  | 'engine_unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'conflict'
  | 'busy'
  | 'not_ready'
  | 'engine_not_configured'
  | 'model_missing'
  | 'workspace_denied'
  | 'budget_exhausted'
  | 'paid_model_refused'
  | 'permission_required'
  | 'cancelled'
  | 'internal_error';

export class GatewayTransportError extends Error {
  readonly code: GatewayTransportErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly requestId?: string;
  /** Safe to show a user; never a stack, URL, header or token. */
  readonly detail?: string;

  constructor(
    code: GatewayTransportErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; requestId?: string; detail?: string } = {},
  ) {
    super(message);
    this.name = 'GatewayTransportError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.requestId = options.requestId;
    this.detail = options.detail;
  }
}

export type EngineClient = {
  contractVersion: string;
  health: (signal?: AbortSignal) => Promise<HealthReport>;
  readiness: (signal?: AbortSignal) => Promise<ReadinessReport>;
  listAgents: (signal?: AbortSignal) => Promise<AgentList>;
  listModels: (signal?: AbortSignal) => Promise<ModelList>;
  listConversations: (signal?: AbortSignal) => Promise<ConversationList>;
  getConversation: (conversationId: string, signal?: AbortSignal) => Promise<Conversation>;
  listMemory: (mode: 'private' | 'cloud', signal?: AbortSignal) => Promise<MemoryList>;
  listPermissions: (taskId: string, signal?: AbortSignal) => Promise<PermissionList>;
  decidePermission: (
    taskId: string,
    body: PermissionDecisionRequest,
    signal?: AbortSignal,
  ) => Promise<PermissionList>;
  listNotifications: (signal?: AbortSignal) => Promise<NotificationList>;
  getTask: (taskId: string, signal?: AbortSignal) => Promise<TaskStatus>;
  submitWork: (body: WorkSubmitRequest, signal?: AbortSignal) => Promise<TaskAccepted>;
  cancelTask: (
    taskId: string,
    body: CancelRequest,
    signal?: AbortSignal,
  ) => Promise<TaskControlResult>;
  resumeTask: (
    taskId: string,
    body: ResumeRequest,
    signal?: AbortSignal,
  ) => Promise<TaskControlResult>;
  retryTask: (
    taskId: string,
    body: RetryRequest,
    signal?: AbortSignal,
  ) => Promise<TaskControlResult>;
  submitChat: (body: ChatRequest, signal?: AbortSignal) => Promise<ChatOutcome>;
  /** Replay from `after`, then tail; deduplicated and gap-resynced. */
  streamTaskEvents: (
    taskId: string,
    after: number,
    signal?: AbortSignal,
  ) => AsyncIterable<ExecutionEvent>;
  /** Pinned contract version this client validates against. */
  expectedContractVersion: string;
};

export type ChatStreamFrame =
  | { kind: 'event'; event: ExecutionEvent }
  | { kind: 'reply'; reply: ChatReply };

export type ChatOutcome =
  | { kind: 'json'; reply: ChatReply }
  | { kind: 'stream'; frames: AsyncIterable<ChatStreamFrame> };

export type EngineClientOptions = {
  baseURL: string;
  token: string;
  contractVersion?: string;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  fetch?: GatewayFetch;
};

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_RESYNCS = 3;

const PROBLEM_CODES: Readonly<Record<string, GatewayTransportErrorCode>> = Object.freeze({
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  not_found: 'not_found',
  validation_failed: 'validation_failed',
  conflict: 'conflict',
  busy: 'busy',
  not_ready: 'not_ready',
  engine_unavailable: 'engine_unavailable',
  engine_not_configured: 'engine_not_configured',
  model_missing: 'model_missing',
  workspace_denied: 'workspace_denied',
  budget_exhausted: 'budget_exhausted',
  paid_model_refused: 'paid_model_refused',
  permission_required: 'permission_required',
  cancelled: 'cancelled',
  protocol_error: 'protocol_error',
  internal_error: 'internal_error',
});

function joinURL(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

function parseBody<T extends z.ZodTypeAny>(schema: T, text: string): z.infer<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GatewayTransportError('protocol_error', 'The engine returned invalid JSON.');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new GatewayTransportError(
      'protocol_error',
      'The engine response did not match the pinned contract.',
    );
  }
  return result.data;
}

function parseProblem(text: string): Problem | null {
  try {
    const parsed = schemas.Problem.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function errorFromResponse(status: number, text: string): GatewayTransportError {
  const problem = parseProblem(text);
  if (problem != null) {
    return new GatewayTransportError(
      PROBLEM_CODES[problem.code] ?? 'engine_unavailable',
      problem.title,
      {
        status,
        retryable: problem.retryable,
        ...(problem.requestId == null ? {} : { requestId: problem.requestId }),
      },
    );
  }
  if (status === 401) {
    return new GatewayTransportError('unauthorized', 'The engine rejected the server credential.', {
      status,
      retryable: false,
    });
  }
  if (status === 403) {
    return new GatewayTransportError('forbidden', 'The engine refused this operation.', {
      status,
      retryable: false,
    });
  }
  return new GatewayTransportError(
    'engine_unavailable',
    'The engine did not return a documented error.',
    { status, retryable: status >= 500 },
  );
}

/** Errors that prove the request never reached the engine. */
const NOT_DELIVERED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_INVALID_URL',
]);

function definitelyNotDelivered(cause: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = cause;
  while (current != null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      return NOT_DELIVERED_CODES.has(code);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function unknownSubmission(detail: string): GatewayTransportError {
  return new GatewayTransportError('submission_outcome_unknown', detail, { detail });
}

function networkError(cause: unknown): GatewayTransportError {
  if (cause instanceof GatewayTransportError) {
    return cause;
  }
  const name = typeof cause === 'object' && cause != null && 'name' in cause ? cause.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new GatewayTransportError('engine_timeout', 'The engine did not answer in time.', {
      retryable: true,
    });
  }
  return new GatewayTransportError('engine_unreachable', 'The engine could not be reached.', {
    retryable: true,
  });
}

type BodyReader = {
  getReader: () => {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
    cancel: (reason?: unknown) => Promise<void>;
    releaseLock: () => void;
  };
};

/**
 * Reads a response body under a deadline without buffering an unbounded body.
 * `response.text()` alone cannot be cancelled, so a stalled or oversized body
 * would otherwise outlive the configured request timeout.
 */
async function readBoundedBody(
  response: { text?: () => Promise<string>; body: unknown },
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forward = (): void => controller.abort();
  if (signal != null) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', forward, { once: true });
    }
  }
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectAborted = (): void => reject(new Error('aborted'));
    if (controller.signal.aborted) {
      rejectAborted();
      return;
    }
    controller.signal.addEventListener('abort', rejectAborted, { once: true });
  });

  const decode = async (): Promise<string> => {
    const body = response.body as BodyReader | null;
    if (body == null || typeof body.getReader !== 'function') {
      return response.text?.() ?? '';
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await Promise.race([reader.read(), aborted]);
        if (chunk.done) {
          break;
        }
        if (chunk.value != null) {
          bytes += chunk.value.byteLength;
          if (bytes > MAX_JSON_BYTES) {
            throw new GatewayTransportError('protocol_error', 'The engine response was too large.');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
      }
      return text + decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  };

  try {
    const raw = await Promise.race([decode(), aborted]);
    if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BYTES) {
      throw new GatewayTransportError('protocol_error', 'The engine response was too large.');
    }
    return raw;
  } catch (cause) {
    if (cause instanceof GatewayTransportError) {
      throw cause;
    }
    if (signal?.aborted) {
      throw new GatewayTransportError('cancelled', 'The engine request was cancelled.');
    }
    if (timedOut) {
      throw new GatewayTransportError('engine_timeout', 'The engine did not answer in time.', {
        retryable: true,
      });
    }
    throw networkError(cause);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

export function createEngineClient(options: EngineClientOptions): EngineClient {
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as GatewayFetch);
  if (typeof doFetch !== 'function') {
    throw new GatewayTransportError('engine_unreachable', 'No HTTP transport is available.');
  }
  const expectedContractVersion = DEFAULT_CONTRACT_VERSION;
  if (options.contractVersion != null && options.contractVersion !== expectedContractVersion) {
    throw new GatewayTransportError(
      'protocol_error',
      'Unsupported WorkflowEngine contract version.',
    );
  }

  function linkedController(signal: AbortSignal | undefined, timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
      signal: signal == null ? controller.signal : AbortSignal.any([signal, controller.signal]),
      dispose: () => clearTimeout(timer),
    };
  }

  async function request<T extends z.ZodTypeAny>(
    path: string,
    schema: T,
    init: {
      method: 'GET' | 'POST';
      body?: unknown;
      auth: 'owner' | 'public';
      signal?: AbortSignal;
      timeoutMs?: number;
      acceptNonOk?: (status: number, text: string) => boolean;
    },
  ): Promise<z.infer<T>> {
    const link = linkedController(init.signal, init.timeoutMs ?? options.requestTimeoutMs);
    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'x-coderax-client': 'coderax-workflow-engine-gateway',
        'x-coderax-contract-version': expectedContractVersion,
      };
      if (init.auth === 'owner') {
        headers.authorization = `Bearer ${options.token}`;
      }
      if (init.body !== undefined) {
        headers['content-type'] = 'application/json';
      }
      const submission = path === '/v1/work' && init.method === 'POST';
      let response: Awaited<ReturnType<GatewayFetch>>;
      try {
        response = await doFetch(joinURL(options.baseURL, path), {
          method: init.method,
          headers,
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          signal: link.signal,
          redirect: 'error',
        });
      } catch (cause) {
        // A refused connection cannot have created a task. A timeout, reset or
        // abort after the request was written may have, and the contract has no
        // submission deduplication, so the outcome is unknown rather than a
        // failure the caller may safely retry.
        if (submission && !definitelyNotDelivered(cause)) {
          throw unknownSubmission(
            'The engine may have accepted the work, but its response was not received.',
          );
        }
        throw networkError(cause);
      }
      let text: string;
      try {
        text = await readBoundedBody(
          response,
          init.timeoutMs ?? options.requestTimeoutMs,
          init.signal,
        );
      } catch (cause) {
        if (submission) {
          // The engine may have created a task. The contract has no submission deduplication.
          throw unknownSubmission(
            'The engine may have accepted the work, but its response could not be read.',
          );
        }
        throw cause;
      }
      if (!response.ok && !init.acceptNonOk?.(response.status, text)) {
        throw errorFromResponse(response.status, text);
      }
      try {
        return parseBody(schema, text);
      } catch (cause) {
        if (submission && response.ok) {
          // An accepted submission with an undocumented body is still accepted.
          throw unknownSubmission(
            'The engine may have accepted the work, but its response was not recognised.',
          );
        }
        throw cause;
      }
    } finally {
      link.dispose();
    }
  }

  async function openStream(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal },
  ): Promise<Awaited<ReturnType<GatewayFetch>>> {
    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      authorization: `Bearer ${options.token}`,
      'x-coderax-client': 'coderax-workflow-engine-gateway',
      'x-coderax-contract-version': expectedContractVersion,
    };
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const link = linkedController(init.signal, options.requestTimeoutMs);
    try {
      return await doFetch(joinURL(options.baseURL, path), {
        method: init.method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: link.signal,
        redirect: 'error',
      });
    } catch (cause) {
      throw networkError(cause);
    } finally {
      // The deadline covers only the wait for response headers. Body lifetime is
      // governed by caller cancellation and the SSE idle deadline.
      link.dispose();
    }
  }

  async function nonOkResponse(
    response: Awaited<ReturnType<GatewayFetch>>,
    signal?: AbortSignal,
  ): Promise<never> {
    const text = await readBoundedBody(response, options.requestTimeoutMs, signal);
    throw errorFromResponse(response.status, text);
  }

  async function* chatFrames(
    response: Awaited<ReturnType<GatewayFetch>>,
    signal: AbortSignal | undefined,
  ): AsyncIterable<ChatStreamFrame> {
    for await (const frame of readSseFrames(response.body, {
      idleTimeoutMs: options.streamIdleTimeoutMs,
      ...(signal == null ? {} : { signal }),
    })) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(frame.data);
      } catch {
        throw new GatewayTransportError(
          'protocol_error',
          'The engine stream carried invalid JSON.',
        );
      }
      const event = schemas.ExecutionEvent.safeParse(parsed);
      if (event.success) {
        yield { kind: 'event', event: event.data };
        continue;
      }
      const reply = schemas.ChatReply.safeParse(parsed);
      if (reply.success) {
        yield { kind: 'reply', reply: reply.data };
        continue;
      }
      throw new GatewayTransportError(
        'protocol_error',
        'The engine stream carried an undocumented frame.',
      );
    }
  }

  async function* taskEvents(
    taskId: string,
    after: number,
    signal: AbortSignal | undefined,
  ): AsyncIterable<ExecutionEvent> {
    let lastSeq = after;
    let stalledResyncs = 0;
    const encoded = encodeURIComponent(taskId);
    for (;;) {
      if (signal?.aborted) {
        return;
      }
      const previousSeq = lastSeq;
      const response = await openStream(`/v1/work/${encoded}/events?after=${lastSeq}`, {
        method: 'GET',
        ...(signal == null ? {} : { signal }),
      });
      if (!response.ok) {
        await nonOkResponse(response, signal);
      }
      let terminal = false;
      let gap = false;
      const seen = new Set<string>();
      try {
        for await (const frame of readSseFrames(response.body, {
          idleTimeoutMs: options.streamIdleTimeoutMs,
          ...(signal == null ? {} : { signal }),
        })) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(frame.data);
          } catch {
            throw new GatewayTransportError(
              'protocol_error',
              'The engine stream carried invalid JSON.',
            );
          }
          const event = schemas.ExecutionEvent.safeParse(parsed);
          if (!event.success) {
            throw new GatewayTransportError(
              'protocol_error',
              'The engine event did not match the pinned contract.',
            );
          }
          if (event.data.taskId !== taskId) {
            throw new GatewayTransportError('protocol_error', 'The engine stream crossed tasks.');
          }
          if (seen.has(event.data.eventId)) {
            continue;
          }
          seen.add(event.data.eventId);
          // `seq <= lastSeq` is a replay of an event already delivered.
          if (event.data.seq <= lastSeq) {
            continue;
          }
          if (event.data.seq > lastSeq + 1) {
            gap = true;
            break;
          }
          lastSeq = event.data.seq;
          yield event.data;
          if (isTerminalEvent(event.data.type)) {
            terminal = true;
            break;
          }
        }
      } catch (error) {
        if (signal?.aborted || !(error instanceof SseReadError)) {
          throw error;
        }
        // A failed body read or partial frame can replay from the same cursor as an early EOF.
      }
      if (terminal || signal?.aborted) {
        return;
      }
      stalledResyncs = lastSeq === previousSeq ? stalledResyncs + 1 : 0;
      // A gap, or a close without a terminal event, is resynchronised from the
      // exact last delivered sequence rather than silently skipped.
      if (stalledResyncs > MAX_EVENT_RESYNCS && !gap) {
        throw new GatewayTransportError(
          'protocol_error',
          'The engine event stream ended without a terminal event.',
        );
      }
      if (stalledResyncs > MAX_EVENT_RESYNCS + 3) {
        throw new GatewayTransportError(
          'protocol_error',
          'The engine event stream could not be resynchronised.',
        );
      }
    }
  }

  return {
    contractVersion: expectedContractVersion,
    expectedContractVersion,
    health: (signal) =>
      request('/v1/health', schemas.HealthReport, { method: 'GET', auth: 'public', signal }),
    readiness: (signal) =>
      request('/v1/ready', schemas.ReadinessReport, {
        method: 'GET',
        auth: 'public',
        signal,
        acceptNonOk: (status, text) => {
          if (status !== 503) return false;
          try {
            const report = schemas.ReadinessReport.safeParse(JSON.parse(text));
            return report.success && !report.data.ready;
          } catch {
            return false;
          }
        },
      }),
    listAgents: (signal) =>
      request('/v1/agents', schemas.AgentList, { method: 'GET', auth: 'owner', signal }),
    listModels: (signal) =>
      request('/v1/models', schemas.ModelList, { method: 'GET', auth: 'owner', signal }),
    listConversations: (signal) =>
      request('/v1/conversations', schemas.ConversationList, {
        method: 'GET',
        auth: 'owner',
        signal,
      }),
    getConversation: (conversationId, signal) =>
      request(`/v1/conversations/${encodeURIComponent(conversationId)}`, schemas.Conversation, {
        method: 'GET',
        auth: 'owner',
        signal,
      }),
    listMemory: (mode, signal) =>
      request(`/v1/memory?mode=${mode}`, schemas.MemoryList, {
        method: 'GET',
        auth: 'owner',
        signal,
      }),
    listPermissions: (taskId, signal) =>
      request(`/v1/work/${encodeURIComponent(taskId)}/permissions`, schemas.PermissionList, {
        method: 'GET',
        auth: 'owner',
        signal,
      }),
    decidePermission: (taskId, body, signal) =>
      request(`/v1/work/${encodeURIComponent(taskId)}/permissions`, schemas.PermissionList, {
        method: 'POST',
        body,
        auth: 'owner',
        signal,
      }),
    listNotifications: (signal) =>
      request('/v1/notifications', schemas.NotificationList, {
        method: 'GET',
        auth: 'owner',
        signal,
      }),
    getTask: (taskId, signal) =>
      request(`/v1/work/${encodeURIComponent(taskId)}`, schemas.TaskStatus, {
        method: 'GET',
        auth: 'owner',
        signal,
      }),
    submitWork: (body, signal) =>
      request('/v1/work', schemas.TaskAccepted, { method: 'POST', body, auth: 'owner', signal }),
    cancelTask: (taskId, body, signal) =>
      request(`/v1/work/${encodeURIComponent(taskId)}/cancel`, schemas.TaskControlResult, {
        method: 'POST',
        body,
        auth: 'owner',
        signal,
      }),
    resumeTask: (taskId, body, signal) =>
      request(`/v1/work/${encodeURIComponent(taskId)}/resume`, schemas.TaskControlResult, {
        method: 'POST',
        body,
        auth: 'owner',
        signal,
      }),
    retryTask: (taskId, body, signal) =>
      request(`/v1/work/${encodeURIComponent(taskId)}/retry`, schemas.TaskControlResult, {
        method: 'POST',
        body,
        auth: 'owner',
        signal,
      }),
    submitChat: async (body, signal) => {
      const response = await openStream('/v1/chat', { method: 'POST', body, signal });
      if (!response.ok) {
        await nonOkResponse(response, signal);
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        return { kind: 'stream', frames: chatFrames(response, signal) };
      }
      const text = await readBoundedBody(response, options.requestTimeoutMs, signal);
      return { kind: 'json', reply: parseBody(schemas.ChatReply, text) };
    },
    streamTaskEvents: (taskId, after, signal) => taskEvents(taskId, after, signal),
  };
}
