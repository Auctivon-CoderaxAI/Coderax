import type { EngineWorkChatConfig, EngineWorkChatRunner, RunScope } from './types';
import type { DataMode, EngineId, EngineResult, EngineRunHandle } from '../types';
import type { EngineRegistryApi, EngineStatusSnapshot } from '../registry';
import type { EngineModelRef } from '../opencode/models';
import { parseEngineModel } from '../opencode/models';
import { createExecutionEngines } from '../service';
import { engineFailure } from '../types';

type ActiveRun = {
  handle: EngineRunHandle;
  cancel: () => Promise<void>;
};

/**
 * Active runs are process-level state, not runtime-cache state. A config change
 * can create a new runtime cache entry, but state/cancel must still reach the
 * run that the previous entry started.
 */
const activeRuns = new Map<string, ActiveRun>();

function activeRunKey(input: RunScope): string {
  return JSON.stringify([input.tenantId, input.userId, input.conversationId]);
}

export class EngineWorkChatRuntime implements EngineWorkChatRunner {
  private readonly registry: EngineRegistryApi;
  private readonly roots: { private: string; cloud: string };
  private readonly mode: DataMode;
  private readonly model: EngineModelRef | undefined;
  private readonly defaultEngine: EngineId;

  constructor(
    registry: EngineRegistryApi,
    roots: { private: string; cloud: string },
    mode: DataMode = 'private',
    model?: EngineModelRef,
    defaultEngine: EngineId = 'opencode',
  ) {
    this.registry = registry;
    this.roots = roots;
    this.mode = mode;
    this.model = model;
    this.defaultEngine = defaultEngine;
  }

  snapshot(): EngineStatusSnapshot {
    return this.registry.snapshot();
  }

  async refreshSnapshot(): Promise<EngineStatusSnapshot> {
    await this.registry.probe();
    return this.snapshot();
  }

  state(input: RunScope): string | null {
    return activeRuns.has(activeRunKey(input)) ? 'running' : null;
  }

  async cancel(input: RunScope): Promise<boolean> {
    const run = activeRuns.get(activeRunKey(input));
    if (!run) {
      return false;
    }
    await run.cancel();
    return true;
  }

  release(input: RunScope & { handle?: EngineRunHandle }): boolean {
    const key = activeRunKey(input);
    const run = activeRuns.get(key);
    if (!run || (input.handle != null && run.handle !== input.handle)) {
      return false;
    }
    activeRuns.delete(key);
    return true;
  }

  async start(
    input: RunScope & { prompt: string; engine?: EngineId },
  ): Promise<EngineResult<EngineRunHandle>> {
    const key = activeRunKey(input);
    if (activeRuns.has(key)) {
      return engineFailure('busy', 'Another engine run is already active for this task.');
    }
    const started = await this.registry.start({
      engine: input.engine ?? this.defaultEngine,
      request: {
        taskKey: input.conversationId,
        conversationId: input.conversationId,
        prompt: input.prompt,
        mode: this.mode,
        workspaceRoot: this.mode === 'cloud' ? this.roots.cloud : this.roots.private,
        ...((input.engine ?? this.defaultEngine) === 'opencode' && this.model
          ? { model: this.model }
          : {}),
      },
    });
    if (!started.ok) {
      return started;
    }
    activeRuns.set(key, { handle: started.value, cancel: started.value.cancel });
    return started;
  }
}

const runtimes = new Map<string, EngineWorkChatRuntime>();

function runtimeKey(config: EngineWorkChatConfig | null | undefined): string {
  const engines = config?.engines;
  return JSON.stringify({
    privateRoot: engines?.workspaces?.privateRoot ?? '',
    cloudRoot: engines?.workspaces?.cloudRoot ?? '',
    workChat: engines?.workChat ?? null,
    opencode: engines?.opencode ?? null,
    openhands: engines?.openhands ?? null,
    freebuff: engines?.freebuff ?? null,
    defaultEngine: engines?.defaultEngine ?? null,
  });
}

/** One registry (and therefore one lease table) per configured engine shape. */
export function getEngineWorkChatRuntime(
  config: EngineWorkChatConfig | null | undefined,
): EngineWorkChatRuntime {
  const key = runtimeKey(config);
  const existing = runtimes.get(key);
  if (existing) {
    return existing;
  }
  const roots = {
    private: config?.engines?.workspaces?.privateRoot ?? '',
    cloud: config?.engines?.workspaces?.cloudRoot ?? '',
  };
  const engines = config?.engines;
  const mode = config?.engines?.workChat?.mode === 'cloud' ? 'cloud' : 'private';
  const workEngine = config?.engines?.workChat?.engine ?? 'opencode';
  const modelConfig =
    workEngine === 'freebuff' ? engines?.freebuff?.model : engines?.opencode?.model;
  const runtime = new EngineWorkChatRuntime(
    createExecutionEngines(config),
    roots,
    mode,
    parseEngineModel(modelConfig) ?? undefined,
    workEngine,
  );
  runtimes.set(key, runtime);
  return runtime;
}
