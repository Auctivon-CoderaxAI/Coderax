import type {
  EngineAdapter,
  EngineAvailability,
  EngineFailure,
  EngineId,
  EngineResult,
  EngineRunHandle,
  EngineRunRequest,
} from './types';
import { EngineRunArbiter } from './arbiter';
import { engineFailure } from './types';

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

function statusFor(id: EngineId, adapter: EngineAdapter, forStart = false): EngineStatus {
  let availability: EngineAvailability;
  try {
    availability =
      forStart && adapter.describeForStart ? adapter.describeForStart() : adapter.describe();
  } catch {
    availability = {
      available: false,
      reason: 'server_unavailable',
      detail: 'The engine could not report its availability.',
    };
  }
  return { id, capabilities: adapter.capabilities, availability };
}

function failureFor(availability: EngineAvailability): EngineFailure | null {
  if (availability.available) {
    return null;
  }
  switch (availability.reason) {
    case 'disabled':
      return engineFailure('disabled', availability.detail);
    case 'not_configured':
      return engineFailure('not_configured', availability.detail);
    case 'sdk_unavailable':
      return engineFailure('sdk_unavailable', availability.detail);
    default:
      return engineFailure('server_unavailable', availability.detail);
  }
}

export type EngineRunInput = {
  engine?: EngineId | null;
  request: EngineRunRequest;
};

export type EngineRegistryApi = {
  start: (input: EngineRunInput) => Promise<EngineResult<EngineRunHandle>>;
  select: (engine?: EngineId | null) => EngineResult<{ id: EngineId; adapter: EngineAdapter }>;
  snapshot: () => EngineStatusSnapshot;
  /** Refreshes adapters that have a bounded runtime readiness probe. */
  probe: () => Promise<void>;
  arbiter: EngineRunArbiter;
};

export function createEngineRegistry(options: EngineRegistryOptions): EngineRegistryApi {
  const arbiter = options.arbiter ?? new EngineRunArbiter();

  function select(
    engine?: EngineId | null,
    forStart = false,
  ): EngineResult<{ id: EngineId; adapter: EngineAdapter }> {
    const id = engine ?? options.defaultEngine;
    const adapter = options.adapters[id];
    if (!adapter) {
      return engineFailure('disabled', `The ${id} execution engine is not registered.`);
    }
    const status = statusFor(id, adapter, forStart);
    const failure = failureFor(status.availability);
    return failure ?? { ok: true, value: { id, adapter } };
  }

  async function start(input: EngineRunInput): Promise<EngineResult<EngineRunHandle>> {
    const selection = select(input.engine, true);
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
      if (started.cleanup) {
        // Keep ownership until late cancellation settles; a failed cleanup is
        // deliberately not allowed to make the task restartable.
        void started.cleanup.then(release, () => undefined);
      } else {
        release();
      }
      return started;
    }

    const handle = started.value;
    const releaseAfter =
      handle.cleanup ??
      handle.result.then(
        () => undefined,
        () => undefined,
      );
    void releaseAfter.then(release, release);
    return {
      ok: true,
      value: {
        ...handle,
        cancel: async () => {
          try {
            await handle.cancel();
            await handle.cleanup;
          } finally {
            release();
          }
        },
        close: async () => {
          try {
            await handle.close();
            await handle.cleanup;
          } finally {
            release();
          }
        },
      },
    };
  }

  function snapshot(): EngineStatusSnapshot {
    const ids: EngineId[] = ['opencode', 'openhands', 'freebuff'];
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

  async function probe(): Promise<void> {
    await Promise.all(Object.values(options.adapters).map((adapter) => adapter?.probe?.()));
  }

  return { start, select: (engine) => select(engine), snapshot, probe, arbiter };
}

export type EngineRegistry = EngineRegistryApi;
