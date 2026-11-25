import type { EngineRegistryApi, EngineStatusSnapshot } from './registry';
import type { OpenHandsTransport } from './openhands/adapter';
import type { OpenCodeTransport } from './opencode/adapter';
import type { LoadedFreebuffSdk } from './freebuff/adapter';
import type { LoadedOpenCodeSdk } from './opencode/sdk';
import type { EngineModelRef } from './opencode/models';
import type { WorkspaceRoots } from './workspace';
import type { EngineLimits } from './types';
import {
  parseEngineModel,
  PRIVATE_MODEL_DETAIL,
  ZERO_COST_MODEL_DETAIL,
  resolveModelPlan,
} from './opencode/models';
import { createFreebuffAdapter, loadFreebuffSdk } from './freebuff/adapter';
import { createOpenHandsAdapter } from './openhands/adapter';
import { createOpenCodeAdapter } from './opencode/adapter';
import { createEngineRegistry } from './registry';
import { loadOpenCodeSdk } from './opencode/sdk';

/**
 * Config-driven construction of the execution engines.
 *
 * This is the only place that reads `engines` configuration. Nothing is enabled
 * implicitly: an engine needs its own opt-in, a reachable endpoint and the
 * workspace roots that confine it. A missing prerequisite yields a typed,
 * user-safe status instead of a process start or a fallback engine.
 */

export type ExecutionEnginesConfig =
  | {
      engines?: {
        defaultEngine?: 'opencode' | 'openhands' | 'freebuff';
        /** Bounded same-engine retry for a run that failed before any side effect. */
        retry?: {
          maxAttempts?: number;
          delayMs?: number;
        } | null;
        workChat?: {
          enabled?: boolean;
          mode?: 'private' | 'cloud';
        } | null;
        workspaces?: {
          privateRoot?: string;
          cloudRoot?: string;
        } | null;
        opencode?: {
          enabled?: boolean;
          baseURL?: string;
          model?: string;
          /** Server variable holding the OpenCode server password. */
          passwordEnv?: string;
          /** Bound on the authenticated readiness probe. */
          probeTimeoutMs?: number;
          timeoutMs?: number;
          /** Bound on auto-model fallback attempts. */
          maxModelAttempts?: number;
        } | null;
        openhands?: {
          enabled?: boolean;
          agentServerUrl?: string;
          timeoutMs?: number;
        } | null;
        freebuff?: {
          enabled?: boolean;
          /** Absolute path to a source-built Freebuff SDK CommonJS entrypoint. */
          sdkPath?: string;
          baseURL?: string;
          /** Retained for diagnostics; the pinned SDK rejects non-loopback HTTP. */
          allowedHosts?: string[];
          model?: string;
          minContextTokens?: number;
          probeTimeoutMs?: number;
          timeoutMs?: number;
          maxAgentSteps?: number;
        } | null;
      } | null;
    }
  | null
  | undefined;

const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_SUMMARY_CHARS = 4_000;

function defaultEngineFor(value: 'opencode' | 'openhands' | 'freebuff' | undefined) {
  return value === 'openhands' || value === 'freebuff' ? value : 'opencode';
}

function limitsFor(timeoutMs?: number): EngineLimits {
  return {
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxSummaryChars: DEFAULT_MAX_SUMMARY_CHARS,
  };
}

/** Credentials are read by name from the server environment, never from config. */
function credentialReader(env: NodeJS.ProcessEnv): (name: string) => boolean {
  return (name: string) => Boolean(env[name]);
}

export function createExecutionEngines(
  config: ExecutionEnginesConfig,
  loadSdk: typeof loadOpenCodeSdk = loadOpenCodeSdk,
  openHandsTransport: OpenHandsTransport | null = null,
  loadFreebuff: typeof loadFreebuffSdk = loadFreebuffSdk,
  env: NodeJS.ProcessEnv = process.env,
): EngineRegistryApi {
  const engines = config?.engines ?? null;
  const roots: WorkspaceRoots = {
    private: engines?.workspaces?.privateRoot ?? '',
    cloud: engines?.workspaces?.cloudRoot ?? '',
  };
  const openCode = engines?.opencode ?? null;
  const openHands = engines?.openhands ?? null;
  const freebuff = engines?.freebuff ?? null;
  const workMode = engines?.workChat?.mode === 'cloud' ? 'cloud' : 'private';
  const hasEnv = credentialReader(env);

  let transport: OpenCodeTransport | null = null;
  let unavailableDetail: string | undefined;
  let openCodeBaseURL: string | undefined;
  let openCodePassword: string | undefined;
  let models: EngineModelRef[] = [];
  if (openCode?.enabled === true) {
    const requiredRoot = roots[workMode];
    const plan = resolveModelPlan({
      configured: openCode.model,
      mode: workMode,
      hasEnv,
      maxAttempts: openCode.maxModelAttempts,
    });
    openCodeBaseURL = openCode.baseURL;
    openCodePassword = openCode.passwordEnv ? env[openCode.passwordEnv] : undefined;
    if (!openCode.baseURL || !requiredRoot) {
      unavailableDetail = `engines.opencode.baseURL and engines.workspaces.${workMode}Root must both be configured.`;
    } else if (plan.candidates.length === 0) {
      unavailableDetail =
        plan.detail ??
        (workMode === 'private' && plan.auto ? PRIVATE_MODEL_DETAIL : ZERO_COST_MODEL_DETAIL);
    } else if (openCode.passwordEnv && !openCodePassword) {
      // The server enforces its password on every route, so attaching without it
      // would only produce 401s. Name the variable, never a value.
      unavailableDetail = `${openCode.passwordEnv} is not set, so Coderax cannot authenticate to the OpenCode server.`;
    } else {
      const loaded = loadSdk({
        baseURL: openCode.baseURL,
        // The client's default directory is the root for this run's data mode,
        // so a cloud run never names the private root as its working directory.
        directory: requiredRoot,
        ...(openCodePassword ? { password: openCodePassword } : {}),
      });
      if (loaded.ok) {
        transport = loaded.value.transport;
        models = plan.candidates.map((candidate) => candidate.model);
      } else {
        unavailableDetail = loaded.error.message;
      }
    }
  }

  let loadedFreebuff: LoadedFreebuffSdk | null = null;
  let freebuffUnavailableDetail: string | undefined;
  if (freebuff?.enabled === true) {
    const loaded = loadFreebuff({ sdkPath: freebuff.sdkPath });
    if (loaded.ok) {
      loadedFreebuff = loaded.value;
    } else {
      freebuffUnavailableDetail = loaded.error.message;
    }
  }

  const adapters = {
    opencode: createOpenCodeAdapter({
      enabled: openCode?.enabled === true,
      transport,
      ...(unavailableDetail ? { unavailableDetail } : {}),
      ...(openCodeBaseURL ? { baseURL: openCodeBaseURL } : {}),
      ...(openCodePassword ? { password: openCodePassword } : {}),
      ...(openCode?.probeTimeoutMs != null ? { probeTimeoutMs: openCode.probeTimeoutMs } : {}),
      roots,
      limits: limitsFor(openCode?.timeoutMs),
      models,
    }),
    openhands: createOpenHandsAdapter({
      enabled: openHands?.enabled === true,
      ...(openHands?.agentServerUrl ? { agentServerUrl: openHands.agentServerUrl } : {}),
      ...(openHandsTransport ? { transport: openHandsTransport } : {}),
      roots,
      limits: limitsFor(openHands?.timeoutMs),
    }),
    ...(freebuff?.enabled === true
      ? {
          freebuff: createFreebuffAdapter({
            enabled: true,
            ...(freebuff.baseURL ? { baseURL: freebuff.baseURL } : {}),
            ...(freebuff.allowedHosts ? { allowedHosts: freebuff.allowedHosts } : {}),
            model: parseEngineModel(freebuff.model),
            ...(freebuff.minContextTokens != null
              ? { minContextTokens: freebuff.minContextTokens }
              : {}),
            ...(freebuff.probeTimeoutMs != null ? { probeTimeoutMs: freebuff.probeTimeoutMs } : {}),
            sdk: loadedFreebuff,
            ...(freebuffUnavailableDetail ? { unavailableDetail: freebuffUnavailableDetail } : {}),
            roots,
            mode: workMode,
            limits: limitsFor(freebuff.timeoutMs),
            maxAgentSteps: freebuff.maxAgentSteps,
          }),
        }
      : {}),
  };

  return createEngineRegistry({
    defaultEngine: defaultEngineFor(engines?.defaultEngine),
    adapters,
  });
}

/**
 * Configuration admission for an owner: no root, endpoint or credential is
 * included. Runtime readiness is `EngineWorkChatRuntime.refreshSnapshot()`, which
 * probes the server before reporting it ready.
 */
export function describeExecutionEngines(
  config: ExecutionEnginesConfig,
  loadSdk?: typeof loadOpenCodeSdk,
  openHandsTransport?: OpenHandsTransport | null,
  loadFreebuff?: typeof loadFreebuffSdk,
  env: NodeJS.ProcessEnv = process.env,
): EngineStatusSnapshot {
  return createExecutionEngines(config, loadSdk, openHandsTransport, loadFreebuff, env).snapshot(
    true,
  );
}

export type LoadedOpenCode = LoadedOpenCodeSdk;
