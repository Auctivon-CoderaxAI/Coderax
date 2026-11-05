import { randomUUID } from 'node:crypto';
import { logger } from '@coderax/data-schemas';
import type { WorkflowMethods } from '@coderax/data-schemas';
import type {
  WorkflowEngine,
  WorkflowEngineOptions,
  WorkflowGenerationState,
  WorkflowRunRecord,
} from './types';
import type { TerminalHostActionHandler } from '../stream/GenerationJobManager';

interface WorkflowMessage {
  isCreatedByUser?: boolean;
  text?: string;
}

interface WorkflowHostDatabase {
  getMessages: (
    query: { conversationId: string; user: string },
    projection?: string,
  ) => Promise<WorkflowMessage[]>;
  getWorkflow: WorkflowMethods['getWorkflow'];
  createWorkflowRun: WorkflowMethods['createWorkflowRun'];
  getWorkflowRun: WorkflowMethods['getWorkflowRun'];
}

export interface WorkflowGenerationHost {
  getJob: (conversationId: string) => Promise<WorkflowGenerationState | null>;
  abortJob: (
    conversationId: string,
    options?: { expectedCreatedAt?: number },
  ) => Promise<{ success?: boolean } | null | undefined>;
}

/** Reads the latest settled assistant text in one conversation. */
export function createWorkflowConversationResultReader(
  methods: Pick<WorkflowHostDatabase, 'getMessages'>,
): (input: { userId: string; conversationId: string }) => Promise<string | null> {
  return async ({ userId, conversationId }) => {
    const messages = await methods.getMessages(
      { conversationId, user: userId },
      'text isCreatedByUser',
    );
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.isCreatedByUser === false && typeof message.text === 'string') {
        const text = message.text.trim();
        if (text.length > 0) {
          return text;
        }
      }
    }
    return null;
  };
}

/** Reads the settled assistant text a workflow step contributed as its result. */
export function createWorkflowStepResultReader(
  methods: Pick<WorkflowHostDatabase, 'getMessages'>,
): (input: { run: WorkflowRunRecord; conversationId: string }) => Promise<string | null> {
  const read = createWorkflowConversationResultReader(methods);
  return async ({ run, conversationId }) => read({ userId: run.userId, conversationId });
}

/**
 * Consumes a generation's terminal host-action marker and stores an
 * attempt-fenced outcome before cleanup may delete the live job.
 */
export function createWorkflowTerminalOutcomeHandler(deps: {
  record: WorkflowMethods['recordWorkflowStepOutcome'];
  readResult: (input: { userId: string; conversationId: string }) => Promise<string | null>;
  /** Advances the runner as soon as the durable outcome exists, instead of
   *  waiting for the next recovery tick. */
  wake?: () => void;
  now?: () => Date;
}): TerminalHostActionHandler {
  const now = deps.now ?? (() => new Date());
  return async (_streamId, job) => {
    const runId = job.workflowRunId;
    const stepId = job.workflowStepId;
    const attempt = job.workflowStepAttempt;
    if (
      typeof runId !== 'string' ||
      typeof stepId !== 'string' ||
      !Number.isSafeInteger(attempt) ||
      (attempt as number) < 1
    ) {
      return;
    }
    let status: 'complete' | 'error' | null = null;
    if (job.status === 'complete') {
      status = 'complete';
    } else if (job.status === 'error' || job.status === 'aborted') {
      status = 'error';
    } else {
      return;
    }
    let result: string | null = null;
    if (status === 'complete' && job.conversationId != null) {
      try {
        result = await deps.readResult({
          userId: job.userId,
          conversationId: job.conversationId,
        });
      } catch (cause) {
        logger.warn('[workflows] terminal result read failed', {
          runId,
          stepId,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    await deps.record({
      runId,
      stepId,
      attempt: attempt as number,
      status,
      result,
      now: now(),
    });
    deps.wake?.();
  };
}

/**
 * Delivers the one-way chain from a completed run to its configured successor.
 * The parent run id is the dedupe key, so a crash after the child is created but
 * before the engine clears its pending marker cannot create a second child.
 */
export function createWorkflowSettlementHandler(deps: {
  methods: Pick<WorkflowHostDatabase, 'getWorkflow' | 'createWorkflowRun'>;
  wake: () => void;
}): (run: WorkflowRunRecord) => Promise<void> {
  return async (run) => {
    if (run.status !== 'completed' || run.onCompleteWorkflowId == null) {
      return;
    }
    const next = await deps.methods.getWorkflow(run.onCompleteWorkflowId, run.userId);
    if (next == null) {
      return;
    }
    const ancestry = run.workflowAncestry ?? [run.workflowId];
    if (ancestry.includes(next.id)) {
      return;
    }
    await deps.methods.createWorkflowRun({
      userId: run.userId,
      ...(run.tenantId == null ? {} : { tenantId: run.tenantId }),
      workflowId: next.id,
      workflowName: next.name,
      agentId: next.agentId,
      steps: next.steps,
      conversationId: randomUUID(),
      workflowAncestry: [...ancestry, next.id],
      ...(next.settings == null ? {} : { settings: next.settings }),
      ...(next.onCompleteWorkflowId == null
        ? {}
        : { onCompleteWorkflowId: next.onCompleteWorkflowId }),
      trigger: {
        type: 'event',
        sourceId: run.workflowId,
        label: run.workflowName,
      },
      dedupeKey: `workflow-chain:${run.id}`,
    });
    deps.wake();
  };
}

/**
 * Aborts the turn currently producing in a conversation. Identity-fenced when
 * the caller knows which generation it authorized, so a replacement turn that
 * reused the conversation is never stopped by a stale cancellation.
 */
export function createWorkflowTurnAborter(
  host: WorkflowGenerationHost,
): (conversationId: string, expectedCreatedAt?: number) => Promise<boolean> {
  return async (conversationId, expectedCreatedAt) => {
    const job = await host.getJob(conversationId);
    if (job == null) {
      return false;
    }
    if (job.status !== 'running' && job.status !== 'requires_action') {
      return false;
    }
    if (expectedCreatedAt != null && job.createdAt !== expectedCreatedAt) {
      return false;
    }
    const result = await host.abortJob(conversationId, {
      expectedCreatedAt: job.createdAt,
    });
    return result?.success === true;
  };
}

interface WorkflowStepDelivery {
  runId: string;
  stepId: string;
  attempt: number;
  workflowId: string;
}

export interface WorkflowStepRunState {
  workflowId: string;
  tenantId?: string;
  status: WorkflowRunRecord['status'];
  steps: Array<Pick<WorkflowRunRecord['steps'][number], 'id' | 'status' | 'attempts'>>;
}

export type WorkflowStepRunLookup = (
  id: string,
  userId: string,
) => Promise<WorkflowStepRunState | null>;

/** Parses the trusted fire envelope the trigger host sends to the chat route. */
export function parseWorkflowStepDelivery(trigger: unknown): WorkflowStepDelivery | null {
  if (trigger == null || typeof trigger !== 'object' || Array.isArray(trigger)) {
    return null;
  }
  const record = trigger as Record<string, unknown>;
  const event = record.event;
  if (event == null || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }
  const eventRecord = event as Record<string, unknown>;
  if (eventRecord.type !== 'workflow.step') {
    return null;
  }
  const source = eventRecord.source;
  if (source == null || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }
  const sourceRecord = source as Record<string, unknown>;
  if (sourceRecord.type !== 'workflow' || typeof sourceRecord.id !== 'string') {
    return null;
  }
  const metadata = record.metadata;
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const fields = metadata as Record<string, unknown>;
  const runId = fields.workflowRunId;
  const stepId = fields.workflowStepId;
  const deliveryId = record.deliveryId;
  if (typeof runId !== 'string' || typeof stepId !== 'string' || typeof deliveryId !== 'string') {
    return null;
  }
  const prefix = `wf:${runId}:${stepId}:`;
  if (!deliveryId.startsWith(prefix)) {
    return null;
  }
  const attemptText = deliveryId.slice(prefix.length);
  if (!/^[1-9]\d*$/.test(attemptText)) {
    return null;
  }
  const attempt = Number(attemptText);
  if (!Number.isSafeInteger(attempt)) {
    return null;
  }
  return { runId, stepId, attempt, workflowId: sourceRecord.id };
}

export class WorkflowStepInactiveError extends Error {
  readonly code = 'WORKFLOW_STEP_INACTIVE';
  readonly status = 409;

  constructor() {
    super('Workflow step is no longer active');
    this.name = 'WorkflowStepInactiveError';
  }
}

/**
 * Admission read taken after the generation job exists. Cancellation that wins
 * before this read rejects the turn; cancellation that wins after it observes
 * the committed job and can abort it. Callers must abort the job on rejection.
 */
export async function assertWorkflowStepDeliveryActive(deps: {
  getWorkflowRun: WorkflowStepRunLookup;
  trigger: unknown;
  userId: string;
  tenantId?: string;
  armTerminalOutcome?: () => Promise<void>;
}): Promise<void> {
  const delivery = parseWorkflowStepDelivery(deps.trigger);
  if (delivery == null) {
    return;
  }
  const run = await deps.getWorkflowRun(delivery.runId, deps.userId);
  if (
    !isWorkflowStepActive(run, {
      ...delivery,
      userId: deps.userId,
      ...(deps.tenantId == null ? {} : { tenantId: deps.tenantId }),
    })
  ) {
    throw new WorkflowStepInactiveError();
  }
  await deps.armTerminalOutcome?.();
}

/** Copies the workflow receipt identity into the generation job metadata. */
export function workflowStepGenerationMetadata(trigger: unknown): {
  workflowRunId?: string;
  workflowStepId?: string;
  workflowStepAttempt?: number;
} {
  const delivery = parseWorkflowStepDelivery(trigger);
  if (delivery == null) {
    return {};
  }
  return {
    workflowRunId: delivery.runId,
    workflowStepId: delivery.stepId,
    workflowStepAttempt: delivery.attempt,
  };
}

/** Durable admission check for a workflow step delivery. */
export function isWorkflowStepActive(
  run: WorkflowStepRunState | null | undefined,
  input: {
    runId: string;
    stepId: string;
    attempt: number;
    workflowId: string;
    userId: string;
    tenantId?: string;
  },
): boolean {
  if (
    run == null ||
    run.workflowId !== input.workflowId ||
    (run.tenantId == null ? '' : String(run.tenantId)) !== (input.tenantId ?? '') ||
    (run.status !== 'running' && run.status !== 'queued')
  ) {
    return false;
  }
  return run.steps.some(
    (step) =>
      step.id === input.stepId && step.status === 'running' && step.attempts === input.attempt,
  );
}

export interface WorkflowLifecycle {
  getEngine: () => WorkflowEngine;
  /** Arms the runner; the first caller supplies the deployment configuration. */
  initialize: (options?: WorkflowEngineOptions) => boolean;
  wake: () => void;
}

/**
 * Owns the lazy engine lifecycle so the legacy service only supplies adapters.
 * Configuration is captured on first construction; startup arms it explicitly.
 */
export function createWorkflowLifecycle(
  createEngine: (options?: WorkflowEngineOptions) => WorkflowEngine,
): WorkflowLifecycle {
  let engine: WorkflowEngine | undefined;
  let options: WorkflowEngineOptions | undefined;

  const getEngine = (): WorkflowEngine => {
    if (engine == null) {
      engine = createEngine(options);
    }
    return engine;
  };

  const initialize = (next?: WorkflowEngineOptions): boolean => {
    if (next != null) {
      options = next;
    }
    try {
      getEngine().start();
      return true;
    } catch (error) {
      logger.error('[workflows] engine initialization failed', error);
      return false;
    }
  };

  const wake = (): void => {
    try {
      const runner = getEngine();
      runner.start();
      runner.wake();
    } catch (error) {
      logger.error('[workflows] engine wake failed', error);
    }
  };

  return { getEngine, initialize, wake };
}
