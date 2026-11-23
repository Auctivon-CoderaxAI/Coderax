import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  EngineAdapter,
  EngineAvailability,
  EngineEvent,
  EngineLimits,
  EngineResult,
  EngineRunHandle,
  EngineRunRequest,
} from '../types';
import type { EngineModelRef } from '../opencode/models';
import type { WorkspaceRoots } from '../workspace';
import { isModelAllowedForMode } from '../opencode/models';
import { resolveEngineWorkspace } from '../workspace';
import { createEngineRunHandle } from '../run';
import { engineFailure } from '../types';

type Json = Record<string, unknown>;

type FreebuffRunState = { output?: unknown };

type FreebuffRunOptions = {
  agent: Json;
  prompt: string;
  signal: AbortSignal;
  handleEvent: (event: unknown) => void;
  handleStreamChunk: (chunk: unknown) => void;
  onUsage: (usage: unknown) => void;
};

type FreebuffClient = {
  run: (options: FreebuffRunOptions) => Promise<FreebuffRunState>;
};

type FreebuffSdkModule = {
  CodebuffClient: new (options: Json) => FreebuffClient;
  normalizeByokBaseUrl: (...args: unknown[]) => unknown;
  isUntrustedAgentPublisherError: (...args: unknown[]) => unknown;
};

export type LoadedFreebuffSdk = { module: FreebuffSdkModule };

/**
 * Load Freebuff's current source-built SDK lazily. The published npm package
 * can predate Freebuff's BYOK and registry trust gates, so require those exports
 * before allowing any source files to reach the agent runtime.
 */
export type FreebuffSdkLoadOptions = {
  /** Absolute path to a trusted, source-built CommonJS entrypoint. */
  sdkPath?: string | null;
};

export function loadFreebuffSdk(
  options: FreebuffSdkLoadOptions = {},
): EngineResult<LoadedFreebuffSdk> {
  let loaded: unknown;
  const configured = options.sdkPath?.trim() || process.env.FREEBUFF_SDK_PATH?.trim();
  if (configured && !path.isAbsolute(configured)) {
    return engineFailure(
      'sdk_unavailable',
      'engines.freebuff.sdkPath and FREEBUFF_SDK_PATH must be absolute paths to a trusted, source-built Freebuff SDK entrypoint.',
    );
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require(configured || '@codebuff/sdk');
  } catch {
    return engineFailure(
      'sdk_unavailable',
      'The Freebuff source-built SDK is unavailable. Set FREEBUFF_SDK_PATH to its absolute CommonJS entrypoint.',
    );
  }
  if (
    loaded == null ||
    typeof loaded !== 'object' ||
    !('CodebuffClient' in loaded) ||
    typeof (loaded as { CodebuffClient?: unknown }).CodebuffClient !== 'function' ||
    typeof (loaded as { normalizeByokBaseUrl?: unknown }).normalizeByokBaseUrl !== 'function' ||
    typeof (loaded as { isUntrustedAgentPublisherError?: unknown })
      .isUntrustedAgentPublisherError !== 'function'
  ) {
    return engineFailure(
      'sdk_unavailable',
      'The installed SDK lacks Freebuff local BYOK or its agent registry trust gate. ' +
        'Use a current source-built SDK and set FREEBUFF_SDK_PATH.',
    );
  }
  return { ok: true, value: { module: loaded as FreebuffSdkModule } };
}

function normalizedHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * The pinned SDK accepts plain HTTP only on loopback. Non-loopback hosts are
 * rejected even when listed in `engines.freebuff.allowedHosts`, so the adapter
 * must not report them as ready.
 */
function privateBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    const host = normalizedHost(url.hostname);
    if (
      url.protocol !== 'http:' ||
      !LOOPBACK_HOSTS.has(host) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function nonLoopbackEndpointDetail(
  value: string | undefined,
  allowedHosts: readonly string[] = [],
): string {
  try {
    const url = new URL(value ?? '');
    const host = normalizedHost(url.hostname);
    if (host && !LOOPBACK_HOSTS.has(host)) {
      const allowlisted = allowedHosts.some((entry) => normalizedHost(entry) === host);
      return allowlisted
        ? `The pinned Freebuff SDK accepts plain HTTP only on loopback; the non-loopback host "${host}" is rejected even when listed in engines.freebuff.allowedHosts. Use a loopback forwarder.`
        : `The pinned Freebuff SDK accepts plain HTTP only on loopback; "${host}" is not a loopback host. Use a loopback forwarder.`;
    }
  } catch {
    // Fall through to the generic configuration message.
  }
  return 'Freebuff Work requires an OpenAI-compatible loopback endpoint (the pinned SDK rejects plain HTTP for any other host), plus a local ollama or lmstudio model.';
}

export type FreebuffAdapterOptions = {
  enabled: boolean;
  baseURL?: string | null;
  /** Retained for diagnostics; the pinned SDK rejects non-loopback HTTP. */
  allowedHosts?: readonly string[];
  model?: EngineModelRef | null;
  sdk?: LoadedFreebuffSdk | null;
  unavailableDetail?: string;
  roots: WorkspaceRoots;
  mode?: 'private' | 'cloud';
  limits: EngineLimits;
  maxAgentSteps?: number;
};

export function describeFreebuff(options: FreebuffAdapterOptions): EngineAvailability {
  if (!options.enabled) {
    return {
      available: false,
      reason: 'disabled',
      detail: 'Freebuff is disabled in engines.freebuff.enabled.',
    };
  }
  if (!options.baseURL || !options.model || !options.roots[options.mode ?? 'private']) {
    return {
      available: false,
      reason: 'not_configured',
      detail:
        'engines.freebuff.baseURL, engines.freebuff.model, and engines.workspaces.privateRoot must be configured.',
    };
  }
  if (!privateBaseUrl(options.baseURL)) {
    return {
      available: false,
      reason: 'not_configured',
      detail: nonLoopbackEndpointDetail(options.baseURL, options.allowedHosts),
    };
  }
  if (!isModelAllowedForMode(options.model, 'private')) {
    return {
      available: false,
      reason: 'not_configured',
      detail:
        'Freebuff Work requires a local ollama or lmstudio model in provider/model form.',
    };
  }
  if (!options.sdk) {
    return {
      available: false,
      reason: 'sdk_unavailable',
      detail: options.unavailableDetail ?? 'The Freebuff SDK could not be loaded.',
    };
  }
  return { available: true, reason: 'ready' };
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function pathFromArgument(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof URL && value.protocol === 'file:') {
    return fileURLToPath(value);
  }
  throw new TypeError('Freebuff workspace tools require a file path.');
}

async function realpathOrAncestor(fullPath: string): Promise<string> {
  let current = fullPath;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return missing.length ? path.resolve(real, ...missing.reverse()) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error('Freebuff could not validate the workspace path.');
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * The SDK's built-in project fence protects reads and listings, while its
 * write tools intentionally remain host-defined. This filesystem wrapper
 * confines every SDK file operation (including edits) to one real workspace.
 */
function createWorkspaceFileSystem(workspaceRoot: string): Json {
  const root = path.resolve(workspaceRoot);
  const rootReal = fs.realpath(root);

  const resolve = async (pathArgument: unknown): Promise<string> => {
    const input = pathFromArgument(pathArgument);
    const candidate = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input);
    if (!isInside(root, candidate)) {
      throw new Error('This file is outside the selected workspace.');
    }
    const [realRoot, realCandidate] = await Promise.all([rootReal, realpathOrAncestor(candidate)]);
    if (!isInside(realRoot, realCandidate)) {
      throw new Error('This file is outside the selected workspace.');
    }
    return candidate;
  };

  const invoke = async (
    method: 'mkdir' | 'readdir' | 'readFile' | 'stat' | 'unlink' | 'writeFile',
    pathArgument: unknown,
    rest: unknown[],
  ) => {
    const operation = fs[method] as (...args: unknown[]) => Promise<unknown>;
    return Reflect.apply(operation, fs, [await resolve(pathArgument), ...rest]);
  };

  return {
    mkdir: (target: unknown, ...rest: unknown[]) => invoke('mkdir', target, rest),
    readdir: (target: unknown, ...rest: unknown[]) => invoke('readdir', target, rest),
    readFile: (target: unknown, ...rest: unknown[]) => invoke('readFile', target, rest),
    stat: (target: unknown, ...rest: unknown[]) => invoke('stat', target, rest),
    unlink: (target: unknown, ...rest: unknown[]) => invoke('unlink', target, rest),
    writeFile: (target: unknown, ...rest: unknown[]) => invoke('writeFile', target, rest),
    // The SDK's project fence probes this optional method to reject symlinks
    // that resolve outside the workspace.
    realpath: async (target: unknown) => fs.realpath(await resolve(target)),
  };
}

class EngineEventQueue implements AsyncIterable<EngineEvent> {
  private readonly values: EngineEvent[] = [];
  private readonly waiters: Array<(value: IteratorResult<EngineEvent>) => void> = [];
  private closed = false;

  push(event: EngineEvent): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return;
    }
    this.values.push(event);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<EngineEvent> {
    for (;;) {
      const next = this.values.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.closed) {
        return;
      }
      const value = await new Promise<IteratorResult<EngineEvent>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (value.done) {
        return;
      }
      yield value.value;
    }
  }
}

function isRecord(value: unknown): value is Json {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function textFromOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(textFromOutput).filter(Boolean).join('');
  }
  if (!isRecord(value)) {
    return '';
  }
  if (typeof value.text === 'string') {
    return value.text;
  }
  if ('value' in value) {
    return textFromOutput(value.value);
  }
  return '';
}

function safeTokenCount(value: unknown, names: string[]): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const name of names) {
    const candidate = value[name];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      return Math.floor(candidate);
    }
  }
  return undefined;
}

function handleSdkEvent(
  queue: EngineEventQueue,
  value: unknown,
  onText: (text: string) => void,
): void {
  if (!isRecord(value)) {
    return;
  }
  if (value.type === 'text' && typeof value.text === 'string' && value.text) {
    onText(value.text);
  } else if (value.type === 'tool_call') {
    const callId = typeof value.toolCallId === 'string' ? value.toolCallId : randomUUID();
    const tool = typeof value.toolName === 'string' ? value.toolName : 'tool';
    queue.push({
      type: 'tool_call',
      callId,
      tool,
      ...(isRecord(value.input) ? { input: value.input } : {}),
    });
  } else if (value.type === 'tool_result') {
    const callId = typeof value.toolCallId === 'string' ? value.toolCallId : randomUUID();
    const tool = typeof value.toolName === 'string' ? value.toolName : 'tool';
    const output = textFromOutput(value.output);
    queue.push({
      type: 'tool_result',
      callId,
      tool,
      ok: true,
      ...(output ? { output: output.slice(0, 4_000) } : {}),
    });
  }
}

function failureReason(
  availability: EngineAvailability,
): 'disabled' | 'sdk_unavailable' | 'not_configured' | 'server_unavailable' {
  if (availability.available) {
    return 'server_unavailable';
  }
  return availability.reason;
}

async function waitForRunCleanup(run: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 5_000);
  });
  await Promise.race([run, timeout]);
  if (timer) {
    clearTimeout(timer);
  }
}

export async function startFreebuffRun(
  options: FreebuffAdapterOptions,
  request: EngineRunRequest,
): Promise<EngineResult<EngineRunHandle>> {
  const availability = describeFreebuff(options);
  if (!availability.available) {
    return engineFailure(failureReason(availability), availability.detail);
  }
  if (!options.sdk || !options.model) {
    return engineFailure('sdk_unavailable', 'The Freebuff SDK is unavailable.');
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
  if (request.signal?.aborted) {
    return engineFailure('cancelled', 'The run was cancelled before it started.');
  }

  const workspaceRoot = resolved.value.root;
  const baseURL = privateBaseUrl(options.baseURL ?? undefined);
  if (!baseURL) {
    return engineFailure(
      'not_configured',
      nonLoopbackEndpointDetail(options.baseURL ?? undefined, options.allowedHosts),
    );
  }

  const sessionId = randomUUID();
  const controller = new AbortController();
  const abortFromRequest = (): void => controller.abort();
  request.signal?.addEventListener('abort', abortFromRequest, { once: true });
  const queue = new EngineEventQueue();
  queue.push({ type: 'started', sessionId });

  const timestamp = new Date().toISOString();
  const localApiKey = process.env.FREEBUFF_LOCAL_API_KEY?.trim() || 'local';
  const byok = {
    id: randomUUID(),
    revision: 1,
    name: 'Coderax local model',
    provider: 'openai-compatible',
    model: options.model.modelId,
    baseUrl: baseURL,
    credentialRef: 'env:FREEBUFF_LOCAL_API_KEY',
    createdAt: timestamp,
    updatedAt: timestamp,
    apiKey: localApiKey,
  };
  const scopedFs = createWorkspaceFileSystem(workspaceRoot);
  const client = new options.sdk.module.CodebuffClient({
    byok,
    cwd: workspaceRoot,
    fsSource: async () => scopedFs,
    agentDirs: [],
    agentDefinitions: [],
    disableAgentRegistry: true,
    includeHomeSkills: false,
    skillsLoader: async () => ({}),
    confineFileToolsToProject: true,
    refuseNonTextFileReads: true,
    maxAgentSteps: options.maxAgentSteps ?? 24,
  });

  const agent = {
    id: 'coderax-freebuff',
    displayName: 'Freebuff Work Agent',
    model: `${options.model.providerId}/${options.model.modelId}`,
    outputMode: 'last_message',
    toolNames: [
      'read_files',
      'find_files',
      'glob',
      'list_directory',
      'read_subtree',
      'write_file',
      'apply_patch',
      'str_replace',
      'set_output',
      'end_turn',
      'think_deeply',
    ],
    spawnableAgents: [],
    systemPrompt:
      'You are Freebuff in Coderax Work. Edit only the selected project workspace. ' +
      'Claim changes only when a tool confirms them.',
    instructionsPrompt:
      'Inspect relevant files and make focused changes. Do not access secrets, use shell ' +
      'commands or contact external services. Report confirmed changes and any validation ' +
      'you could not perform.',
  };

  let streamedText = '';
  const run = Promise.resolve()
    .then(() =>
      client.run({
        agent,
        prompt: request.prompt,
        signal: controller.signal,
        handleStreamChunk: (chunk) => {
          if (typeof chunk === 'string' && chunk) {
            streamedText += chunk;
            queue.push({ type: 'text_delta', text: chunk });
          }
        },
        handleEvent: (event) =>
          handleSdkEvent(queue, event, (text) => {
            // The SDK reports assistant text twice: as stream chunks and again
            // as a `text` event carrying the same message. The chunks already
            // emitted it, so re-emitting the event duplicates the reply.
            if (streamedText.endsWith(text)) {
              return;
            }
            streamedText += text;
            queue.push({ type: 'text_delta', text });
          }),
        onUsage: (usage) => {
          const inputTokens = safeTokenCount(usage, [
            'inputTokens',
            'promptTokens',
            'input_tokens',
          ]);
          const outputTokens = safeTokenCount(usage, [
            'outputTokens',
            'completionTokens',
            'output_tokens',
          ]);
          if (inputTokens !== undefined || outputTokens !== undefined) {
            queue.push({
              type: 'usage',
              ...(inputTokens !== undefined ? { inputTokens } : {}),
              ...(outputTokens !== undefined ? { outputTokens } : {}),
            });
          }
        },
      }),
    )
    .then((state) => {
      if (controller.signal.aborted) {
        queue.push({ type: 'cancelled', sessionId });
        return;
      }
      const output = isRecord(state) ? state.output : undefined;
      if (isRecord(output) && output.type === 'error') {
        queue.push({
          type: 'failed',
          sessionId,
          code: 'provider_error',
          message: 'The local Freebuff model run failed.',
        });
        return;
      }
      if (!streamedText) {
        const finalText = textFromOutput(output);
        if (finalText) {
          streamedText = finalText;
          queue.push({ type: 'text_delta', text: finalText });
        }
      }
      queue.push({
        type: 'completed',
        sessionId,
        ...(streamedText ? { summary: streamedText.slice(0, options.limits.maxSummaryChars) } : {}),
      });
    })
    .catch(() => {
      queue.push(
        controller.signal.aborted
          ? { type: 'cancelled', sessionId }
          : {
              type: 'failed',
              sessionId,
              code: 'provider_error',
              message: 'The local Freebuff model run failed.',
            },
      );
    })
    .finally(() => {
      queue.close();
      request.signal?.removeEventListener('abort', abortFromRequest);
    });

  return {
    ok: true,
    value: createEngineRunHandle({
      sessionId,
      stream: queue,
      map: (event) => [event as EngineEvent],
      cancelRun: async () => {
        controller.abort();
        await waitForRunCleanup(run);
      },
      timeoutMs: request.timeoutMs ?? options.limits.timeoutMs,
      maxSummaryChars: options.limits.maxSummaryChars,
      signal: controller.signal,
      abort: () => controller.abort(),
    }),
  };
}

export const freebuffCapabilities = {
  streaming: true,
  tools: true,
  cancellation: true,
  modelSelection: false,
} as const;

export function createFreebuffAdapter(options: FreebuffAdapterOptions): EngineAdapter {
  return {
    id: 'freebuff',
    capabilities: freebuffCapabilities,
    describe: () => describeFreebuff(options),
    start: (request) => startFreebuffRun(options, request),
  };
}
