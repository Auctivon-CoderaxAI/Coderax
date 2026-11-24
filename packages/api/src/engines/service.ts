import path from 'node:path';
import type { EngineRegistryApi, EngineStatusSnapshot } from './registry';
import type { OpenHandsTransport } from './openhands/adapter';
import type { OpenCodeTransport } from './opencode/adapter';
import type { LoadedFreebuffSdk } from './freebuff/adapter';
import type { LoadedOpenCodeSdk } from './opencode/sdk';
import type { WorkspaceRoots } from './workspace';
import type { EngineLimits } from './types';
import {
  isModelAllowedForMode,
  parseEngineModel,
  PRIVATE_MODEL_DETAIL,
  ZERO_COST_MODEL_DETAIL,
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
          timeoutMs?: number;
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

/**
 * External cloud agents get their own directory beneath the configured cloud
 * root. Native Coderax runs do not use these paths, so an external engine can
 * never inherit or overwrite the native agent's workspace.
 */
export function engineWorkspaceRoot(
  config: ExecutionEnginesConfig,
  mode: 'private' | 'cloud',
  engine: 'opencode' | 'freebuff' | 'openhands',
): string {
  const workspaces = config?.engines?.workspaces;
  const base = mode === 'cloud' ? workspaces?.cloudRoot : workspaces?.privateRoot;
  if (!base) {
    return '';
  }
  if (mode !== 'cloud') {
    return base;
  }
  if (engine === 'opencode' || engine === 'freebuff') {
    return path.join(base, 'agents', engine);
  }
  return base;
}

function defaultEngineFor(value: 'opencode' | 'openhands' | 'freebuff' | undefined) {
  return value === 'openhands' || value === 'freebuff' ? value : 'opencode';
}

function limitsFor(timeoutMs?: number): EngineLimits {
  return {
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxSummaryChars: DEFAULT_MAX_SUMMARY_CHARS,
  };
}

export function createExecutionEngines(
  config: ExecutionEnginesConfig,
  loadSdk: typeof loadOpenCodeSdk = loadOpenCodeSdk,
  openHandsTransport: OpenHandsTransport | null = null,
  loadFreebuff: typeof loadFreebuffSdk = loadFreebuffSdk,
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

  let transport: OpenCodeTransport | null = null;
  let unavailableDetail: string | undefined;
  if (openCode?.enabled === true) {
    const requiredRoot = engineWorkspaceRoot(config, workMode, 'opencode');
    const model = parseEngineModel(openCode.model);
    if (!openCode.baseURL || !requiredRoot) {
      unavailableDetail = `engines.opencode.baseURL and engines.workspaces.${workMode}Root must both be configured.`;
    } else if (!isModelAllowedForMode(model, workMode)) {
      unavailableDetail =
        workMode === 'private' && model?.providerId === 'opencode'
          ? PRIVATE_MODEL_DETAIL
          : ZERO_COST_MODEL_DETAIL;
    } else {
      const loaded = loadSdk({ baseURL: openCode.baseURL, directory: requiredRoot });
      if (loaded.ok) {
        transport = loaded.value.transport;
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
      roots: {
        private: roots.private,
        cloud: engineWorkspaceRoot(config, 'cloud', 'opencode'),
      },
      limits: limitsFor(openCode?.timeoutMs),
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
            roots: {
              private: roots.private,
              cloud: engineWorkspaceRoot(config, 'cloud', 'freebuff'),
            },
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

/** Public status for an owner: no root, endpoint or credential is included. */
export function describeExecutionEngines(
  config: ExecutionEnginesConfig,
  loadSdk?: typeof loadOpenCodeSdk,
  openHandsTransport?: OpenHandsTransport | null,
  loadFreebuff?: typeof loadFreebuffSdk,
): EngineStatusSnapshot {
  return createExecutionEngines(config, loadSdk, openHandsTransport, loadFreebuff).snapshot();
}

export type LoadedOpenCode = LoadedOpenCodeSdk;
