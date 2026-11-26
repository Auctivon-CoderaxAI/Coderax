import type {
  EngineAdapter,
  EngineAvailability,
  EngineFailureCode,
  EngineResult,
  EngineRunHandle,
  EngineRunRequest,
  EngineLimits,
} from '../types';
import type { ResolvedWorkspace, WorkspaceRoots } from '../workspace';
import type { EngineModelRef } from './models';
import { engineFailure, engineFailureWithCleanup } from '../types';
import { resolveEngineWorkspace } from '../workspace';
import { startWithModelFallback } from './fallback';
import { OpenCodeEventMapper } from './protocol';
import { createEngineRunHandle } from '../run';
import { openCodeAuthHeader } from './auth';
import { withDeadline } from '../deadline';

const CLEANUP_TIMEOUT_MS = 5_000;
/** Bound on watching one model attempt for its first substantive event. */
const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 60_000;
/** Bound on the authenticated server readiness probe. */
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * The transport is the only OpenCode-specific surface the adapter needs. The
 * production implementation is built from the official `@opencode-ai/sdk`
 * client in `sdk.ts`; tests supply the same contract without a network.
 */
export type OpenCodeTransport = {
  createSession: (input: { directory: string; title?: string }) => Promise<{ id: string }>;
  subscribe: (input: {
    directory: string;
    sessionId: string;
    signal?: AbortSignal;
  }) => Promise<AsyncIterable<unknown>>;
  prompt: (input: {
    sessionId: string;
    directory: string;
    text: string;
    model?: { providerId: string; modelId: string };
  }) => Promise<void>;
  abort: (input: { sessionId: string; directory: string }) => Promise<void>;
};

export type OpenCodeProbeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type OpenCodeProbeFetch = (
  input: string,
  init: { headers: Record<string, string>; redirect: 'error'; signal: AbortSignal },
) => Promise<OpenCodeProbeResponse>;

export type OpenCodeProbe = () => Promise<EngineAvailability>;

export type OpenCodeAdapterOptions = {
  enabled: boolean;
  transport?: OpenCodeTransport | null;
  unavailableDetail?: string;
  roots: WorkspaceRoots;
  limits: EngineLimits;
  /** Endpoint used by the bounded readiness probe and Basic authentication. */
  baseURL?: string;
  /** Server password; sourced from an environment variable by the service. */
  password?: string;
  /** Server username; the official server defaults to `opencode`. */
  username?: string;
  /** Bound on the readiness probe; the server must answer inside it. */
  probeTimeoutMs?: number;
  /** Injectable fetch for the probe; production uses global fetch. */
  fetchImpl?: OpenCodeProbeFetch;
  /** Injectable readiness check; production uses the authenticated probe. */
  probe?: OpenCodeProbe;
  /**
   * Ordered candidates for an automatic model choice. Empty means the run sends
   * no model and the server's own configured default applies, which is what a
   * pinned `engines.opencode.model` and a bare test transport both rely on.
   */
  models?: readonly EngineModelRef[];
  /** Bound on the first-event watch used to detect a provider refusal. */
  firstEventTimeoutMs?: number;
};

/** Attaching to an operator-run server is deliberate: no hidden child process. */
export function describeOpenCode(options: OpenCodeAdapterOptions): EngineAvailability {
  if (!options.enabled) {
    return {
      available: false,
      reason: 'disabled',
      detail: 'OpenCode is disabled in engines.opencode.enabled.',
    };
  }
  if (!options.transport) {
    return {
      available: false,
      reason: 'sdk_unavailable',
      detail:
        options.unavailableDetail ??
        'The OpenCode SDK is unavailable; install @opencode-ai/sdk on Node 22.12 or newer.',
    };
  }
  return { available: true, reason: 'ready' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function openCodeHealthUrl(baseURL: string): string {
  return new URL('global/health', baseURL.endsWith('/') ? baseURL : `${baseURL}/`).toString();
}

/**
 * Bounded, authenticated readiness check for the official server.
 *
 * `GET /global/health` returns `{ healthy: true, version }`; a 200 alone is not
 * enough because a proxy or a different service can answer it. The check uses
 * the same Basic credential as the SDK transport, never puts it in the URL, and
 * treats an unreachable, unauthenticated or unhealthy server as unavailable.
 * `describeOpenCode` is only configuration admission; this is the live gate.
 */
export async function probeOpenCode(
  options: OpenCodeAdapterOptions,
  signal?: AbortSignal,
): Promise<EngineAvailability> {
  const configured = describeOpenCode(options);
  if (!configured.available) {
    return configured;
  }
  if (!options.baseURL) {
    return {
      available: false,
      reason: 'not_configured',
      detail: 'engines.opencode.baseURL is required to reach the OpenCode server.',
    };
  }

  const timeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', abort, { once: true });
  }

  const auth = openCodeAuthHeader({
    ...(options.username ? { username: options.username } : {}),
    ...(options.password ? { password: options.password } : {}),
  });
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(auth ?? {}),
  };

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(openCodeHealthUrl(options.baseURL), {
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        available: false,
        reason: 'server_unavailable',
        detail:
          response.status === 401 || response.status === 403
            ? 'The OpenCode server rejected the configured credentials.'
            : 'The OpenCode server health check failed.',
      };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        available: false,
        reason: 'server_unavailable',
        detail: 'The OpenCode server returned an invalid health response.',
      };
    }
    if (!isRecord(body) || body.healthy !== true) {
      return {
        available: false,
        reason: 'server_unavailable',
        detail: 'The OpenCode server reported that it is not healthy.',
      };
    }
    return { available: true, reason: 'ready' };
  } catch {
    return {
      available: false,
      reason: 'server_unavailable',
      detail: `The OpenCode server could not be reached within ${timeoutMs} ms.`,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function failureCodeFor(availability: EngineAvailability): EngineFailureCode {
  switch (availability.reason) {
    case 'disabled':
      return 'disabled';
    case 'not_configured':
      return 'not_configured';
    case 'sdk_unavailable':
      return 'sdk_unavailable';
    default:
      return 'server_unavailable';
  }
}

/**
 * Follow the caller's abort signal with a controller owned by this task.
 *
 * This controller is never aborted by closing one attempt: a real run handle's
 * close() aborts its own controller, and doing that to the task controller would
 * cancel the next model candidate before it starts.
 */
function bindCancellation(request: EngineRunRequest): AbortController {
  const controller = new AbortController();
  if (request.signal?.aborted) {
    controller.abort();
  } else {
    request.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller;
}

/**
 * Start one OpenCode run in a confined workspace, pinned to one model.
 *
 * The session is created first, then the event stream is subscribed, then the
 * prompt is sent, so no early event is missed. Session creation, subscription
 * and prompt submission share one deadline; a late transport result is aborted
 * instead of becoming an untracked run. Every outcome goes through the shared
 * pump, which settles the run once.
 */
async function startOpenCodeAttempt(
  options: OpenCodeAdapterOptions,
  request: EngineRunRequest,
  workspace: ResolvedWorkspace,
  model: EngineModelRef | undefined,
  controller: AbortController,
): Promise<EngineResult<EngineRunHandle>> {
  const transport = options.transport;
  if (!transport) {
    return engineFailure('sdk_unavailable', 'The OpenCode transport is not available.');
  }
  const timeoutMs = request.timeoutMs ?? options.limits.timeoutMs;
  const deadline = Date.now() + timeoutMs;

  const abortSession = (sessionId: string): Promise<void> => {
    const active = options.transport;
    if (!active) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error('OpenCode session cancellation timed out'));
      }, CLEANUP_TIMEOUT_MS);
      active.abort({ sessionId, directory: workspace.root }).then(
        () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  };
  const retainOnFailure = (cleanup: Promise<void>): Promise<void> =>
    cleanup.catch(() => new Promise<void>(() => undefined));

  let sessionId: string;
  try {
    const sessionPromise = transport.createSession({
      directory: workspace.root,
      title: request.conversationId,
    });
    const outcome = await withDeadline(sessionPromise, deadline);
    if (!outcome.ok) {
      const cleanup = sessionPromise.then(
        (late) => abortSession(late.id),
        () => undefined,
      );
      return engineFailureWithCleanup(
        'timeout',
        retainOnFailure(cleanup),
        'The OpenCode server did not create a session before the deadline.',
        true,
      );
    }
    sessionId = outcome.value.id;
  } catch (error) {
    // Only a refused connection proves that the server never received the request.
    const refused = (cause: unknown) =>
      cause != null &&
      typeof cause === 'object' &&
      'code' in cause &&
      cause.code === 'ECONNREFUSED';
    return engineFailure(
      'server_unavailable',
      'The OpenCode session could not be confirmed.',
      refused(error) || (error instanceof Error && refused(error.cause)),
    );
  }
  if (!sessionId) {
    await abortSession(sessionId).catch(() => undefined);
    return engineFailure('protocol_error', 'The OpenCode server returned no session id.');
  }
  if (controller.signal.aborted) {
    await abortSession(sessionId).catch(() => undefined);
    return engineFailure('cancelled', 'The run was cancelled before it started.', false);
  }

  let stream: AsyncIterable<unknown>;
  try {
    const subscribePromise = transport.subscribe({
      directory: workspace.root,
      sessionId,
      signal: controller.signal,
    });
    const outcome = await withDeadline(subscribePromise, deadline);
    if (!outcome.ok) {
      const cleanup = subscribePromise.then(
        async (late) => {
          const iterator = late[Symbol.asyncIterator]();
          try {
            await iterator.return?.();
          } finally {
            await abortSession(sessionId);
          }
        },
        async () => {
          await abortSession(sessionId);
        },
      );
      return engineFailureWithCleanup(
        'timeout',
        retainOnFailure(cleanup),
        'The OpenCode event stream did not open before the deadline.',
        true,
      );
    }
    stream = outcome.value;
  } catch {
    /**
     * The session exists, so it is aborted and the task stays owned until that
     * settles. A failure after session creation is never replayed.
     */
    const abort = abortSession(sessionId);
    return engineFailureWithCleanup(
      'server_unavailable',
      retainOnFailure(abort),
      'The OpenCode event stream was unavailable.',
    );
  }
  if (controller.signal.aborted) {
    await abortSession(sessionId).catch(() => undefined);
    return engineFailure('cancelled', 'The run was cancelled before it started.', false);
  }

  const mapper = new OpenCodeEventMapper(sessionId);
  const handle = createEngineRunHandle({
    sessionId,
    stream,
    map: (raw) => mapper.map(raw),
    cancelRun: async () => {
      await abortSession(sessionId);
    },
    timeoutMs,
    maxSummaryChars: options.limits.maxSummaryChars,
    signal: controller.signal,
    abort: () => controller.abort(),
  });

  if (controller.signal.aborted) {
    await handle.close();
    return engineFailure('cancelled', 'The run was cancelled before it started.', false);
  }

  try {
    const promptPromise = transport.prompt({
      sessionId,
      directory: workspace.root,
      text: request.prompt,
      ...(model ? { model } : {}),
    });
    const outcome = await withDeadline(promptPromise, deadline);
    if (!outcome.ok) {
      const cleanup = promptPromise.then(
        () => abortSession(sessionId),
        () => undefined,
      );
      await handle.close();
      return engineFailureWithCleanup(
        'timeout',
        retainOnFailure(cleanup),
        'The OpenCode server did not accept the task before the deadline.',
        true,
      );
    }
  } catch {
    const cancelled = controller.signal.aborted;
    if (cancelled) {
      await abortSession(sessionId).catch(() => undefined);
      await handle.close();
      return engineFailure('cancelled', 'The run was cancelled before it started.', false);
    }
    /**
     * The prompt may already have been accepted before the transport threw, so
     * this failure is never replayed. The abort is retained as cleanup so task
     * ownership lasts until the engine settles.
     */
    const abort = abortSession(sessionId);
    await abort.catch(() => undefined);
    await handle.close();
    return engineFailureWithCleanup(
      'server_unavailable',
      retainOnFailure(abort),
      'The OpenCode server did not accept the task.',
    );
  }

  return { ok: true, value: handle };
}

/**
 * Start one OpenCode run in a confined workspace.
 *
 * A single candidate is started directly. When the adapter was given more than
 * one — an automatic model choice — the ordered candidates are attempted with a
 * bounded fallback: only a provider refusal retries, and only before the run
 * produced any text, tool call or file edit.
 */
export async function startOpenCodeRun(
  options: OpenCodeAdapterOptions,
  request: EngineRunRequest,
): Promise<EngineResult<EngineRunHandle>> {
  const availability = describeOpenCode(options);
  if (!availability.available) {
    return engineFailure(
      availability.reason === 'disabled' ? 'disabled' : 'sdk_unavailable',
      availability.detail,
    );
  }
  if (!options.transport) {
    return engineFailure(
      'sdk_unavailable',
      options.unavailableDetail ?? 'The OpenCode SDK is not available on this server.',
    );
  }
  if (!request.prompt.trim()) {
    return engineFailure('protocol_error', 'A task prompt is required.');
  }

  // Live readiness is checked before a workspace is resolved or a session is
  // created. A transport-only caller with no endpoint has already supplied its
  // own transport and is admitted by configuration.
  let runtime: EngineAvailability;
  if (options.probe) {
    runtime = await options.probe();
  } else if (options.baseURL) {
    runtime = await probeOpenCode(options, request.signal);
  } else {
    runtime = availability;
  }
  if (request.signal?.aborted) {
    return engineFailure('cancelled', 'The run was cancelled before it started.', false);
  }
  if (!runtime.available) {
    return engineFailure(failureCodeFor(runtime), runtime.detail);
  }

  const resolved = await resolveEngineWorkspace({
    mode: request.mode,
    requestedRoot: request.workspaceRoot,
    roots: options.roots,
  });
  if (!resolved.ok) {
    return resolved;
  }
  const workspace = resolved.value;

  const taskController = bindCancellation(request);
  if (taskController.signal.aborted) {
    return engineFailure('cancelled', 'The run was cancelled before it started.', false);
  }

  const candidates: Array<EngineModelRef | undefined> = request.model
    ? [request.model]
    : (options.models ?? []).slice();
  if (candidates.length === 0) {
    candidates.push(undefined);
  }

  const attempts = candidates.map((model) => () => {
    const attemptController = new AbortController();
    const abortAttempt = (): void => attemptController.abort();
    if (taskController.signal.aborted) {
      attemptController.abort();
    } else {
      taskController.signal.addEventListener('abort', abortAttempt, { once: true });
    }
    return startOpenCodeAttempt(options, request, workspace, model, attemptController);
  });
  if (attempts.length === 1) {
    return attempts[0]();
  }
  return startWithModelFallback({
    attempts,
    firstEventTimeoutMs: options.firstEventTimeoutMs ?? DEFAULT_FIRST_EVENT_TIMEOUT_MS,
    signal: taskController.signal,
  });
}

export const openCodeCapabilities = {
  streaming: true,
  tools: true,
  cancellation: true,
  modelSelection: true,
} as const;

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions): EngineAdapter {
  let runtimeAvailability: EngineAvailability | null = null;
  let statusProbe: Promise<void> | null = null;
  let sequence = 0;
  let published = 0;

  async function refresh(signal?: AbortSignal): Promise<EngineAvailability> {
    const id = ++sequence;
    let availability: EngineAvailability;
    try {
      availability = await probeOpenCode(options, signal);
    } catch {
      availability = {
        available: false,
        reason: 'server_unavailable',
        detail: 'The OpenCode server readiness probe failed.',
      };
    }
    if (!signal?.aborted && id > published) {
      published = id;
      runtimeAvailability = availability;
    }
    return availability;
  }

  const unverified = (): EngineAvailability => {
    const configured = describeOpenCode(options);
    if (!configured.available) {
      return configured;
    }
    return {
      available: false,
      reason: 'server_unavailable',
      detail: 'The OpenCode server readiness has not been verified.',
    };
  };

  return {
    id: 'opencode',
    capabilities: openCodeCapabilities,
    // A configured server is not ready until its probe succeeds. Start
    // admission remains configuration-only so start() can return the probe's
    // specific failure instead of a generic refusal.
    describe: () => runtimeAvailability ?? unverified(),
    describeForStart: () => describeOpenCode(options),
    probe: async () => {
      if (!statusProbe) {
        statusProbe = refresh()
          .then(() => undefined)
          .finally(() => {
            statusProbe = null;
          });
      }
      await statusProbe;
    },
    // Only an adapter with an endpoint can probe readiness. A transport-only
    // caller has already supplied its own connection, so start admission is the
    // configuration check, exactly as `startOpenCodeRun` handles that case.
    start: (request) =>
      startOpenCodeRun(
        options.baseURL == null ? options : { ...options, probe: () => refresh(request.signal) },
        request,
      ),
  };
}
