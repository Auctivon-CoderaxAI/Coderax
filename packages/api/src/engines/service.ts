import type { EngineLimits } from './types';
import type { EngineRegistryApi, EngineStatusSnapshot } from './registry';
import type { WorkspaceRoots } from './workspace';
import type { LoadedOpenCodeSdk } from './opencode/sdk';
import type { OpenCodeTransport } from './opencode/adapter';
import type { OpenHandsTransport } from './openhands/adapter';
import { createEngineRegistry } from './registry';
import { createOpenCodeAdapter } from './opencode/adapter';
import { createOpenHandsAdapter } from './openhands/adapter';
import { loadOpenCodeSdk } from './opencode/sdk';
import {
  isModelAllowedForMode,
  parseEngineModel,
  PRIVATE_MODEL_DETAIL,
  ZERO_COST_MODEL_DETAIL,
} from './opencode/models';

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
        defaultEngine?: 'opencode' | 'openhands';
        workChat?: {
          enabled?: boolean;
          engine?: 'opencode';
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
      } | null;
    }
  | null
  | undefined;

const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_SUMMARY_CHARS = 4_000;

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
): EngineRegistryApi {
  const engines = config?.engines ?? null;
  const roots: WorkspaceRoots = {
    private: engines?.workspaces?.privateRoot ?? '',
    cloud: engines?.workspaces?.cloudRoot ?? '',
  };
  const openCode = engines?.opencode ?? null;
  const openHands = engines?.openhands ?? null;

  let transport: OpenCodeTransport | null = null;
  let unavailableDetail: string | undefined;
  if (openCode?.enabled === true) {
    const workMode = engines?.workChat?.mode === 'cloud' ? 'cloud' : 'private';
    const requiredRoot = workMode === 'cloud' ? roots.cloud : roots.private;
    const model = parseEngineModel(openCode.model);
    if (!openCode.baseURL || !requiredRoot) {
      unavailableDetail = `engines.opencode.baseURL and engines.workspaces.${workMode}Root must both be configured.`;
    } else if (!isModelAllowedForMode(model, workMode)) {
      unavailableDetail =
        workMode === 'private' && model?.providerId === 'opencode'
          ? PRIVATE_MODEL_DETAIL
          : ZERO_COST_MODEL_DETAIL;
    } else {
      const loaded = loadSdk({ baseURL: openCode.baseURL, directory: roots.private });
      if (loaded.ok) {
        transport = loaded.value.transport;
      } else {
        unavailableDetail = loaded.error.message;
      }
    }
  }

  const adapters = {
    opencode: createOpenCodeAdapter({
      enabled: openCode?.enabled === true,
      transport,
      ...(unavailableDetail ? { unavailableDetail } : {}),
      roots,
      limits: limitsFor(openCode?.timeoutMs),
    }),
    openhands: createOpenHandsAdapter({
      enabled: openHands?.enabled === true,
      ...(openHands?.agentServerUrl ? { agentServerUrl: openHands.agentServerUrl } : {}),
      ...(openHandsTransport ? { transport: openHandsTransport } : {}),
      roots,
      limits: limitsFor(openHands?.timeoutMs),
    }),
  };

  return createEngineRegistry({
    defaultEngine: engines?.defaultEngine === 'openhands' ? 'openhands' : 'opencode',
    adapters,
  });
}

/** Public status for an owner: no root, endpoint or credential is included. */
export function describeExecutionEngines(
  config: ExecutionEnginesConfig,
  loadSdk?: typeof loadOpenCodeSdk,
): EngineStatusSnapshot {
  return createExecutionEngines(config, loadSdk).snapshot();
}

export type LoadedOpenCode = LoadedOpenCodeSdk;
