import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import type { EngineWorkChatConfig, EngineWorkChatRunner, RunScope } from './types';
import type { DataMode, EngineId, EngineResult, EngineRunHandle } from '../types';
import type { EngineRegistryApi, EngineStatusSnapshot } from '../registry';
import type { EngineModelRef } from '../opencode/models';
import type { WorkRunLeaseStore } from './leases';
import type { EngineRetryPolicy } from '../retry';
import {
  DEFAULT_WORK_RUN_LEASE_TTL_MS,
  DEFAULT_WORK_RUN_RETENTION_MS,
  WORK_RUN_SWEEP_LIMIT,
  memoryWorkRunLeases,
} from './leases';
import {
  DEFAULT_ENGINE_RETRY_POLICY,
  canRetryWithin,
  isRetryableStartFailure,
  normalizeEngineRetryPolicy,
  wait,
} from '../retry';
import { parseEngineModel } from '../opencode/models';
import { createExecutionEngines } from '../service';
import { engineFailure } from '../types';

type ActiveRun = {
  handle: EngineRunHandle;
  /** Fences this process's run from a lease another replica has taken over. */
  token: string;
  heartbeat: ReturnType<typeof setInterval> | null;
  cancelRequested: boolean;
  cancel: () => Promise<void>;
};

/**
 * Active runs are process-level state, not runtime-cache state. A config change
 * can create a new runtime cache entry, but state/cancel must still reach the
 * run that the previous entry started. Durable run state lives in the lease
 * store; this map only holds the handles a process can actually abort.
 */
const activeRuns = new Map<string, ActiveRun>();

function activeRunKey(input: RunScope): string {
  return JSON.stringify([input.tenantId, input.userId, input.conversationId]);
}

/**
 * The model each engine is dispatched with. A run is pinned to the model its own
 * engine approved, so selecting OpenCode Agent never runs the FreeBuff model (or
 * the reverse) just because a different engine is the configured default.
 *
 * Only engines that accept a per-run model appear here. FreeBuff resolves its
 * model from its adapter configuration, so a request-level model would describe
 * that run inaccurately.
 */
export type EngineRunModels = Partial<Record<EngineId, EngineModelRef>>;

export function engineRunModels(
  engines: NonNullable<EngineWorkChatConfig>['engines'] | null | undefined,
): EngineRunModels {
  const model = parseEngineModel(engines?.opencode?.model);
  return model ? { opencode: model } : {};
}

export class EngineWorkChatRuntime implements EngineWorkChatRunner {
  private readonly registry: EngineRegistryApi;
  private readonly roots: { private: string; cloud: string };
  private readonly mode: DataMode;
  private readonly models: EngineRunModels;
  private readonly defaultEngine: EngineId;
  private readonly leases: WorkRunLeaseStore;
  private readonly retry: EngineRetryPolicy;
  private readonly instanceId = randomUUID();
  private readonly leaseTtlMs: number;
  private readonly heartbeatMs: number;
  /** One sweep per lease TTL, and never two at once, per runtime instance. */
  private nextSweepAt = 0;
  private sweeping = false;

  constructor(
    registry: EngineRegistryApi,
    roots: { private: string; cloud: string },
    mode: DataMode = 'private',
    models: EngineRunModels = {},
    defaultEngine: EngineId = 'opencode',
    leases: WorkRunLeaseStore = memoryWorkRunLeases,
    leaseTtlMs: number = DEFAULT_WORK_RUN_LEASE_TTL_MS,
    retry: EngineRetryPolicy = DEFAULT_ENGINE_RETRY_POLICY,
  ) {
    this.registry = registry;
    this.roots = roots;
    this.mode = mode;
    this.models = models;
    this.defaultEngine = defaultEngine;
    this.leases = leases;
    this.leaseTtlMs = leaseTtlMs;
    this.retry = normalizeEngineRetryPolicy(retry);
    this.heartbeatMs = Math.max(5, Math.floor(leaseTtlMs / 3));
  }

  snapshot(): EngineStatusSnapshot {
    return this.registry.snapshot();
  }

  async refreshSnapshot(): Promise<EngineStatusSnapshot> {
    await this.registry.probe();
    return this.snapshot();
  }

  /**
   * A lease that is still renewed is a running task. One that stopped
   * heartbeating belongs to a restart, a crash or a replica that went away, so
   * its run was interrupted and reports `failed`; a live lease with a
   * cancellation flag is a run that is being stopped on request.
   */
  async state(input: RunScope): Promise<string | null> {
    const lease = await this.leases.read(input, new Date());
    /**
     * Sweep after reading: a dead row is the only evidence of the interruption,
     * so cleanup must never remove one before the caller has observed it.
     */
    this.sweepDeadLeases();
    if (!lease) {
      return null;
    }
    if (!lease.live) {
      return 'failed';
    }
    return lease.cancelRequested ? 'cancelled' : 'running';
  }

  async cancel(input: RunScope): Promise<boolean> {
    const key = activeRunKey(input);
    const run = activeRuns.get(key);
    if (run) {
      run.cancelRequested = true;
      this.stopHeartbeat(run);
      await run.cancel();
      return true;
    }
    /** The run belongs to another replica, or to a process that is gone. */
    return (await this.leases.cancel(input, new Date())) !== 'none';
  }

  async release(input: RunScope & { handle?: EngineRunHandle }): Promise<boolean> {
    const key = activeRunKey(input);
    const run = activeRuns.get(key);
    if (!run || (input.handle != null && run.handle !== input.handle)) {
      return false;
    }
    activeRuns.delete(key);
    this.stopHeartbeat(run);
    await this.leases.release(input, run.token);
    return true;
  }

  async start(
    input: RunScope & { prompt: string; engine?: EngineId; beforeDispatch?: () => Promise<void> },
  ): Promise<EngineResult<EngineRunHandle>> {
    const engine = input.engine ?? this.defaultEngine;
    if (engine !== 'opencode' && engine !== 'freebuff') {
      return engineFailure(
        'not_configured',
        'An OpenCode Agent or FreeBuff Agent selection is required.',
      );
    }
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
    this.sweepDeadLeases();

    /** Claim before starting so a second replica cannot run the same task. */
    const token = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.leaseTtlMs);
    const claimed = await this.leases.claim(input, {
      token,
      owner: this.instanceId,
      now,
      expiresAt,
    });
    if (!claimed) {
      return engineFailure('busy', 'Another engine run is already active for this task.');
    }

    const model = this.models[engine];
    /**
     * The conversation row is written once, before a successful dispatch. A
     * readiness refusal runs before the callback, so the callback stays on the
     * retry until it has completed; afterwards it is omitted so the row is not
     * written again. The wrapper keeps a retry idempotent even when the
     * registry repeats the callback.
     */
    const beforeDispatch = input.beforeDispatch;
    let recorded = false;
    const writeOnce =
      beforeDispatch == null
        ? undefined
        : async (): Promise<void> => {
            if (recorded) {
              return;
            }
            await beforeDispatch();
            recorded = true;
          };
    const dispatch = () =>
      this.registry.start({
        engine,
        ...(writeOnce && !recorded ? { beforeDispatch: writeOnce } : {}),
        request: {
          taskKey: this.mode === 'cloud' ? key : input.conversationId,
          conversationId: input.conversationId,
          prompt: input.prompt,
          mode: this.mode,
          workspaceRoot,
          ...(model ? { model } : {}),
        },
      });

    let started = await dispatch();
    for (let attempt = 1; ; attempt += 1) {
      if (
        started.ok ||
        attempt >= this.retry.maxAttempts ||
        !isRetryableStartFailure(started) ||
        !canRetryWithin(now.getTime(), this.retry.delayMs, this.leaseTtlMs)
      ) {
        break;
      }
      await wait(this.retry.delayMs);
      /**
       * The delay is time in which the owner can cancel and another replica
       * can claim an expired lease. Re-read the lease before dispatching again:
       * an engine must not start for a cancelled task or one this run no longer
       * owns. `renew` also extends the lease so the retry stays fenced.
       */
      const retryAt = new Date();
      let lease: { renewed: boolean; cancelRequested: boolean };
      try {
        lease = await this.leases.renew(
          input,
          token,
          retryAt,
          new Date(retryAt.getTime() + this.leaseTtlMs),
        );
      } catch {
        lease = { renewed: false, cancelRequested: false };
      }
      if (lease.cancelRequested) {
        await this.leases.release(input, token).catch(() => false);
        return engineFailure('cancelled', 'The run was cancelled before it started.');
      }
      if (!lease.renewed) {
        return engineFailure('busy', 'This run no longer owns the task.');
      }
      started = await dispatch();
    }
    if (!started.ok) {
      /**
       * The engine never ran, so there is nothing to report but its own typed
       * failure. A release that fails must not replace it with a thrown error;
       * the unclaimed lease simply expires.
       */
      await this.leases.release(input, token).catch(() => false);
      return started;
    }

    const run: ActiveRun = {
      handle: started.value,
      token,
      heartbeat: null,
      cancelRequested: false,
      cancel: started.value.cancel,
    };
    activeRuns.set(key, run);
    this.startHeartbeat(input, key, run);
    return started;
  }

  /**
   * Reclaims rows left by a process that died in a bounded batch. Run traffic
   * drives it, one sweep per lease TTL, so a busy deployment does not stack
   * deletes and an idle one does no work; the retention window keeps a crashed
   * run's `failed` state readable until this runs.
   */
  private sweepDeadLeases(): void {
    const now = Date.now();
    if (this.sweeping || now < this.nextSweepAt) {
      return;
    }
    this.sweeping = true;
    this.nextSweepAt = now + this.leaseTtlMs;
    void this.leases
      .prune(new Date(now - DEFAULT_WORK_RUN_RETENTION_MS), WORK_RUN_SWEEP_LIMIT)
      .catch(() => 0)
      .finally(() => {
        this.sweeping = false;
      });
  }

  private stopHeartbeat(run: ActiveRun): void {
    if (run.heartbeat) {
      clearInterval(run.heartbeat);
      run.heartbeat = null;
    }
  }

  private startHeartbeat(input: RunScope, key: string, run: ActiveRun): void {
    const tick = (): void => {
      void this.refreshLease(input, key, run);
    };
    run.heartbeat = setInterval(tick, this.heartbeatMs);
    run.heartbeat.unref?.();
    tick();
  }

  /**
   * Keeps the lease alive and observes cancellation requested elsewhere. Losing
   * the lease means another replica owns the task now, so this run aborts rather
   * than writing state the owner no longer controls.
   */
  private async refreshLease(input: RunScope, key: string, run: ActiveRun): Promise<void> {
    if (activeRuns.get(key) !== run) {
      return;
    }
    const now = new Date();
    let renewed: { renewed: boolean; cancelRequested: boolean };
    try {
      renewed = await this.leases.renew(
        input,
        run.token,
        now,
        new Date(now.getTime() + this.leaseTtlMs),
      );
    } catch {
      /** A transient store outage must not abort a healthy run; the next tick
       * retries, and the lease expiry bounds how long another replica is fenced. */
      return;
    }
    if (!renewed.renewed) {
      activeRuns.delete(key);
      this.stopHeartbeat(run);
      await run.cancel().catch(() => undefined);
      return;
    }
    if (renewed.cancelRequested && !run.cancelRequested) {
      run.cancelRequested = true;
      this.stopHeartbeat(run);
      await run.cancel().catch(() => undefined);
    }
  }
}

/** Distinct lease stores never share a cached runtime. */
const runtimes = new WeakMap<WorkRunLeaseStore, Map<string, EngineWorkChatRuntime>>();

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
    retry: engines?.retry ?? null,
  });
}

/**
 * One registry (and therefore one lease table) per configured engine shape.
 * The lease store is supplied by the caller so run state is durable where the
 * deployment has a database, and process-local in tests.
 */
export function getEngineWorkChatRuntime(
  config: EngineWorkChatConfig | null | undefined,
  leases: WorkRunLeaseStore = memoryWorkRunLeases,
): EngineWorkChatRuntime {
  let cache = runtimes.get(leases);
  if (!cache) {
    cache = new Map();
    runtimes.set(leases, cache);
  }
  const key = runtimeKey(config);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const roots = {
    private: config?.engines?.workspaces?.privateRoot ?? '',
    cloud: config?.engines?.workspaces?.cloudRoot ?? '',
  };
  const engines = config?.engines;
  const mode = config?.engines?.workChat?.mode === 'cloud' ? 'cloud' : 'private';
  const workEngine = engines?.defaultEngine ?? 'opencode';
  /** Each engine keeps the model its own configuration approved. */
  const models = engineRunModels(engines);
  const retry = normalizeEngineRetryPolicy(engines?.retry);
  const runtime = new EngineWorkChatRuntime(
    createExecutionEngines(config),
    roots,
    mode,
    models,
    workEngine,
    leases,
    DEFAULT_WORK_RUN_LEASE_TTL_MS,
    retry,
  );
  cache.set(key, runtime);
  return runtime;
}
