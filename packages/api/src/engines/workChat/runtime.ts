import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
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
  constructor(
    private readonly registry: EngineRegistryApi,
    private readonly roots: { private: string; cloud: string },
    private readonly mode: DataMode = 'private',
    private readonly model?: EngineModelRef,
  ) {}

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
    if (input.engine !== 'opencode' && input.engine !== 'freebuff') {
      return engineFailure(
        'not_configured',
        'An explicit OpenCode Agent or FreeBuff Agent selection is required.',
      );
    }
    const engine = input.engine;
    const key = activeRunKey(input);
    if (activeRuns.has(key)) {
      return engineFailure('busy', 'Another engine run is already active for this task.');
    }
    let workspaceRoot = this.roots[this.mode];
    if (!workspaceRoot) {
      return engineFailure(
        'workspace_denied',
        `The ${this.mode} workspace root is not configured.`,
      );
    }
    if (this.mode === 'cloud') {
      try {
        await mkdir(workspaceRoot, { recursive: true });
        const cloudRoot = await realpath(workspaceRoot);
        const scope = createHash('sha256').update(key).digest('hex');
        workspaceRoot = path.join(cloudRoot, `work-${engine}-${scope}`);
        await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
        if (!(await lstat(workspaceRoot)).isDirectory()) {
          return engineFailure('workspace_denied', 'The agent workspace is not a directory.');
        }
      } catch {
        return engineFailure('workspace_denied', 'The agent workspace could not be created.');
      }
    }
    const started = await this.registry.start({
      engine,
      request: {
        taskKey: this.mode === 'cloud' ? key : input.conversationId,
        conversationId: input.conversationId,
        prompt: input.prompt,
        mode: this.mode,
        workspaceRoot,
        ...(engine === 'opencode' && this.model ? { model: this.model } : {}),
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
  const modelConfig = engines?.opencode?.model;
  const runtime = new EngineWorkChatRuntime(
    createExecutionEngines(config),
    roots,
    mode,
    parseEngineModel(modelConfig) ?? undefined,
  );
  runtimes.set(key, runtime);
  return runtime;
}
