import type { EngineFailure, EngineId } from './types';
import { engineFailure } from './types';

/**
 * One logical task may be executed by at most one engine. Without this, a
 * fallback path could start OpenHands while OpenCode is still editing the same
 * workspace, producing duplicate or conflicting file changes.
 */
export class EngineRunArbiter {
  private readonly owners = new Map<string, EngineId>();

  acquire(taskKey: string, engine: EngineId): { ok: true } | EngineFailure {
    if (!taskKey) {
      return engineFailure('protocol_error', 'A task key is required.');
    }
    const current = this.owners.get(taskKey);
    if (current) {
      return engineFailure(
        'busy',
        current === engine
          ? 'This task is already running on this engine.'
          : 'This task is already running on another engine.',
      );
    }
    this.owners.set(taskKey, engine);
    return { ok: true };
  }

  release(taskKey: string, engine: EngineId): void {
    if (this.owners.get(taskKey) === engine) {
      this.owners.delete(taskKey);
    }
  }

  owner(taskKey: string): EngineId | null {
    return this.owners.get(taskKey) ?? null;
  }

  /** Test and shutdown support; never called by a request path. */
  clear(): void {
    this.owners.clear();
  }
}
