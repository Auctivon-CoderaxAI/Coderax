import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FREEBUFF_MIN_CONTEXT_TOKENS,
  DEFAULT_FREEBUFF_PROBE_TIMEOUT_MS,
} from 'coderax-data-provider';
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
        ? `The pinned Freebuff SDK accepts plain HTTP only on loopback; non-loopback endpoints are rejected even when listed in engines.freebuff.allowedHosts. Use a loopback forwarder.`
        : `The pinned Freebuff SDK accepts plain HTTP only on loopback; the configured host is not on loopback. Use a loopback forwarder.`;
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
  /** Minimum Ollama num_ctx accepted by readiness and run start. */
  minContextTokens?: number;
  /** Bound on the endpoint probe; no request may hold readiness longer. */
  probeTimeoutMs?: number;
  /** Injectable for focused tests; production uses the global fetch. */
  fetchImpl?: ProbeFetch;
};

/** Configuration/SDK readiness; runtime endpoint state is added by probeFreebuff. */
export function describeFreebuff(options: FreebuffAdapterOptions): EngineAvailability {
  const mode = options.mode ?? 'private';
  if (!options.enabled) {
    return {
      available: false,
      reason: 'disabled',
      detail: 'Freebuff is disabled in engines.freebuff.enabled.',
    };
  }
  if (!options.baseURL || !options.model || !options.roots[mode]) {
    return {
      available: false,
      reason: 'not_configured',
      detail: `engines.freebuff.baseURL, engines.freebuff.model, and engines.workspaces.${mode}Root must be configured.`,
    };
  }
  if (!privateBaseUrl(options.baseURL)) {
    return {
      available: false,
      reason: 'not_configured',
      detail: nonLoopbackEndpointDetail(options.baseURL, options.allowedHosts),
    };
  }
  /** The private gate rejects hosted models; cloud mode admits zero-cost ones. */
  if (!isModelAllowedForMode(options.model, mode)) {
    return {
      available: false,
      reason: 'not_configured',
      detail:
        mode === 'cloud'
          ? 'Freebuff Work requires a zero-cost model: an allowlisted free OpenCode model or local ollama or lmstudio weights.'
          : 'Freebuff Work requires a local ollama or lmstudio model in provider/model form.',
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

type ProbeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type ProbeRequest = {
  signal: AbortSignal;
  headers: Record<string, string>;
  redirect: RequestRedirect;
};

type ProbeFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect?: RequestRedirect;
  },
) => Promise<ProbeResponse>;

function unavailable(
  reason: Extract<EngineAvailability, { available: false }>['reason'],
  detail: string,
): EngineAvailability {
  return { available: false, reason, detail };
}

function hasOllamaModel(names: readonly string[], modelId: string): boolean {
  if (names.includes(modelId)) {
    return true;
  }
  return !modelId.includes(':') && names.includes(`${modelId}:latest`);
}

/** The active Ollama context is the explicit num_ctx parameter, not the model's native maximum. */
function declaredContextTokens(value: unknown): number | null {
  if (!isRecord(value) || typeof value.parameters !== 'string') {
    return null;
  }
  const match = /(?:^|\n)\s*num_ctx\s+(\d+)\b/i.exec(value.parameters);
  if (!match) {
    return null;
  }
  const tokens = Number(match[1]);
  return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : null;
}

async function probeOllama(
  fetcher: ProbeFetch,
  baseURL: string,
  modelId: string,
  minContextTokens: number,
  init: ProbeRequest,
): Promise<EngineAvailability> {
  const origin = new URL(baseURL).origin;
  const tags = await fetcher(`${origin}/api/tags`, init);
  if (!tags.ok) {
    return unavailable(
      'server_unavailable',
      'The local model endpoint did not return its model list.',
    );
  }
  const tagsBody = await tags.json();
  const entries = isRecord(tagsBody) && Array.isArray(tagsBody.models) ? tagsBody.models : [];
  const names = entries.flatMap((entry): string[] => {
    if (!isRecord(entry)) {
      return [];
    }
    return [entry.name, entry.model].filter(
      (name): name is string => typeof name === 'string' && name.length > 0,
    );
  });
  if (!hasOllamaModel(names, modelId)) {
    return unavailable(
      'model_missing',
      'The configured local model is not installed on the endpoint.',
    );
  }

  const shown = await fetcher(`${origin}/api/show`, {
    ...init,
    method: 'POST',
    headers: { ...init.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name: modelId }),
  });
  if (!shown.ok) {
    return shown.status === 404
      ? unavailable('model_missing', 'The configured local model is not installed on the endpoint.')
      : unavailable('server_unavailable', 'The local model endpoint did not return model details.');
  }
  const tokens = declaredContextTokens(await shown.json());
  if (tokens == null) {
    return unavailable(
      'context_unavailable',
      `The configured local model does not declare a num_ctx context of at least ${minContextTokens} tokens.`,
    );
  }
  if (tokens < minContextTokens) {
    return unavailable(
      'context_too_small',
      `The configured local model declares a ${tokens}-token context; at least ${minContextTokens} tokens are required.`,
    );
  }
  return { available: true, reason: 'ready' };
}

async function probeLmStudio(
  fetcher: ProbeFetch,
  baseURL: string,
  modelId: string,
  init: ProbeRequest,
): Promise<EngineAvailability> {
  const response = await fetcher(`${baseURL}/models`, init);
  if (!response.ok) {
    return unavailable(
      'server_unavailable',
      'The local model endpoint did not return its model list.',
    );
  }
  const body = await response.json();
  const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  const ids = data.flatMap((entry): string[] =>
    isRecord(entry) && typeof entry.id === 'string' ? [entry.id] : [],
  );
  return ids.includes(modelId)
    ? { available: true, reason: 'ready' }
    : unavailable('model_missing', 'The configured local model is not installed on the endpoint.');
}

function configuredLocalApiKey(): string | undefined {
  return process.env.FREEBUFF_LOCAL_API_KEY?.trim() || undefined;
}

/**
 * Probe the configured local runtime within a fixed deadline. Ollama reports
 * both the installed model and its active num_ctx; LM Studio exposes model
 * presence only, so its context requirement is not asserted here.
 */
export async function probeFreebuff(
  options: FreebuffAdapterOptions,
  requestSignal?: AbortSignal,
): Promise<EngineAvailability> {
  const configured = describeFreebuff(options);
  if (!configured.available) {
    return configured;
  }
  const baseURL = privateBaseUrl(options.baseURL ?? undefined);
  const model = options.model;
  if (!baseURL || !model) {
    return configured;
  }
  const timeoutMs = options.probeTimeoutMs ?? DEFAULT_FREEBUFF_PROBE_TIMEOUT_MS;
  const minContextTokens = options.minContextTokens ?? DEFAULT_FREEBUFF_MIN_CONTEXT_TOKENS;
  const fetcher: ProbeFetch = options.fetchImpl ?? fetch;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = requestSignal ? AbortSignal.any([requestSignal, deadline]) : deadline;
  const apiKey = configuredLocalApiKey();
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const init: ProbeRequest = { signal, headers, redirect: 'error' };
  try {
    signal.throwIfAborted();
    if (model.providerId === 'ollama') {
      return await probeOllama(fetcher, baseURL, model.modelId, minContextTokens, init);
    }
    if (model.providerId === 'lmstudio') {
      return await probeLmStudio(fetcher, baseURL, model.modelId, init);
    }
    return configured;
  } catch {
    return unavailable(
      'server_unavailable',
      `The local model endpoint could not be reached within ${timeoutMs} ms.`,
    );
  }
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
  switch (availability.reason) {
    case 'disabled':
      return 'disabled';
    case 'sdk_unavailable':
      return 'sdk_unavailable';
    case 'not_configured':
      return 'not_configured';
    default:
      return 'server_unavailable';
  }
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
  probe: (signal?: AbortSignal) => Promise<EngineAvailability> = (signal) =>
    probeFreebuff(options, signal),
): Promise<EngineResult<EngineRunHandle>> {
  if (request.signal?.aborted) {
    return engineFailure('cancelled', 'The run was cancelled before it started.');
  }
  if (!request.prompt.trim()) {
    return engineFailure('protocol_error', 'A task prompt is required.');
  }
  const availability = await probe(request.signal);
  if (request.signal?.aborted) {
    return engineFailure('cancelled', 'The run was cancelled before it started.');
  }
  if (!availability.available) {
    return engineFailure(failureReason(availability), availability.detail);
  }
  if (!options.sdk || !options.model) {
    return engineFailure('sdk_unavailable', 'The Freebuff SDK is unavailable.');
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
  const localApiKey = configuredLocalApiKey() ?? 'local';
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
  let runtimeAvailability: EngineAvailability | null = null;
  let statusProbe: Promise<void> | undefined;
  let sequence = 0;
  let published = 0;

  async function refresh(signal?: AbortSignal): Promise<EngineAvailability> {
    const id = ++sequence;
    const availability = await probeFreebuff(options, signal);
    // An older request finishing late must not replace a newer observation.
    if (!signal?.aborted && id > published) {
      runtimeAvailability = availability;
      published = id;
    }
    return availability;
  }

  return {
    id: 'freebuff',
    capabilities: freebuffCapabilities,
    describe: () => runtimeAvailability ?? describeFreebuff(options),
    describeForStart: () => describeFreebuff(options),
    probe: () =>
      (statusProbe ??= refresh()
        .then(() => undefined)
        .finally(() => {
          statusProbe = undefined;
        })),
    start: (request) => startFreebuffRun(options, request, refresh),
  };
}
