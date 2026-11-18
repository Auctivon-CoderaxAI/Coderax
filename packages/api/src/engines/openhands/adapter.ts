import type {
  EngineAdapter,
  EngineAvailability,
  EngineEvent,
  EngineFailureCode,
  EngineLimits,
  EngineResult,
  EngineRunHandle,
  EngineRunRequest,
} from '../types';
import type { WorkspaceRoots } from '../workspace';
import { engineFailure, engineFailureWithCleanup } from '../types';
import { resolveEngineWorkspace } from '../workspace';
import { createEngineRunHandle } from '../run';
import { withDeadline } from '../deadline';

/**
 * OpenHands Agent Server event mapping.
 *
 * The official OpenHands Software Agent SDK is Python; the supported
 * TypeScript surface is `@openhands/typescript-client`, an alpha client that
 * can only talk to a remote Agent Server. Coderax therefore treats OpenHands
 * as an opt-in remote engine and keeps its event names isolated here, so a
 * future stable SDK changes one file.
 */

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const MAX_OUTPUT = 8_000;
const CLEANUP_TIMEOUT_MS = 5_000;

function retainOnFailure(cleanup: Promise<void>): Promise<void> {
  return cleanup.catch(() => new Promise<void>(() => undefined));
}

async function boundedCancel(
  transport: OpenHandsTransport,
  conversationId: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('OpenHands cancellation timed out')),
      CLEANUP_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([transport.cancel(conversationId), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function bounded(text: string): string {
  return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}…`;
}

/** Action kinds map onto Coderax's tool names. */
function toolForAction(action: Json): string | undefined {
  const kind = str(action.kind);
  switch (kind) {
    case 'BashAction':
    case 'CmdRunAction':
      return 'bash';
    case 'FileEditAction':
    case 'FileWriteAction':
    case 'StrReplaceEditorAction':
      return 'edit';
    case 'ReadAction':
      return 'read';
    case 'BrowseAction':
    case 'BrowseInteractiveAction':
      return 'browser';
    case 'MCPAction':
      return str(action.tool_name) ?? 'mcp';
    default:
      return kind ? kind.replace(/Action$/, '').toLowerCase() : undefined;
  }
}

function actionText(action: Json): string | undefined {
  const command = str(action.command);
  if (command) {
    return command;
  }
  const path = str(action.path);
  if (path) {
    return path;
  }
  const thought = str(action.thought);
  return thought;
}

export type OpenHandsMapperState = {
  sessionId: string;
  tool: string;
  callId: string;
  sawToolResult: boolean;
};

export class OpenHandsEventMapper {
  private readonly sessionId: string;
  private terminal: 'completed' | 'failed' | 'cancelled' | null = null;
  private pending: OpenHandsMapperState | null = null;
  private readonly finishedCalls = new Set<string>();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  get finished(): boolean {
    return this.terminal !== null;
  }

  map(raw: unknown): EngineEvent[] {
    if (!isRecord(raw)) {
      return [];
    }
    const kind = str(raw.kind) ?? str(raw.type);

    if (kind === 'ActionEvent' && isRecord(raw.action)) {
      const tool = toolForAction(raw.action);
      const callId = str(raw.id) ?? str(raw.action.id) ?? `${this.sessionId}:action`;
      if (!tool) {
        return [];
      }
      this.pending = { sessionId: this.sessionId, tool, callId, sawToolResult: false };
      const input = actionText(raw.action);
      return [
        {
          type: 'tool_call',
          callId,
          tool,
          ...(input ? { input: { summary: bounded(input) } } : {}),
        },
      ];
    }

    if (kind === 'ObservationEvent' && isRecord(raw.observation)) {
      const callId = str(raw.action_id) ?? this.pending?.callId ?? `${this.sessionId}:observation`;
      if (this.finishedCalls.has(callId)) {
        return [];
      }
      this.finishedCalls.add(callId);
      const tool = this.pending?.tool ?? 'tool';
      this.pending = null;
      const observed = str(raw.observation.content) ?? str(raw.observation.text);
      return [
        {
          type: 'tool_result',
          callId,
          tool,
          ok: true,
          ...(observed ? { output: bounded(observed) } : {}),
        },
      ];
    }

    if (kind === 'AgentErrorEvent') {
      this.terminal = 'failed';
      return [
        {
          type: 'failed',
          sessionId: this.sessionId,
          code: 'provider_error',
          message: 'The OpenHands agent reported an error.',
        },
      ];
    }

    if (kind === 'ConversationStateUpdateEvent' || kind === 'ConversationStateChangedEvent') {
      const stateKey = str(raw.key);
      const status =
        stateKey === 'execution_status' ? str(raw.value) : (str(raw.status) ?? str(raw.state));
      if (status === 'finished' || status === 'completed') {
        if (this.terminal) {
          return [];
        }
        this.terminal = 'completed';
        return [{ type: 'completed', sessionId: this.sessionId }];
      }
      if (status === 'error' || status === 'failed') {
        if (this.terminal) {
          return [];
        }
        this.terminal = 'failed';
        return [
          {
            type: 'failed',
            sessionId: this.sessionId,
            code: 'provider_error',
            message: 'The OpenHands conversation failed.',
          },
        ];
      }
      if (status === 'stopped' || status === 'cancelled') {
        if (this.terminal) {
          return [];
        }
        this.terminal = 'cancelled';
        return [{ type: 'cancelled', sessionId: this.sessionId }];
      }
    }

    if (kind === 'MessageEvent' && isRecord(raw.llm_message)) {
      const content = Array.isArray(raw.llm_message.content) ? raw.llm_message.content : [];
      const text = content
        .map((entry) => (isRecord(entry) && str(entry.text) ? str(entry.text) : ''))
        .join('');
      return text ? [{ type: 'text_delta', text }] : [];
    }

    if (kind === 'FileEditedEvent') {
      const path = str(raw.path);
      return path ? [{ type: 'file_edit', path }] : [];
    }

    return [];
  }
}

export type OpenHandsTransport = {
  start: (input: {
    workspaceRoot: string;
    prompt: string;
    model?: { providerId: string; modelId: string };
    signal?: AbortSignal;
  }) => Promise<{ conversationId: string; events: AsyncIterable<unknown> }>;
  cancel: (conversationId: string) => Promise<void>;
};

export type OpenHandsAvailability = EngineResult<{
  detail: string;
  failure?: { code: EngineFailureCode; message: string };
}>;

/**
 * A remote Agent Server is the only supported production transport. Without
 * one the engine is reported unavailable; Coderax never starts a Python agent
 * runtime implicitly.
 */
export function describeOpenHands(input: {
  enabled: boolean;
  agentServerUrl?: string | null;
  transport?: OpenHandsTransport | null;
}): OpenHandsAvailability {
  if (!input.enabled) {
    return {
      ok: true,
      value: {
        detail: 'OpenHands is disabled.',
        failure: { code: 'disabled', message: 'The OpenHands execution engine is disabled.' },
      },
    };
  }
  if (!input.agentServerUrl) {
    return {
      ok: true,
      value: {
        detail: 'OpenHands requires a running Agent Server URL; it is not bundled with Coderax.',
        failure: {
          code: 'not_configured',
          message: 'No OpenHands Agent Server is configured.',
        },
      },
    };
  }
  if (!input.transport) {
    return {
      ok: true,
      value: {
        detail: 'The OpenHands TypeScript client is not installed on this server.',
        failure: {
          code: 'sdk_unavailable',
          message: 'The OpenHands client is unavailable.',
        },
      },
    };
  }
  return { ok: true, value: { detail: 'OpenHands Agent Server is configured.' } };
}

export type OpenHandsAdapterOptions = {
  enabled: boolean;
  agentServerUrl?: string | null;
  transport?: OpenHandsTransport | null;
  roots: WorkspaceRoots;
  limits: EngineLimits;
};

function failureReason(
  code: EngineFailureCode,
): Extract<EngineAvailability, { available: false }>['reason'] {
  switch (code) {
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

function failureCode(
  reason: Extract<EngineAvailability, { available: false }>['reason'],
): EngineFailureCode {
  switch (reason) {
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

function availabilityOf(options: OpenHandsAdapterOptions): EngineAvailability {
  const described = describeOpenHands(options);
  if (!described.ok) {
    return {
      available: false,
      reason: 'server_unavailable',
      detail: 'The OpenHands availability could not be determined.',
    };
  }
  if (!described.value.failure) {
    return { available: true, reason: 'ready' };
  }
  return {
    available: false,
    reason: failureReason(described.value.failure.code),
    detail: described.value.detail,
  };
}

/**
 * Start one OpenHands run through a configured remote Agent Server. The engine
 * is never started implicitly, and a missing server is a typed refusal rather
 * than a fallback to OpenCode: two engines must not edit one task.
 */
export async function startOpenHandsRun(
  options: OpenHandsAdapterOptions,
  request: EngineRunRequest,
): Promise<EngineResult<EngineRunHandle>> {
  const availability = availabilityOf(options);
  if (!availability.available) {
    return engineFailure(failureCode(availability.reason), availability.detail);
  }
  if (!options.transport) {
    return engineFailure('sdk_unavailable', 'The OpenHands client is unavailable.');
  }
  const transport = options.transport;
  if (!request.prompt.trim()) {
    return engineFailure('protocol_error', 'A task prompt is required.');
  }

  const resolved = await resolveEngineWorkspace({
    mode: request.mode,
    requestedRoot: request.workspaceRoot,
    roots: options.roots,
  });
  if (!resolved.ok) {
    return resolved;
  }

  const timeoutMs = request.timeoutMs ?? options.limits.timeoutMs;
  const deadline = Date.now() + timeoutMs;
  const startPromise = transport.start({
    workspaceRoot: resolved.value.root,
    prompt: request.prompt,
    ...(request.model ? { model: request.model } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  });
  let started: Awaited<ReturnType<OpenHandsTransport['start']>>;
  try {
    const outcome = await withDeadline(startPromise, deadline);
    if (!outcome.ok) {
      const cleanup = startPromise.then(
        (late) => boundedCancel(transport, late.conversationId),
        () => undefined,
      );
      return engineFailureWithCleanup(
        'timeout',
        retainOnFailure(cleanup),
        'The OpenHands Agent Server did not start the task before the deadline.',
        true,
      );
    }
    started = outcome.value;
  } catch {
    return engineFailure(
      'server_unavailable',
      'The OpenHands Agent Server did not accept the task.',
    );
  }
  if (!started.conversationId) {
    return engineFailure('protocol_error', 'The Agent Server returned no conversation id.');
  }
  if (request.signal?.aborted) {
    try {
      await boundedCancel(transport, started.conversationId);
    } catch {
      // Best effort: there is no handle to carry cleanup for an aborted start.
    }
    return engineFailure('cancelled', 'The run was cancelled before it started.', false);
  }

  const mapper = new OpenHandsEventMapper(started.conversationId);
  const handle = createEngineRunHandle({
    sessionId: started.conversationId,
    stream: started.events,
    map: (raw) => mapper.map(raw),
    cancelRun: async () => {
      try {
        await boundedCancel(transport, started.conversationId);
      } catch {
        // Cancellation still settles locally even if the server is unreachable.
      }
    },
    timeoutMs: request.timeoutMs ?? options.limits.timeoutMs,
    maxSummaryChars: options.limits.maxSummaryChars,
    ...(request.signal ? { signal: request.signal } : {}),
  });
  return { ok: true, value: handle };
}

export const openHandsCapabilities = {
  streaming: true,
  tools: true,
  cancellation: true,
  modelSelection: true,
} as const;

export function createOpenHandsAdapter(options: OpenHandsAdapterOptions): EngineAdapter {
  return {
    id: 'openhands',
    capabilities: openHandsCapabilities,
    describe: () => availabilityOf(options),
    start: (request) => startOpenHandsRun(options, request),
  };
}
