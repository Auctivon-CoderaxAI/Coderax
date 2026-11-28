import { randomUUID } from 'node:crypto';
import { logger, runAsSystem } from '@coderax/data-schemas';
import {
  WORKFLOW_EVENTS_MAX,
  WORKFLOW_HANDOFF_MAX_LENGTH,
  WORKFLOW_RESULT_MAX_LENGTH,
  WORKFLOW_STEP_TIMEOUT_MS_DEFAULT,
} from 'coderax-data-provider';
import type {
  WorkflowBuildSettings,
  WorkflowRunVerification,
  WorkflowStepCondition,
  WorkflowStepConditionStatus,
  WorkflowStepJoin,
} from 'coderax-data-provider';
import type { WorkflowRunEvent, WorkflowRunEventType } from 'coderax-data-provider';
import type {
  WorkflowEngine,
  WorkflowEngineDeps,
  WorkflowEngineOptions,
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
const BUILD_UNVERIFIED_ERROR =
  'The build did not produce the evidence required to complete. See the run verification report.';

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
  const seq = Math.max(events[events.length - 1]?.seq ?? 0, events.length) + 1;
  const next = [...events, { seq, type, at: at.toISOString(), ...extra }];
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

function conditionsOf(step: WorkflowStepRecord): WorkflowStepCondition[] {
  if (step.runIf == null) {
    return [];
  }
  return Array.isArray(step.runIf) ? step.runIf : [step.runIf];
}

function conditionStatus(condition: WorkflowStepCondition): WorkflowStepConditionStatus {
  return condition.status ?? 'completed';
}

function conditionMatches(step: WorkflowStepRecord, condition: WorkflowStepCondition): boolean {
  if (step.status !== conditionStatus(condition)) {
    return false;
  }
  if (condition.resultIncludes == null) {
    return true;
  }
  const needle = condition.resultIncludes.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return (step.result ?? '').toLowerCase().includes(needle);
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
    // Only the first independent root may reuse the run's conversation.
    // Other roots can run concurrently and must not share a generation slot.
    const firstRootIndex = steps.findIndex(
      (_, candidate) => dependenciesOf(steps, candidate).length === 0,
    );
    return index === firstRootIndex ? (runConversationId ?? newId()) : newId();
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

interface HandoffSection {
  title: string;
  body: string;
}

/**
 * A merge step reads what its branch predecessors actually produced. Results
 * are shared fairly under one bounded budget instead of dropping every branch
 * after the first, and a skipped or failed branch contributes its reason so the
 * merge can explain the missing input rather than silently ignoring it.
 */
function handoffContext(steps: WorkflowStepRecord[], index: number): string {
  const sections: HandoffSection[] = [];
  for (const dependencyId of dependenciesOf(steps, index)) {
    const dependency = steps.find((entry) => entry.id === dependencyId);
    if (dependency == null) {
      continue;
    }
    const body =
      dependency.status === 'completed'
        ? (dependency.result ?? '').trim()
        : [dependency.reason, dependency.error]
            .filter((value): value is string => value != null && value.trim().length > 0)
            .join('\n');
    if (body.length === 0) {
      continue;
    }
    sections.push({
      title:
        dependency.status === 'completed'
          ? dependency.title
          : `${dependency.title} (${dependency.status})`,
      body,
    });
  }
  if (sections.length === 0) {
    return '';
  }
  const header = '\n\nContext from earlier branches:\n\n';
  const budget = Math.max(1, WORKFLOW_HANDOFF_MAX_LENGTH - header.length);
  const perSection = Math.max(1, Math.floor(budget / sections.length) - 24);
  const rendered = sections.map(({ title, body }) => {
    const trimmed = body.length > perSection ? `${body.slice(0, perSection)}\n[truncated]` : body;
    return `### ${title}\n${trimmed}`;
  });
  return `${header}${rendered.join('\n\n')}`.slice(0, WORKFLOW_HANDOFF_MAX_LENGTH);
}

type Readiness = { kind: 'ready' } | { kind: 'wait' } | { kind: 'skip'; reason: string };

function readiness(steps: WorkflowStepRecord[], index: number): Readiness {
  const step = steps[index];
  const conditions = conditionsOf(step);
  const join: WorkflowStepJoin = step.join ?? 'all';
  const dependencies = dependenciesOf(steps, index);

  // Conditions are evaluated only after the steps they name have settled, so a
  // branch never starts on a partial result.
  for (const condition of conditions) {
    const conditionStep = steps.find((entry) => entry.id === condition.stepId);
    if (conditionStep == null) {
      return { kind: 'skip', reason: `Condition step ${condition.stepId} is missing` };
    }
    if (!terminalStep(conditionStep.status)) {
      return { kind: 'wait' };
    }
  }

  const unmet = conditions.find((condition) => {
    const conditionStep = steps.find((entry) => entry.id === condition.stepId);
    return conditionStep == null ? false : !conditionMatches(conditionStep, condition);
  });
  if (unmet != null) {
    const conditionStep = steps.find((entry) => entry.id === unmet.stepId);
    const label = conditionStep?.title ?? unmet.stepId;
    if (unmet.resultIncludes != null) {
      return {
        kind: 'skip',
        reason: `Condition not met: ${label} did not produce the required result`,
      };
    }
    return {
      kind: 'skip',
      reason: `Condition not met: ${label} settled as ${conditionStep?.status ?? 'missing'}`,
    };
  }

  if (dependencies.length === 0) {
    return { kind: 'ready' };
  }

  const resolved = dependencies.map((id) => steps.find((entry) => entry.id === id));
  const missing = resolved.findIndex((entry) => entry == null);
  if (missing >= 0) {
    return { kind: 'skip', reason: `Dependency ${dependencies[missing]} is not part of this run` };
  }

  if (join === 'any') {
    const settled = resolved.filter(
      (entry): entry is WorkflowStepRecord => entry != null && terminalStep(entry.status),
    );
    if (settled.some((entry) => entry.status === 'completed')) {
      return { kind: 'ready' };
    }
    if (settled.length === dependencies.length) {
      return { kind: 'skip', reason: 'No dependency completed' };
    }
    return { kind: 'wait' };
  }

  for (const dependency of resolved) {
    if (dependency == null) {
      continue;
    }
    if (!terminalStep(dependency.status)) {
      return { kind: 'wait' };
    }
    if (dependency.status === 'completed') {
      continue;
    }
    // A condition may deliberately continue from a failure or a skipped branch.
    const handled = conditions.some(
      (condition) =>
        condition.stepId === dependency.id && conditionStatus(condition) === dependency.status,
    );
    if (handled) {
      continue;
    }
    return {
      kind: 'skip',
      reason: `Dependency ${dependency.title} settled as ${dependency.status}`,
    };
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
  options: WorkflowEngineOptions = {},
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

  const settleRun = async (
    run: WorkflowRunRecord,
    status: WorkflowRunRecord['status'],
  ): Promise<boolean> => {
    if (deps.onRunSettled == null) {
      return true;
    }
    try {
      await deps.onRunSettled({ ...run, status });
      return true;
    } catch (cause) {
      logger.warn('[workflows] post-settlement hook failed', {
        runId: run.id,
        error: failureMessage(cause),
      });
      return false;
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
              retryAt: new Date(claimedAt.getTime() + SCHEDULE_RETRY_MS),
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
   * Stops the turn a worker just admitted after losing the run lease to a
   * cancellation. Identity-fenced on the generation metadata where the host
   * projects it, so an unrelated newer turn in the same conversation survives.
   */
  const abortDispatchedStep = async (
    run: WorkflowRunRecord,
    conversationId: string,
    step: WorkflowStepRecord,
  ): Promise<void> => {
    if (deps.abortGeneration == null) {
      return;
    }
    try {
      const generation = await deps.getGeneration(conversationId);
      if (generation == null) {
        return;
      }
      const metadata = generation.metadata;
      const belongsToStep =
        metadata?.workflowRunId == null && metadata?.workflowStepId == null
          ? true
          : metadata.workflowRunId === run.id && metadata.workflowStepId === step.id;
      if (!belongsToStep) {
        return;
      }
      await deps.abortGeneration(conversationId, {
        ...(generation.createdAt == null ? {} : { expectedCreatedAt: generation.createdAt }),
      });
    } catch (cause) {
      logger.warn('[workflows] orphaned dispatch abort failed', {
        runId: run.id,
        stepId: step.id,
        error: failureMessage(cause),
      });
    }
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
      step.terminalStatus = undefined;
      step.terminalAttempt = undefined;
      step.terminalAt = undefined;
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

    // A completed run with a pending chain is claimed again after a crash or a
    // failed downstream delivery. The child create is deduplicated by parent id.
    if (status === 'completed' && run.chainPending === true) {
      const delivered = await settleRun(run, 'completed');
      if (!delivered) {
        return 'released';
      }
      return (await save(run, leaseToken, { chainPending: false })) ? 'saved' : 'lost';
    }

    const settleSkippedBranches = (): void => {
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
    };

    // 1. Settle branches whose dependencies can never complete.
    settleSkippedBranches();

    // 2. Read back the generations this run has in flight.
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (step.status !== 'running') {
        continue;
      }
      // A worker can crash after persisting the dispatch intent but before the
      // delivery id is written. No generation can belong to this attempt yet, so
      // re-queue it after a short grace instead of waiting for the full timeout.
      if (step.deliveryKey == null) {
        const startedAtMs = step.startedAt?.getTime() ?? at.getTime();
        if (at.getTime() - startedAtMs >= retryBaseMs) {
          if (step.attempts >= step.maxAttempts) {
            failStep(index, ENQUEUE_ERROR);
            status = 'failed';
            error = ENQUEUE_ERROR;
          } else {
            retryStep(index, ENQUEUE_ERROR);
          }
        }
        continue;
      }
      const durableOutcome =
        step.terminalAttempt === step.attempts && step.terminalStatus != null
          ? terminalGeneration(step.terminalStatus)
          : null;
      const conversationId = step.conversationId ?? run.conversationId;
      if (durableOutcome == null && conversationId == null) {
        failStep(index, STEP_ERROR);
        continue;
      }
      let generation;
      let outcome = durableOutcome;
      let belongsToStep = false;
      if (outcome == null && conversationId != null) {
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
        belongsToStep =
          generation != null &&
          metadataMatches &&
          (generation.createdAt == null || generation.createdAt >= stepStartedAt);
        outcome = belongsToStep ? terminalGeneration(generation?.status) : null;
      }

      // A paused tool approval is user-owned work, not a stuck turn.
      if (belongsToStep && generation?.status === 'requires_action') {
        continue;
      }

      if (outcome === 'complete') {
        step.status = 'completed';
        step.settledAt = at;
        step.availableAt = undefined;
        step.error = undefined;
        step.terminalStatus = 'complete';
        step.terminalAttempt = step.attempts;
        step.terminalAt = at;
        if (step.result == null && deps.readStepResult != null && conversationId != null) {
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
      const timedOut =
        durableOutcome == null &&
        step.startedAt != null &&
        at.getTime() - step.startedAt.getTime() > timeout;

      if (outcome === 'error' || timedOut) {
        if (timedOut && deps.abortGeneration != null && conversationId != null) {
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

    // A step can settle during readback (completed or failed), which may now
    // decide a branch that was waiting at the start of this tick. Settle those
    // before dispatch so a rejected branch cannot linger another interval.
    settleSkippedBranches();

    if (!steps.every((step) => terminalStep(step.status))) {
      const running = steps.filter((step) => step.status === 'running').length;

      if (run.pauseRequestedAt != null) {
        if (running === 0) {
          status = 'paused';
          return saveRun();
        }
        // Observe and persist in-flight results, but never admit a new branch
        // while a pause is pending, even if another branch frees a slot.
        return dirty ? saveRun() : 'released';
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
          handoffContext(steps, index);

        step.attempts += 1;
        step.status = 'running';
        step.terminalStatus = undefined;
        step.terminalAttempt = undefined;
        step.terminalAt = undefined;
        // Timeout and generation fencing are scoped to this attempt, not the first attempt.
        step.startedAt = at;
        step.error = undefined;
        step.availableAt = undefined;
        startedAt = startedAt ?? at;
        status = status === 'queued' ? 'running' : status;

        // Persist the dispatch intent before enqueueing. This write is fenced by
        // the run lease, so a cancellation (which clears the lease) wins the race
        // and this worker must not start a turn at all. A crash between this write
        // and the delivery id is recovered by the delivery-less running branch above.
        const intent = await saveRun();
        if (intent === 'lost') {
          return 'lost';
        }

        try {
          const deliveryKey = await deps.enqueueStep({
            run: { ...run, status, events, steps, startedAt },
            step: { ...step, instruction },
            stepIndex: index,
          });
          budget -= 1;
          step.deliveryKey = deliveryKey;
          note(step.attempts > 1 ? 'step.retried' : 'step.dispatched', {
            stepId: step.id,
            message: `Attempt ${step.attempts}`,
          });
          const saved = await saveRun();
          if (saved === 'lost') {
            await abortDispatchedStep(run, conversationId, step);
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
            error = ENQUEUE_ERROR;
            settleSkippedBranches();
            // Keep the run active. A sibling turn may already be in flight, and
            // it must still be observed and settled before the run can fail.
            return saveRun();
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

    /**
     * Asks the host for the run's build evidence. An unwired verifier, a throw,
     * or any verdict but `verified` becomes retained failure evidence: a build
     * run never completes on the strength of its turns alone.
     *
     * Verification runs inside the run lease, so the lease is renewed before the
     * first command and while it runs. A test suite that outlives a 30-second
     * lease would otherwise be claimed and executed again by another worker, and
     * this worker's verdict would be fenced out of the write. Losing the lease
     * aborts the commands and returns without writing anything, so the new owner
     * is never racing a duplicate run of the same verification.
     */
    const verifySettlement = async (
      build: WorkflowBuildSettings,
    ): Promise<WorkflowRunVerification | 'lost'> => {
      const unresolved = (): WorkflowRunVerification => ({
        status: 'failed',
        mode: build.mode,
        outcome: 'complete_unverified',
        checkedAt: at.toISOString(),
        summary: BUILD_UNVERIFIED_ERROR,
        gates: [],
        blockers: [BUILD_UNVERIFIED_ERROR],
      });
      if (deps.verifyRun == null) {
        logger.error('[workflows] build settlement has no verifier', { runId: run.id });
        return unresolved();
      }

      const controller = new AbortController();
      let lost = false;
      let renewing = false;
      const renew = async (): Promise<void> => {
        if (renewing || lost) {
          return;
        }
        renewing = true;
        try {
          const renewedAt = now();
          const extended = await deps.store.extendLease({
            runId: run.id,
            leaseToken,
            now: renewedAt,
            leaseUntil: new Date(renewedAt.getTime() + leaseMs),
          });
          if (!extended) {
            lost = true;
            controller.abort();
          }
        } catch (cause) {
          // Without proof of ownership the commands must stop: continuing could
          // run them a second time beside the new owner.
          logger.warn('[workflows] run lease renewal failed', {
            runId: run.id,
            error: failureMessage(cause),
          });
          lost = true;
          controller.abort();
        } finally {
          renewing = false;
        }
      };

      await renew();
      if (lost) {
        return 'lost';
      }
      const heartbeat = setInterval(() => void renew(), Math.max(250, Math.floor(leaseMs / 3)));
      heartbeat.unref?.();
      try {
        const verdict = await deps.verifyRun({ run, steps, signal: controller.signal });
        return lost ? 'lost' : verdict;
      } catch (cause) {
        logger.error('[workflows] build verification failed', {
          runId: run.id,
          error: failureMessage(cause),
        });
        return lost ? 'lost' : unresolved();
      } finally {
        clearInterval(heartbeat);
      }
    };

    // 4. Every step settled: a failed step fails the run unless a step guarded
    //    explicitly by that failure completed and handled it.
    const unhandledFailure = steps.some(
      (step) =>
        step.status === 'failed' &&
        !steps.some(
          (candidate) =>
            candidate.status === 'completed' &&
            conditionsOf(candidate).some(
              (condition) =>
                condition.stepId === step.id && conditionStatus(condition) === 'failed',
            ),
        ),
    );
    const build = run.settings?.build;
    let verification: WorkflowRunVerification | undefined;
    if (!unhandledFailure && build != null) {
      const outcome = await verifySettlement(build);
      if (outcome === 'lost') {
        return 'lost';
      }
      verification = outcome;
    }
    const unverified = verification != null && verification.status !== 'verified';
    status = unhandledFailure || unverified ? 'failed' : 'completed';
    if (unhandledFailure) {
      error = error ?? STEP_ERROR;
    } else {
      error = unverified ? BUILD_UNVERIFIED_ERROR : null;
    }
    note(
      unhandledFailure || unverified ? 'run.failed' : 'run.completed',
      unverified ? { message: BUILD_UNVERIFIED_ERROR } : {},
    );
    startedAt = startedAt ?? at;
    const chainPending = status === 'completed' && run.onCompleteWorkflowId != null;
    const saved = await saveRun({
      settledAt: at,
      ...(verification == null ? {} : { verification }),
      ...(chainPending ? { chainPending: true } : {}),
    });
    if (saved === 'saved') {
      const delivered = await settleRun({ ...run, status, steps, events, startedAt }, status);
      if (delivered && chainPending) {
        return (await save(run, leaseToken, { chainPending: false })) ? 'saved' : 'lost';
      }
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
    const tick = runAsSystem(async () => {
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
    });

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
