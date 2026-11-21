import { randomUUID } from 'node:crypto';
import type { WorkflowRunEvent } from 'coderax-data-provider';
import type { WorkflowMethods } from '@coderax/data-schemas';
import type {
  WorkflowEngineStore,
  WorkflowRunRecord,
  WorkflowScheduleClaim,
  WorkflowScheduleDeps,
  WorkflowStepRecord,
} from './types';
import { createAgentTriggerEnvelope } from '../agents/triggers/envelope';

interface StoredRun {
  id: string;
  user: unknown;
  tenantId?: string;
  workflowId: string;
  workflowName: string;
  agentId: string;
  status: WorkflowRunRecord['status'];
  currentStep: number;
  steps: WorkflowStepRecord[];
  settings?: WorkflowRunRecord['settings'];
  conversationId?: string;
  input?: string;
  trigger?: WorkflowRunRecord['trigger'];
  events?: Array<Omit<WorkflowRunEvent, 'at'> & { at: Date | string }>;
  workflowAncestry?: string[];
  onCompleteWorkflowId?: string;
  verification?: WorkflowRunRecord['verification'];
  error?: string;
  pauseRequestedAt?: Date;
  startedAt?: Date;
  settledAt?: Date;
}

function toRunRecord(run: StoredRun): WorkflowRunRecord {
  return {
    id: run.id,
    userId: String(run.user),
    ...(run.tenantId == null ? {} : { tenantId: run.tenantId }),
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    agentId: run.agentId,
    status: run.status,
    currentStep: run.currentStep,
    steps: run.steps.map((step) => ({ ...step })),
    ...(run.settings == null ? {} : { settings: run.settings }),
    ...(run.conversationId == null ? {} : { conversationId: run.conversationId }),
    ...(run.input == null ? {} : { input: run.input }),
    ...(run.trigger == null ? {} : { trigger: run.trigger }),
    events: (run.events ?? []).map((entry) => ({
      ...entry,
      at: (entry.at instanceof Date ? entry.at : new Date(entry.at)).toISOString(),
    })),
    ...(run.workflowAncestry == null ? {} : { workflowAncestry: run.workflowAncestry }),
    ...(run.onCompleteWorkflowId == null ? {} : { onCompleteWorkflowId: run.onCompleteWorkflowId }),
    ...(run.verification == null ? {} : { verification: run.verification }),
    ...(run.error == null ? {} : { error: run.error }),
    ...(run.pauseRequestedAt == null ? {} : { pauseRequestedAt: run.pauseRequestedAt }),
    ...(run.startedAt == null ? {} : { startedAt: run.startedAt }),
    ...(run.settledAt == null ? {} : { settledAt: run.settledAt }),
  };
}

/** Adapts the data-schemas run methods to the runner's small store port. */
export function createWorkflowStore(
  methods: Pick<
    WorkflowMethods,
    'claimWorkflowRuns' | 'updateWorkflowRun' | 'extendWorkflowRunLease' | 'releaseWorkflowRun'
  >,
): WorkflowEngineStore {
  return {
    claimRuns: async (input) => {
      const runs = await methods.claimWorkflowRuns(input);
      return runs.map((run) => toRunRecord(run));
    },
    saveRun: async ({ runId, leaseToken, now, patch }) => {
      const { events, steps, ...rest } = patch;
      const saved = await methods.updateWorkflowRun({
        id: runId,
        leaseToken,
        now,
        patch: {
          ...rest,
          ...(steps == null
            ? {}
            : {
                steps: steps.map((step) => ({
                  ...step,
                  dependsOn: step.dependsOn ?? [],
                })),
              }),
          ...(events == null
            ? {}
            : {
                events: events.map((entry) => ({
                  ...entry,
                  at: new Date(entry.at),
                })),
              }),
        },
      });
      return saved != null;
    },
    extendLease: async ({ runId, leaseToken, now, leaseUntil }) =>
      methods.extendWorkflowRunLease({ id: runId, leaseToken, leaseUntil, now }),
    releaseRun: async ({ runId, leaseToken, now }) => {
      await methods.releaseWorkflowRun(runId, leaseToken, now);
    },
  };
}

const WORKFLOW_EVENT_TYPE = 'workflow.step';

export interface WorkflowStepEnqueuerDeps {
  enqueueTrigger: (
    envelope: unknown,
    options?: { orderingKey?: string },
  ) => Promise<{ deliveryKey?: string } | unknown>;
}

/**
 * Dispatches one step as a fire delivery. The delivery id is deterministic for
 * the run, step and attempt, so a crash between enqueue and the run write makes
 * the retry deduplicate instead of starting the same turn twice. A step carries
 * its own conversation when it is a parallel branch.
 */
export function createWorkflowStepEnqueuer(deps: WorkflowStepEnqueuerDeps) {
  return async (input: {
    run: WorkflowRunRecord;
    step: WorkflowStepRecord;
    stepIndex: number;
  }): Promise<string> => {
    const { run, step } = input;
    const attempt = step.attempts;
    const deliveryId = `wf:${run.id}:${step.id}:${attempt}`;
    const conversationId = step.conversationId ?? run.conversationId;
    const envelope = createAgentTriggerEnvelope({
      mode: 'fire',
      requestId: randomUUID(),
      deliveryId,
      receivedAt: Date.now(),
      principal: {
        id: run.userId,
        ...(run.tenantId == null ? {} : { tenantId: run.tenantId }),
      },
      target: { agentId: step.agentId ?? run.agentId },
      event: {
        id: deliveryId,
        type: WORKFLOW_EVENT_TYPE,
        occurredAt: Date.now(),
        source: { id: run.workflowId, type: 'workflow' },
      },
      input: step.instruction,
      run: {
        ...(conversationId == null ? {} : { conversationId }),
        metadata: {
          workflowRunId: run.id,
          workflowStepId: step.id,
          workflowStepIndex: input.stepIndex,
          workflowStepAttempt: attempt,
        },
      },
    });
    const queued = await deps.enqueueTrigger(envelope, {
      orderingKey: `workflow-run:${run.id}`,
    });
    if (queued != null && typeof queued === 'object' && 'deliveryKey' in queued) {
      const deliveryKey = (queued as { deliveryKey?: unknown }).deliveryKey;
      if (typeof deliveryKey === 'string' && deliveryKey.length > 0) {
        return deliveryKey;
      }
    }
    return deliveryId;
  };
}

/** Adapts the schedule methods and cadence helper to the runner's schedule port. */
export function createWorkflowSchedules(deps: {
  claimDue: WorkflowMethods['claimDueWorkflowSchedules'];
  complete: WorkflowMethods['completeWorkflowScheduleClaim'];
  release: WorkflowMethods['releaseWorkflowScheduleClaim'];
  nextRunAt: WorkflowScheduleDeps['computeNextRunAt'];
}): WorkflowScheduleDeps {
  return {
    claimDue: async (input) => {
      const rows = await deps.claimDue(input);
      const claims: WorkflowScheduleClaim[] = [];
      for (const row of rows) {
        const schedule = row.schedule;
        if (schedule?.nextRunAt == null || schedule.claimToken == null) {
          continue;
        }
        claims.push({
          workflowId: row.id,
          claimToken: schedule.claimToken,
          scheduledFor: new Date(schedule.nextRunAt),
          cadence: schedule.cadence,
          timezone: schedule.timezone,
        });
      }
      return claims;
    },
    complete: deps.complete,
    release: deps.release,
    computeNextRunAt: deps.nextRunAt,
  };
}
