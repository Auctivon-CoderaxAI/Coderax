import { randomUUID } from 'node:crypto';
import { logger, runAsSystem } from '@coderax/data-schemas';
import type { WorkflowRunEvent, WorkflowRunEventType } from 'coderax-data-provider';
import {
  WORKFLOW_EVENTS_MAX,
  WORKFLOW_RESULT_MAX_LENGTH,
  WORKFLOW_STEP_TIMEOUT_MS_DEFAULT,
} from 'coderax-data-provider';
import type {
  WorkflowEngine,
  WorkflowEngineDeps,
  WorkflowRunPatch,
  WorkflowRunRecord,
  WorkflowStepRecord,
} from './types';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_TICK_MS = 1_000;
const DEFAULT_RETRY_BASE_MS = 2_000;
const DEFAULT_RETRY_CAP_MS = 60_000;
const DEFAULT_STEP_TIMEOUT_MS = WORKFLOW_STEP_TIMEOUT_MS_DEFAULT;
const DEFAULT_MAX_PARALLEL = 2;
const DEFAULT_SCHEDULE_CONCURRENCY = 5;
const SCHEDULE_RETRY_MS = 60_000;
const MAX_ERROR_LENGTH = 2_048;

const STEP_ERROR = 'The agent turn did not complete. Open the conversation for details.';
const ENQUEUE_ERROR = 'The step could not be started. It will be retried.';

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return resolved;
}

function failureMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
}

function backoffMs(attempt: number, baseMs: number, capMs: number, random: () => number): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 20);
  const delay = Math.min(baseMs * 2 ** exponent, capMs);
  return Math.floor(delay / 2 + random() * (delay / 2));
}

function terminalGeneration(status: string | undefined): 'complete' | 'error' | null {
  if (status === 'complete') {
    return 'complete';
  }
  if (status === 'error' || status === 'aborted') {
    return 'error';
  }
  return null;
}

function terminalStep(status: WorkflowStepRecord['status']): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'skipped' || status === 'cancelled'
  );
}

function appendEvent(
  events: WorkflowRunEvent[],
  type: WorkflowRunEventType,
  at: Date,
  extra: { stepId?: string; message?: string } = {},
): WorkflowRunEvent[] {
  const next = [...events, { type, at: at.toISOString(), ...extra }];
  return next.length > WORKFLOW_EVENTS_MAX ? next.slice(-WORKFLOW_EVENTS_MAX) : next;
}

/** Dependencies of a step, defaulting legacy step lists to linear order. */
function dependenciesOf(steps: WorkflowStepRecord[], index: number): string[] {
  const step = steps[index];
  if (Array.isArray(step.dependsOn)) {
    return step.dependsOn;
  }
  return index === 0 ? [] : [steps[index - 1].id];
}

function dependentsOf(steps: WorkflowStepRecord[], id: string): number {
  let count = 0;
  steps.forEach((_step, index) => {
    if (dependenciesOf(steps, index).includes(id)) {
      count += 1;
    }
  });
  return count;
}

/**
 * A linear continuation keeps its predecessor's conversation so the agent sees
 * the same history. A fan-out branch forks a new conversation, and a merge forks
 * one too: concurrent turns cannot share a conversation, and the merge step
 * receives its predecessors' results as explicit context instead.
 */
function conversationFor(
  steps: WorkflowStepRecord[],
  index: number,
  runConversationId: string | undefined,
  newId: () => string,
): string {
  const step = steps[index];
  if (step.conversationId != null) {
    return step.conversationId;
  }
  const deps = dependenciesOf(steps, index);
  if (deps.length === 0) {
    return runConversationId ?? newId();
  }
  if (deps.length === 1) {
    const dependencyIndex = steps.findIndex((entry) => entry.id === deps[0]);
    const dependency = dependencyIndex >= 0 ? steps[dependencyIndex] : undefined;
    if (dependency?.conversationId != null && dependentsOf(steps, dependency.id) === 1) {
      return dependency.conversationId;
    }
  }
  return newId();
}

function handoffContext(
  steps: WorkflowStepRecord[],
  index: number,
  conversationId: string,
): string {
  const sections: string[] = [];
  for (const dependencyId of dependenciesOf(steps, index)) {
    const dependency = steps.find((entry) => entry.id === dependencyId);
    if (
      dependency?.result == null ||
      dependency.result.trim().length === 0 ||
      dependency.conversationId === conversationId
    ) {
      continue;
    }
    sections.push(`### ${dependency.title}\n${dependency.result}`);
  }
  if (sections.length === 0) {
    return '';
  }
  return `\n\nContext from earlier branches:\n\n${sections.join('\n\n')}`;
}

type Readiness = { kind: 'ready' } | { kind: 'wait' } | { kind: 'skip'; reason: string };

function readiness(steps: WorkflowStepRecord[], index: number): Readiness {
  const step = steps[index];
  for (const dependencyId of dependenciesOf(steps, index)) {
    const dependency = steps.find((entry) => entry.id === dependencyId);
    if (dependency == null) {
      return { kind: 'skip', reason: `Dependency ${dependencyId} is not part of this run` };
    }
    if (!terminalStep(dependency.status)) {
      return { kind: 'wait' };
    }
    const conditionHandlesFailure =
      step.runIf?.stepId === dependencyId && step.runIf.status === 'failed';
    if (dependency.status !== 'completed' && !conditionHandlesFailure) {
      return {
        kind: 'skip',
        reason: `Dependency ${dependency.title} settled as ${dependency.status}`,
      };
    }
  }
  if (step.runIf != null) {
    const condition = steps.find((entry) => entry.id === step.runIf?.stepId);
    if (condition == null) {
      return { kind: 'skip', reason: `Condition step ${step.runIf.stepId} is missing` };
    }
    if (!terminalStep(condition.status)) {
      return { kind: 'wait' };
    }
    if (condition.status !== step.runIf.status) {
      return {
        kind: 'skip',
        reason: `Condition not met: ${condition.title} settled as ${condition.status}`,
      };
    }
  }
  return { kind: 'ready' };
}

/**
 * Durable workflow runner. Every tick drains due schedules, claims a handful of
 * runs and advances each one: skipped branches are settled, in-flight turns are
 * checked, and every ready step is dispatched up to the run's parallelism. Only
 * durable state is read back, so a crash is recovered by the next tick rather
 * than by replaying an in-memory pipeline.
 */
export function createWorkflowEngine(
  deps: WorkflowEngineDeps,
  options: {
    concurrency?: number;
    leaseMs?: number;
    tickMs?: number;
    retryBaseMs?: number;
    retryCapMs?: number;
    stepTimeoutMs?: number;
    scheduleConcurrency?: number;
  } = {},
): WorkflowEngine {
  const concurrency = positiveInteger(options.concurrency, DEFAULT_CONCURRENCY, 'concurrency');
  const leaseMs = positiveInteger(options.leaseMs, DEFAULT_LEASE_MS, 'leaseMs');
  const tickMs = positiveInteger(options.tickMs, DEFAULT_TICK_MS, 'tickMs');
  const retryBaseMs = positiveInteger(options.retryBaseMs, DEFAULT_RETRY_BASE_MS, 'retryBaseMs');
  const retryCapMs = positiveInteger(options.retryCapMs, DEFAULT_RETRY_CAP_MS, 'retryCapMs');
  const stepTimeoutMs = positiveInteger(
    options.stepTimeoutMs,
    DEFAULT_STEP_TIMEOUT_MS,
    'stepTimeoutMs',
  );
  const scheduleConcurrency = positiveInteger(
    options.scheduleConcurrency,
    DEFAULT_SCHEDULE_CONCURRENCY,
    'scheduleConcurrency',
  );
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const newId = deps.newId ?? randomUUID;
  const workerId = deps.workerId ?? `${process.pid}-${randomUUID()}`;

  let started = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let activeTick: Promise<number> | undefined;
  let wakeQueued = false;

  const save = async (
    run: WorkflowRunRecord,
    leaseToken: string,
    patch: WorkflowRunPatch,
  ): Promise<boolean> => deps.store.saveRun({ runId: run.id, leaseToken, now: now(), patch });

  const settleRun = async (run: WorkflowRunRecord, status: WorkflowRunRecord['status']) => {
    if (deps.onRunSettled == null) {
      return;
    }
    try {
      await deps.onRunSettled({ ...run, status });
    } catch (cause) {
      logger.warn('[workflows] post-settlement hook failed', {
        runId: run.id,
        error: failureMessage(cause),
      });
    }
  };

  const drainSchedules = async (): Promise<void> => {
    const schedules = deps.schedules;
    if (schedules == null) {
      return;
    }
    const claimedAt = now();
    let claims;
    try {
      claims = await schedules.claimDue({
        workerId,
        now: claimedAt,
        leaseUntil: new Date(claimedAt.getTime() + leaseMs),
        limit: scheduleConcurrency,
      });
    } catch (cause) {
      logger.error('[workflows] schedule claim failed', { error: failureMessage(cause) });
      return;
    }
    await Promise.allSettled(
      claims.map(async (claim) => {
        let nextRunAt: Date | null = null;
        try {
          nextRunAt = schedules.computeNextRunAt({
            workflowId: claim.workflowId,
            cadence: claim.cadence,
            timezone: claim.timezone,
            after: claim.scheduledFor,
          });
          const run = await schedules.complete({
            workflowId: claim.workflowId,
            claimToken: claim.claimToken,
            scheduledFor: claim.scheduledFor,
            nextRunAt,
            now: claimedAt,
          });
          if (run != null) {
            logger.info('[workflows] scheduled occurrence queued', {
              workflowId: claim.workflowId,
              scheduledFor: claim.scheduledFor.toISOString(),
            });
          }
        } catch (cause) {
          logger.error('[workflows] scheduled occurrence failed', {
            workflowId: claim.workflowId,
            error: failureMessage(cause),
          });
          await schedules
            .release({
              workflowId: claim.workflowId,
              claimToken: claim.claimToken,
              nextRunAt: new Date(claimedAt.getTime() + SCHEDULE_RETRY_MS),
            })
            .catch((releaseCause: unknown) =>
              logger.warn('[workflows] schedule release failed', {
                workflowId: claim.workflowId,
                error: failureMessage(releaseCause),
              }),
            );
        }
      }),
    );
  };

  /**
   * Returns the patch that should be persisted for one run, or null when the
   * run is waiting and its durable state is already accurate.
   */
  const advance = async (
    run: WorkflowRunRecord,
    leaseToken: string,
  ): Promise<'released' | 'saved' | 'lost'> => {
    let status = run.status;
    let currentStep = run.currentStep;
    let error = run.error as string | null | undefined;
    let startedAt = run.startedAt;
    const steps = run.steps.map((step) => ({ ...step }));
    let events = [...(run.events ?? [])];
    const at = now();
    let dirty = false;

    const note = (
      type: WorkflowRunEventType,
      extra: { stepId?: string; message?: string } = {},
    ) => {
      events = appendEvent(events, type, at, extra);
      dirty = true;
    };

    const deriveCurrentStep = (): number => {
      const index = steps.findIndex((step) => !terminalStep(step.status));
      return index === -1 ? steps.length : index;
    };

    const saveRun = async (patch: WorkflowRunPatch = {}): Promise<'saved' | 'lost'> => {
      currentStep = deriveCurrentStep();
      const saved = await save(run, leaseToken, {
        status,
        currentStep,
        steps,
        events,
        ...(status === 'waiting_approval' ? {} : { error }),
        ...(startedAt == null ? {} : { startedAt }),
        ...patch,
      });
      dirty = false;
      return saved ? 'saved' : 'lost';
    };

    const failStep = (index: number, message: string): void => {
      const step = steps[index];
      step.status = 'failed';
      step.settledAt = at;
      step.error = message;
      step.availableAt = undefined;
      note('step.failed', { stepId: step.id, message });
    };

    const retryStep = (index: number, message: string): void => {
      const step = steps[index];
      step.status = 'queued';
      step.deliveryKey = undefined;
      step.error = message;
      step.availableAt = new Date(
        at.getTime() + backoffMs(step.attempts, retryBaseMs, retryCapMs, random),
      );
      note('step.retried', { stepId: step.id, message });
    };

    // A cancellation unsets the lease, so this worker no longer owns the run.
    if (status === 'cancelled') {
      return 'released';
    }

    // 1. Settle branches whose dependencies can never complete.
    for (let pass = 0; pass < steps.length; pass += 1) {
      let skipped = false;
      steps.forEach((step, index) => {
        if (terminalStep(step.status)) {
          return;
        }
        const decision = readiness(steps, index);
        if (decision.kind !== 'skip') {
          return;
        }
        step.status = 'skipped';
        step.settledAt = at;
        step.reason = decision.reason;
        step.availableAt = undefined;
        note('step.skipped', { stepId: step.id, message: decision.reason });
        skipped = true;
      });
      if (!skipped) {
        break;
      }
    }

    // 2. Read back the generations this run has in flight.
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (step.status !== 'running') {
        continue;
      }
      const conversationId = step.conversationId ?? run.conversationId;
      if (conversationId == null) {
        failStep(index, STEP_ERROR);
        continue;
      }
      let generation;
      try {
        generation = await deps.getGeneration(conversationId);
      } catch (cause) {
        logger.warn('[workflows] generation lookup failed', {
          runId: run.id,
          stepId: step.id,
          error: failureMessage(cause),
        });
        continue;
      }

      const stepStartedAt = step.startedAt?.getTime() ?? 0;
      const metadata = generation?.metadata;
      const metadataMatches =
        metadata?.workflowRunId == null && metadata?.workflowStepId == null
          ? true
          : metadata.workflowRunId === run.id && metadata.workflowStepId === step.id;
      const belongsToStep =
        generation != null &&
        metadataMatches &&
        (generation.createdAt == null || generation.createdAt >= stepStartedAt);
      const outcome = belongsToStep ? terminalGeneration(generation?.status) : null;

      // A paused tool approval is user-owned work, not a stuck turn.
      if (belongsToStep && generation?.status === 'requires_action') {
        continue;
      }

      if (outcome === 'complete') {
        step.status = 'completed';
        step.settledAt = at;
        step.availableAt = undefined;
        step.error = undefined;
        if (deps.readStepResult != null) {
          try {
            const result = await deps.readStepResult({ run, step, conversationId });
            if (result != null && result.trim().length > 0) {
              step.result = result.trim().slice(0, WORKFLOW_RESULT_MAX_LENGTH);
            }
          } catch (cause) {
            logger.warn('[workflows] step result read failed', {
              runId: run.id,
              stepId: step.id,
              error: failureMessage(cause),
            });
          }
        }
        note('step.completed', { stepId: step.id, message: step.title });
        continue;
      }

      const timeout = step.timeoutMs ?? run.settings?.stepTimeoutMs ?? stepTimeoutMs;
      const timedOut = step.startedAt != null && at.getTime() - step.startedAt.getTime() > timeout;

      if (outcome === 'error' || timedOut) {
        if (timedOut && deps.abortGeneration != null) {
          await deps
            .abortGeneration(conversationId, {
              ...(generation?.createdAt == null ? {} : { expectedCreatedAt: generation.createdAt }),
            })
            .catch((cause: unknown) =>
              logger.warn('[workflows] timed-out generation abort failed', {
                runId: run.id,
                stepId: step.id,
                error: failureMessage(cause),
              }),
            );
        }
        if (step.attempts >= step.maxAttempts) {
          failStep(index, STEP_ERROR);
        } else {
          retryStep(index, STEP_ERROR);
        }
      }
    }

    if (!steps.every((step) => terminalStep(step.status))) {
      const running = steps.filter((step) => step.status === 'running').length;

      if (run.pauseRequestedAt != null && running === 0) {
        status = 'paused';
        return saveRun();
      }

      // 3. Dispatch every ready step the parallelism budget allows.
      const maxParallel = Math.max(
        1,
        Math.min(run.settings?.maxParallel ?? DEFAULT_MAX_PARALLEL, steps.length),
      );
      let budget = Math.max(0, maxParallel - running);
      let approvalStepId: string | undefined;

      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        if (step.status !== 'pending' && step.status !== 'queued') {
          continue;
        }
        if (step.deliveryKey != null) {
          continue;
        }
        if (readiness(steps, index).kind !== 'ready') {
          continue;
        }
        if (step.availableAt != null && step.availableAt.getTime() > at.getTime()) {
          continue;
        }
        if (step.approvalRequired && step.approvedAt == null) {
          approvalStepId = approvalStepId ?? step.id;
          continue;
        }
        if (budget <= 0) {
          continue;
        }

        const conversationId = conversationFor(steps, index, run.conversationId, newId);
        step.conversationId = conversationId;
        const instruction =
          step.instruction +
          (index === 0 && run.input != null && run.input.trim().length > 0
            ? `\n\nAdditional context for this run:\n${run.input}`
            : '') +
          handoffContext(steps, index, conversationId);

        step.attempts += 1;
        step.status = 'running';
        // Timeout and generation fencing are scoped to this attempt, not the first attempt.
        step.startedAt = at;
        step.error = undefined;
        step.availableAt = undefined;
        startedAt = startedAt ?? at;
        status = status === 'queued' ? 'running' : status;

        try {
          const deliveryKey = await deps.enqueueStep({
            run: { ...run, status, events, steps, startedAt },
            step: { ...step, instruction },
            stepIndex: index,
          });
          step.deliveryKey = deliveryKey;
          note(step.attempts > 1 ? 'step.retried' : 'step.dispatched', {
            stepId: step.id,
            message: `Attempt ${step.attempts}`,
          });
          budget -= 1;
          const saved = await saveRun();
          if (saved === 'lost') {
            return 'lost';
          }
        } catch (cause) {
          logger.error('[workflows] step dispatch failed', {
            runId: run.id,
            stepId: step.id,
            attempt: step.attempts,
            error: failureMessage(cause),
          });
          if (step.attempts >= step.maxAttempts) {
            failStep(index, ENQUEUE_ERROR);
            status = 'failed';
            error = ENQUEUE_ERROR;
            const saved = await saveRun({ settledAt: at });
            if (saved === 'saved') {
              await settleRun({ ...run, status, steps, events }, status);
            }
            return saved;
          }
          retryStep(index, ENQUEUE_ERROR);
          return saveRun();
        }
      }

      const stillRunning = steps.filter((step) => step.status === 'running').length;
      if (approvalStepId != null && stillRunning === 0) {
        status = 'waiting_approval';
        note('step.approval_required', {
          stepId: approvalStepId,
          message: 'Waiting for a human approval',
        });
      }
      if (!dirty) {
        return 'released';
      }
      return saveRun();
    }

    // 4. Every step settled: a failed step fails the run unless a step guarded
    //    explicitly by that failure completed and handled it.
    const unhandledFailure = steps.some(
      (step) =>
        step.status === 'failed' &&
        !steps.some(
          (candidate) =>
            candidate.runIf?.stepId === step.id &&
            candidate.runIf.status === 'failed' &&
            candidate.status === 'completed',
        ),
    );
    status = unhandledFailure ? 'failed' : 'completed';
    error = unhandledFailure ? (error ?? STEP_ERROR) : null;
    note(unhandledFailure ? 'run.failed' : 'run.completed');
    startedAt = startedAt ?? at;
    const saved = await saveRun({ settledAt: at });
    if (saved === 'saved') {
      await settleRun({ ...run, status, steps, events, startedAt }, status);
    }
    return saved;
  };

  const processRun = async (run: WorkflowRunRecord, leaseToken: string): Promise<void> => {
    try {
      await advance(run, leaseToken);
    } catch (cause) {
      logger.error('[workflows] run advance failed', {
        runId: run.id,
        error: failureMessage(cause),
      });
    } finally {
      await deps.store.releaseRun({ runId: run.id, leaseToken, now: now() }).catch((cause) =>
        logger.warn('[workflows] run lease release failed', {
          runId: run.id,
          error: failureMessage(cause),
        }),
      );
    }
  };

  const runTick = async (): Promise<number> => {
    if (stopped) {
      return 0;
    }
    if (activeTick != null) {
      wakeQueued = true;
      return activeTick;
    }
    const tick = (async () => {
      await drainSchedules();
      const claimToken = randomUUID();
      const claimedAt = now();
      let runs: WorkflowRunRecord[];
      try {
        runs = await deps.store.claimRuns({
          workerId,
          leaseToken: claimToken,
          now: claimedAt,
          leaseUntil: new Date(claimedAt.getTime() + leaseMs),
          limit: concurrency,
        });
      } catch (cause) {
        logger.error('[workflows] run claim failed', { error: failureMessage(cause) });
        return 0;
      }
      await Promise.allSettled(runs.map((run) => runAsSystem(() => processRun(run, claimToken))));
      return runs.length;
    })();

    activeTick = tick;
    try {
      return await tick;
    } finally {
      activeTick = undefined;
      if (wakeQueued && started && !stopped) {
        wakeQueued = false;
        queueMicrotask(wake);
      }
    }
  };

  const schedule = (): void => {
    if (stopped) {
      return;
    }
    if (timer != null) {
      clearTimeout(timer);
    }
    timer = setTimeout(async () => {
      await runTick().catch((cause) =>
        logger.error('[workflows] scheduled tick failed', { error: failureMessage(cause) }),
      );
      schedule();
    }, tickMs);
    timer.unref?.();
  };

  function wake(): void {
    if (stopped) {
      return;
    }
    void runTick().catch((cause) =>
      logger.error('[workflows] wake tick failed', { error: failureMessage(cause) }),
    );
  }

  return {
    start: () => {
      if (started || stopped) {
        return;
      }
      started = true;
      schedule();
      wake();
    },
    stop: async () => {
      stopped = true;
      if (timer != null) {
        clearTimeout(timer);
      }
      await activeTick?.catch(() => undefined);
    },
    wake,
    runTick,
  };
}
