import type {
  EngineAdapter,
  EngineAvailability,
  EngineResult,
  EngineRunHandle,
  EngineRunRequest,
  EngineLimits,
} from '../types';
import type { WorkspaceRoots } from '../workspace';
import { engineFailure } from '../types';
import { resolveEngineWorkspace } from '../workspace';
import { createEngineRunHandle } from '../run';
import { OpenCodeEventMapper } from './protocol';

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

export type OpenCodeAdapterOptions = {
  enabled: boolean;
  transport?: OpenCodeTransport | null;
  unavailableDetail?: string;
  roots: WorkspaceRoots;
  limits: EngineLimits;
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

/**
 * Start one OpenCode run in a confined workspace.
 *
 * The session is created first, then the event stream is subscribed, then the
 * prompt is sent, so no early event is missed. Every outcome goes through the
 * shared pump, which settles the run once.
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

  const resolved = await resolveEngineWorkspace({
    mode: request.mode,
    requestedRoot: request.workspaceRoot,
    roots: options.roots,
  });
  if (!resolved.ok) {
    return resolved;
  }
  const workspace = resolved.value;

  let sessionId: string;
  try {
    const session = await options.transport.createSession({
      directory: workspace.root,
      title: request.conversationId,
    });
    sessionId = session.id;
  } catch {
    return engineFailure('server_unavailable', 'The OpenCode server did not accept the session.');
  }
  if (!sessionId) {
    return engineFailure('protocol_error', 'The OpenCode server returned no session id.');
  }

  let stream: AsyncIterable<unknown>;
  try {
    stream = await options.transport.subscribe({
      directory: workspace.root,
      sessionId,
      signal: request.signal,
    });
  } catch {
    return engineFailure('server_unavailable', 'The OpenCode event stream was unavailable.');
  }

  const mapper = new OpenCodeEventMapper(sessionId);
  const handle = createEngineRunHandle({
    sessionId,
    stream,
    map: (raw) => mapper.map(raw),
    cancelRun: async () => {
      try {
        await options.transport?.abort({ sessionId, directory: workspace.root });
      } catch {
        // The session may already be gone; cancellation still settles locally.
      }
    },
    timeoutMs: request.timeoutMs ?? options.limits.timeoutMs,
    maxSummaryChars: options.limits.maxSummaryChars,
    ...(request.signal ? { signal: request.signal } : {}),
  });

  try {
    await options.transport.prompt({
      sessionId,
      directory: workspace.root,
      text: request.prompt,
      ...(request.model ? { model: request.model } : {}),
    });
  } catch {
    await handle.close();
    return engineFailure('server_unavailable', 'The OpenCode server did not accept the task.');
  }

  return { ok: true, value: handle };
}

export const openCodeCapabilities = {
  streaming: true,
  tools: true,
  cancellation: true,
  modelSelection: true,
} as const;

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions): EngineAdapter {
  return {
    id: 'opencode',
    capabilities: openCodeCapabilities,
    describe: () => describeOpenCode(options),
    start: (request) => startOpenCodeRun(options, request),
  };
}
