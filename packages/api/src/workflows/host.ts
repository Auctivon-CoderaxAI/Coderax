import { randomUUID } from 'node:crypto';
import { logger } from '@coderax/data-schemas';
import type { WorkflowMethods } from '@coderax/data-schemas';
import type {
  WorkflowEngine,
  WorkflowEngineOptions,
  WorkflowGenerationState,
  WorkflowRunRecord,
} from './types';

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

/** Reads the settled assistant text a workflow step contributed as its result. */
export function createWorkflowStepResultReader(
  methods: Pick<WorkflowHostDatabase, 'getMessages'>,
): (input: { run: WorkflowRunRecord; conversationId: string }) => Promise<string | null> {
  return async ({ run, conversationId }) => {
    const messages = await methods.getMessages(
      { conversationId, user: run.userId },
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
    await deps.methods.createWorkflowRun({
      userId: run.userId,
      ...(run.tenantId == null ? {} : { tenantId: run.tenantId }),
      workflowId: next.id,
      workflowName: next.name,
      agentId: next.agentId,
      steps: next.steps,
      conversationId: randomUUID(),
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

/** Durable admission check for a workflow step delivery. */
export function isWorkflowStepActive(
  run: WorkflowRunRecord | null | undefined,
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
