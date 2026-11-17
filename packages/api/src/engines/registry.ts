import type {
  EngineAdapter,
  EngineAvailability,
  EngineId,
  EngineResult,
  EngineRunHandle,
  EngineRunRequest,
} from './types';
import { engineFailure } from './types';
import { EngineRunArbiter } from './arbiter';

/**
 * The single entry point for starting a coding-agent run.
 *
 * Selection fails closed: a disabled or unavailable engine is never replaced by
 * another engine automatically. A caller that wants a fallback must ask for it
 * explicitly after the first run has fully settled, which prevents two engines
 * from editing one workspace at the same time.
 */

export type EngineStatus = {
  id: EngineId;
  capabilities: EngineAdapter['capabilities'];
  availability: EngineAvailability;
};

export type EngineStatusSnapshot = {
  defaultEngine: EngineId;
  engines: EngineStatus[];
};

export type EngineRegistryOptions = {
  adapters: Partial<Record<EngineId, EngineAdapter>>;
  defaultEngine: EngineId;
  arbiter?: EngineRunArbiter;
};

function statusFor(id: EngineId, adapter: EngineAdapter): EngineStatus {
  let availability: EngineAvailability;
  try {
    availability = adapter.describe();
  } catch {
    availability = {
      available: false,
      reason: 'server_unavailable',
      detail: 'The engine could not report its availability.',
    };
  }
  return { id, capabilities: adapter.capabilities, availability };
}

function failureFor(availability: EngineAvailability) {
  if (availability.available) {
    return null;
  }
  const code =
    availability.reason === 'disabled'
      ? 'disabled'
      : availability.reason === 'not_configured'
        ? 'not_configured'
        : availability.reason === 'sdk_unavailable'
          ? 'sdk_unavailable'
          : 'server_unavailable';
  return engineFailure(code, availability.detail);
}

export type EngineRunInput = {
  engine?: EngineId | null;
  request: EngineRunRequest;
};

export type EngineRegistryApi = {
  start: (input: EngineRunInput) => Promise<EngineResult<EngineRunHandle>>;
  select: (engine?: EngineId | null) => EngineResult<{ id: EngineId; adapter: EngineAdapter }>;
  snapshot: () => EngineStatusSnapshot;
  arbiter: EngineRunArbiter;
};

export function createEngineRegistry(options: EngineRegistryOptions): EngineRegistryApi {
  const arbiter = options.arbiter ?? new EngineRunArbiter();

  function select(engine?: EngineId | null): EngineResult<{ id: EngineId; adapter: EngineAdapter }> {
    const id = engine ?? options.defaultEngine;
    const adapter = options.adapters[id];
    if (!adapter) {
      return engineFailure('disabled', `The ${id} execution engine is not registered.`);
    }
    const status = statusFor(id, adapter);
    const failure = failureFor(status.availability);
    return failure ?? { ok: true, value: { id, adapter } };
  }

  async function start(
    input: EngineRunInput,
  ): Promise<EngineResult<EngineRunHandle>> {
    const selection = select(input.engine);
    if (!selection.ok) {
      return selection;
    }
    const { id, adapter } = selection.value;
    const acquired = arbiter.acquire(input.request.taskKey, id);
    if (!acquired.ok) {
      return acquired;
    }

    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      arbiter.release(input.request.taskKey, id);
    };

    let started: EngineResult<EngineRunHandle>;
    try {
      started = await adapter.start(input.request);
    } catch {
      release();
      return engineFailure('provider_error', 'The execution engine failed to start.');
    }
    if (!started.ok) {
      release();
      return started;
    }

    const handle = started.value;
    return {
      ok: true,
      value: {
        ...handle,
        result: handle.result.finally(release),
        cancel: async () => {
          try {
            await handle.cancel();
          } finally {
            release();
          }
        },
        close: async () => {
          try {
            await handle.close();
          } finally {
            release();
          }
        },
      },
    };
  }

  function snapshot(): EngineStatusSnapshot {
    const ids: EngineId[] = ['opencode', 'openhands'];
    return {
      defaultEngine: options.defaultEngine,
      engines: ids
        .map((id) => {
          const adapter = options.adapters[id];
          return adapter ? statusFor(id, adapter) : null;
        })
        .filter((status): status is EngineStatus => status !== null),
    };
  }

  return { start, select, snapshot, arbiter };
}

export type EngineRegistry = EngineRegistryApi;
