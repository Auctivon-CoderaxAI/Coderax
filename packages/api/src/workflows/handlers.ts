import { randomUUID } from 'node:crypto';
import { logger } from '@coderax/data-schemas';
import type { Response } from 'express';
import type { WorkflowMethods } from '@coderax/data-schemas';
import { WORKFLOW_TEMPLATES } from 'coderax-data-provider';
import type {
  WorkflowArtifact,
  WorkflowRunStatus,
  WorkflowRunView,
  WorkflowStepInput,
  WorkflowStepView,
  WorkflowView,
} from 'coderax-data-provider';
import type { ServerRequest } from '~/types';
import {
  parseApproveWorkflowStep,
  parseCreateWorkflow,
  parseStartWorkflowRun,
  parseUpdateWorkflow,
} from './definition';
import type { WorkflowSchedulePayload } from './definition';
import { computeNextRunAt, isValidTimezone } from '../schedules/cadence';
import type { WorkflowScheduleWrite } from '@coderax/data-schemas';

interface WorkflowRecord {
  id: string;
  name: string;
  description?: string;
  agentId: string;
  steps: WorkflowStepInput[];
  settings?: WorkflowView['settings'];
  schedule?: {
    enabled: boolean;
    cadence: NonNullable<WorkflowView['schedule']>['cadence'];
    timezone: string;
    input?: string;
    nextRunAt?: Date | string;
  };
  onCompleteWorkflowId?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

interface WorkflowStepRunRecord {
  id: string;
  title: string;
  instruction: string;
  approvalRequired: boolean;
  maxAttempts: number;
  agentId?: string;
  dependsOn?: string[];
  runIf?: WorkflowStepView['runIf'];
  timeoutMs?: number;
  status: WorkflowStepView['status'];
  attempts: number;
  approvedAt?: Date | string;
  startedAt?: Date | string;
  settledAt?: Date | string;
  error?: string;
  reason?: string;
  result?: string;
}

interface WorkflowRunRecordView {
  id: string;
  workflowId: string;
  workflowName: string;
  agentId: string;
  status: WorkflowRunStatus;
  conversationId?: string;
  input?: string;
  steps: WorkflowStepRunRecord[];
  error?: string;
  trigger?: WorkflowRunView['trigger'];
  events?: Array<{
    at: Date | string;
    type: WorkflowRunView['events'][number]['type'];
    stepId?: string;
    message?: string;
  }>;
  pauseRequestedAt?: Date | string;
  createdAt?: Date | string;
  startedAt?: Date | string;
  settledAt?: Date | string;
}

export interface WorkflowsHandlerDeps {
  methods: WorkflowMethods;
  canRunAgent: (agentId: string, req: ServerRequest) => Promise<boolean>;
  /** Nudges the runner after a durable write that made progress possible. */
  wake: () => void;
  /** Aborts the turn currently running in a conversation, if any. */
  abortActiveRun?: (conversationId: string) => Promise<void>;
  /** Retires a queued trigger before it can begin a cancelled workflow step. */
  retireQueuedDelivery?: (deliveryKey: string, workflowId: string) => Promise<boolean>;
  createRunId?: () => string;
  now?: () => Date;
  streamPollMs?: number;
}

const TERMINAL_STATUSES: WorkflowRunStatus[] = ['completed', 'failed', 'cancelled'];

function iso(value: Date | string | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function dependencyView(
  steps: Array<{ id: string }>,
  index: number,
  dependsOn: string[] | undefined,
): { dependsOn?: string[] } {
  if (dependsOn != null) {
    return { dependsOn };
  }
  return index === 0 ? {} : { dependsOn: [steps[index - 1].id] };
}

function scheduleView(schedule: WorkflowRecord['schedule']): WorkflowView['schedule'] {
  if (schedule == null) {
    return undefined;
  }
  return {
    enabled: schedule.enabled,
    cadence: schedule.cadence,
    timezone: schedule.timezone,
    ...(schedule.input == null ? {} : { input: schedule.input }),
    ...(schedule.nextRunAt == null ? {} : { nextRunAt: iso(schedule.nextRunAt) }),
  };
}

export function toWorkflowView(workflow: WorkflowRecord): WorkflowView {
  const schedule = scheduleView(workflow.schedule);
  return {
    id: workflow.id,
    name: workflow.name,
    ...(workflow.description == null ? {} : { description: workflow.description }),
    agentId: workflow.agentId,
    steps: workflow.steps.map((step, index) => ({
      id: step.id,
      title: step.title,
      instruction: step.instruction,
      ...(step.approvalRequired === true ? { approvalRequired: true } : {}),
      maxAttempts: step.maxAttempts ?? 3,
      ...(step.agentId == null ? {} : { agentId: step.agentId }),
      ...dependencyView(workflow.steps, index, step.dependsOn),
      ...(step.runIf == null ? {} : { runIf: step.runIf }),
      ...(step.timeoutMs == null ? {} : { timeoutMs: step.timeoutMs }),
    })),
    ...(workflow.settings == null ? {} : { settings: workflow.settings }),
    ...(schedule == null ? {} : { schedule }),
    ...(workflow.onCompleteWorkflowId == null
      ? {}
      : { onCompleteWorkflowId: workflow.onCompleteWorkflowId }),
    createdAt: iso(workflow.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(workflow.updatedAt) ?? new Date(0).toISOString(),
  };
}

export function toRunView(run: WorkflowRunRecordView): WorkflowRunView {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    agentId: run.agentId,
    status: run.status,
    steps: run.steps.map((step, index) => ({
      id: step.id,
      title: step.title,
      instruction: step.instruction,
      approvalRequired: step.approvalRequired,
      maxAttempts: step.maxAttempts,
      ...(step.agentId == null ? {} : { agentId: step.agentId }),
      ...dependencyView(run.steps, index, step.dependsOn),
      ...(step.runIf == null ? {} : { runIf: step.runIf }),
      ...(step.timeoutMs == null ? {} : { timeoutMs: step.timeoutMs }),
      status: step.status,
      attempts: step.attempts,
      ...(step.approvedAt == null ? {} : { approvedAt: iso(step.approvedAt) }),
      ...(step.startedAt == null ? {} : { startedAt: iso(step.startedAt) }),
      ...(step.settledAt == null ? {} : { settledAt: iso(step.settledAt) }),
      ...(step.error == null ? {} : { error: step.error }),
      ...(step.reason == null ? {} : { reason: step.reason }),
      ...(step.result == null ? {} : { result: step.result }),
    })),
    ...(run.conversationId == null ? {} : { conversationId: run.conversationId }),
    ...(run.input == null ? {} : { input: run.input }),
    ...(run.error == null ? {} : { error: run.error }),
    ...(run.trigger == null ? {} : { trigger: run.trigger }),
    events: (run.events ?? []).map((entry) => ({
      at: iso(entry.at) ?? new Date(0).toISOString(),
      type: entry.type,
      ...(entry.stepId == null ? {} : { stepId: entry.stepId }),
      ...(entry.message == null ? {} : { message: entry.message }),
    })),
    ...(run.pauseRequestedAt == null ? {} : { pauseRequestedAt: iso(run.pauseRequestedAt) }),
    createdAt: iso(run.createdAt) ?? new Date(0).toISOString(),
    ...(run.startedAt == null ? {} : { startedAt: iso(run.startedAt) }),
    ...(run.settledAt == null ? {} : { settledAt: iso(run.settledAt) }),
  };
}

function userId(req: ServerRequest): string | undefined {
  return req.user?.id;
}

function unavailable(res: Response): void {
  res.status(503).json({ error: 'Workflows are temporarily unavailable' });
}

function scheduleWrite(
  schedule: WorkflowSchedulePayload | null | undefined,
  now: Date,
): WorkflowScheduleWrite | null | undefined {
  if (schedule === undefined) {
    return undefined;
  }
  if (schedule === null) {
    return null;
  }
  const base = {
    enabled: schedule.enabled,
    cadence: schedule.cadence,
    timezone: schedule.timezone,
    ...(schedule.input == null || schedule.input.length === 0 ? {} : { input: schedule.input }),
  };
  if (!schedule.enabled) {
    return base;
  }
  const nextRunAt = computeNextRunAt({
    cadence: schedule.cadence,
    timezone: schedule.timezone,
    scheduleId: 'workflow',
    after: now,
    disableJitter: true,
  });
  return nextRunAt == null ? null : { ...base, nextRunAt };
}

function scheduleFailure(schedule: WorkflowSchedulePayload | null | undefined): string | undefined {
  if (schedule == null) {
    return undefined;
  }
  if (!isValidTimezone(schedule.timezone)) {
    return 'Choose a valid timezone';
  }
  if (schedule.enabled) {
    const next = computeNextRunAt({
      cadence: schedule.cadence,
      timezone: schedule.timezone,
      scheduleId: 'workflow',
      disableJitter: true,
    });
    if (next == null) {
      return 'That schedule has no future occurrence';
    }
  }
  return undefined;
}

export function createWorkflowHandlers(deps: WorkflowsHandlerDeps) {
  const createRunId = deps.createRunId ?? randomUUID;
  const now = deps.now ?? (() => new Date());
  const streamPollMs = deps.streamPollMs ?? 2_000;

  const agentsToAuthorize = (workflow: { agentId: string; steps: WorkflowStepInput[] }): string[] =>
    Array.from(
      new Set([
        workflow.agentId,
        ...workflow.steps
          .map((step) => step.agentId)
          .filter((value): value is string => value != null),
      ]),
    );

  const chainIsValid = async (
    owner: string,
    workflowId: string | null,
    targetId: string | null | undefined,
  ): Promise<boolean> => {
    if (targetId == null) {
      return true;
    }
    if (workflowId != null && targetId === workflowId) {
      return false;
    }
    let cursor: string | null | undefined = targetId;
    const seen = new Set<string>();
    for (let hop = 0; hop < 20 && cursor != null; hop += 1) {
      if (seen.has(cursor) || (workflowId != null && cursor === workflowId)) {
        return false;
      }
      seen.add(cursor);
      const next = await deps.methods.getWorkflow(cursor, owner);
      if (next == null) {
        return false;
      }
      cursor = next.onCompleteWorkflowId;
    }
    return cursor == null;
  };

  const stopActiveTurns = async (run: {
    conversationId?: string;
    steps: Array<{ conversationId?: string; status: string }>;
  }): Promise<void> => {
    if (deps.abortActiveRun == null) {
      return;
    }
    const conversations = new Set<string>();
    for (const step of run.steps) {
      if (step.status === 'running' || step.status === 'cancelled') {
        const conversationId = step.conversationId ?? run.conversationId;
        if (conversationId != null) {
          conversations.add(conversationId);
        }
      }
    }
    if (conversations.size === 0 && run.conversationId != null) {
      conversations.add(run.conversationId);
    }
    await Promise.allSettled(
      Array.from(conversations).map(async (conversationId) => {
        try {
          await deps.abortActiveRun?.(conversationId);
        } catch (cause) {
          logger.warn('[workflows] active turn abort failed', {
            conversationId,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }),
    );
  };

  return {
    listWorkflows: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      try {
        const workflows = await deps.methods.listWorkflows(owner);
        res.status(200).json({ workflows: workflows.map(toWorkflowView) });
      } catch (error) {
        logger.error('[workflows] failed to list workflows', error);
        unavailable(res);
      }
    },

    listTemplates: async (_req: ServerRequest, res: Response): Promise<void> => {
      res.status(200).json({ templates: WORKFLOW_TEMPLATES });
    },

    createWorkflow: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const parsed = parseCreateWorkflow(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const invalidSchedule = scheduleFailure(parsed.value.schedule);
      if (invalidSchedule != null) {
        res.status(400).json({ error: invalidSchedule });
        return;
      }
      try {
        for (const agentId of agentsToAuthorize(parsed.value)) {
          if (!(await deps.canRunAgent(agentId, req))) {
            res.status(403).json({ error: 'You cannot run that agent' });
            return;
          }
        }
        if (!(await chainIsValid(owner, null, parsed.value.onCompleteWorkflowId ?? undefined))) {
          res.status(400).json({ error: 'That completion target is not available' });
          return;
        }
        const schedule = scheduleWrite(parsed.value.schedule, now());
        const workflow = await deps.methods.createWorkflow({
          userId: owner,
          ...(req.user?.tenantId == null ? {} : { tenantId: req.user.tenantId }),
          name: parsed.value.name,
          ...(parsed.value.description == null ? {} : { description: parsed.value.description }),
          agentId: parsed.value.agentId,
          steps: parsed.value.steps,
          ...(parsed.value.settings == null ? {} : { settings: parsed.value.settings }),
          ...(schedule == null ? {} : { schedule }),
          ...(parsed.value.onCompleteWorkflowId == null
            ? {}
            : { onCompleteWorkflowId: parsed.value.onCompleteWorkflowId }),
        });
        res.status(201).json(toWorkflowView(workflow));
      } catch (error) {
        logger.error('[workflows] failed to create workflow', error);
        unavailable(res);
      }
    },

    getWorkflow: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { id } = req.params as { id?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (id == null) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      try {
        const workflow = await deps.methods.getWorkflow(id, owner);
        if (workflow == null) {
          res.status(404).json({ error: 'Workflow not found' });
          return;
        }
        res.status(200).json(toWorkflowView(workflow));
      } catch (error) {
        logger.error('[workflows] failed to read workflow', error);
        unavailable(res);
      }
    },

    updateWorkflow: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { id } = req.params as { id?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (id == null) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      const parsed = parseUpdateWorkflow(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const invalidSchedule = scheduleFailure(parsed.value.schedule);
      if (invalidSchedule != null) {
        res.status(400).json({ error: invalidSchedule });
        return;
      }
      try {
        if (parsed.value.steps != null) {
          for (const agentId of [
            ...(parsed.value.agentId == null ? [] : [parsed.value.agentId]),
            ...parsed.value.steps
              .map((step) => step.agentId)
              .filter((value): value is string => value != null),
          ]) {
            if (!(await deps.canRunAgent(agentId, req))) {
              res.status(403).json({ error: 'You cannot run that agent' });
              return;
            }
          }
        } else if (
          parsed.value.agentId != null &&
          !(await deps.canRunAgent(parsed.value.agentId, req))
        ) {
          res.status(403).json({ error: 'You cannot run that agent' });
          return;
        }
        if (
          parsed.value.onCompleteWorkflowId !== undefined &&
          !(await chainIsValid(owner, id, parsed.value.onCompleteWorkflowId))
        ) {
          res.status(400).json({ error: 'That completion target is not available' });
          return;
        }
        const workflow = await deps.methods.updateWorkflow(id, owner, {
          ...(parsed.value.name == null ? {} : { name: parsed.value.name }),
          ...(parsed.value.description === undefined
            ? {}
            : { description: parsed.value.description }),
          ...(parsed.value.agentId == null ? {} : { agentId: parsed.value.agentId }),
          ...(parsed.value.steps == null ? {} : { steps: parsed.value.steps }),
          ...(parsed.value.settings === undefined ? {} : { settings: parsed.value.settings }),
          ...(parsed.value.schedule === undefined
            ? {}
            : { schedule: scheduleWrite(parsed.value.schedule, now()) ?? null }),
          ...(parsed.value.onCompleteWorkflowId === undefined
            ? {}
            : { onCompleteWorkflowId: parsed.value.onCompleteWorkflowId }),
        });
        if (workflow == null) {
          res.status(404).json({ error: 'Workflow not found' });
          return;
        }
        res.status(200).json(toWorkflowView(workflow));
      } catch (error) {
        logger.error('[workflows] failed to update workflow', error);
        unavailable(res);
      }
    },

    deleteWorkflow: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { id } = req.params as { id?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (id == null) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      try {
        const deleted = await deps.methods.deleteWorkflow(id, owner);
        if (!deleted) {
          res.status(404).json({ error: 'Workflow not found' });
          return;
        }
        res.status(200).json({ id });
      } catch (error) {
        logger.error('[workflows] failed to delete workflow', error);
        unavailable(res);
      }
    },

    listRuns: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { id } = req.params as { id?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      try {
        const runs = await deps.methods.listWorkflowRuns(owner, id);
        res.status(200).json({ runs: runs.map(toRunView) });
      } catch (error) {
        logger.error('[workflows] failed to list runs', error);
        unavailable(res);
      }
    },

    startRun: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { id } = req.params as { id?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (id == null) {
        res.status(404).json({ error: 'Workflow not found' });
        return;
      }
      const parsed = parseStartWorkflowRun(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      try {
        const workflow = await deps.methods.getWorkflow(id, owner);
        if (workflow == null) {
          res.status(404).json({ error: 'Workflow not found' });
          return;
        }
        for (const agentId of agentsToAuthorize(workflow)) {
          if (!(await deps.canRunAgent(agentId, req))) {
            res.status(403).json({ error: 'You cannot run that agent' });
            return;
          }
        }
        const run = await deps.methods.createWorkflowRun({
          userId: owner,
          ...(req.user?.tenantId == null ? {} : { tenantId: req.user.tenantId }),
          workflowId: workflow.id,
          workflowName: workflow.name,
          agentId: workflow.agentId,
          steps: workflow.steps,
          conversationId: createRunId(),
          ...(workflow.settings == null ? {} : { settings: workflow.settings }),
          ...(workflow.onCompleteWorkflowId == null
            ? {}
            : { onCompleteWorkflowId: workflow.onCompleteWorkflowId }),
          trigger: { type: 'manual' },
          ...(parsed.value.input == null ? {} : { input: parsed.value.input }),
        });
        deps.wake();
        res.status(202).json({ run: toRunView(run) });
      } catch (error) {
        logger.error('[workflows] failed to start run', error);
        unavailable(res);
      }
    },

    getRun: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { runId } = req.params as { runId?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (runId == null) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      try {
        const run = await deps.methods.getWorkflowRun(runId, owner);
        if (run == null) {
          res.status(404).json({ error: 'Run not found' });
          return;
        }
        res.status(200).json({ run: toRunView(run) });
      } catch (error) {
        logger.error('[workflows] failed to read run', error);
        unavailable(res);
      }
    },

    streamRun: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { runId } = req.params as { runId?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (runId == null) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      let initial;
      try {
        initial = await deps.methods.getWorkflowRun(runId, owner);
      } catch (error) {
        logger.error('[workflows] failed to open run stream', error);
        unavailable(res);
        return;
      }
      if (initial == null) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      let closed = false;
      let last = '';
      const write = (run: WorkflowRunRecordView): void => {
        const payload = `data: ${JSON.stringify({ run: toRunView(run) })}\n\n`;
        if (payload === last) {
          return;
        }
        last = payload;
        res.write(payload);
      };

      const stop = (): void => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(timer);
        res.end();
      };

      const timer = setInterval(() => {
        if (closed) {
          return;
        }
        void deps.methods
          .getWorkflowRun(runId, owner)
          .then((run) => {
            if (closed) {
              return;
            }
            if (run == null) {
              stop();
              return;
            }
            write(run);
            if (TERMINAL_STATUSES.includes(run.status)) {
              stop();
            }
          })
          .catch((error: unknown) => {
            logger.warn('[workflows] run stream poll failed', {
              runId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }, streamPollMs);
      timer.unref?.();

      req.on('close', () => {
        closed = true;
        clearInterval(timer);
      });

      write(initial);
      if (TERMINAL_STATUSES.includes(initial.status)) {
        stop();
      }
    },

    exportRun: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { runId } = req.params as { runId?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (runId == null) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      try {
        const run = await deps.methods.getWorkflowRun(runId, owner);
        if (run == null) {
          res.status(404).json({ error: 'Run not found' });
          return;
        }
        const view = toRunView(run);
        const artifacts: WorkflowArtifact[] = view.steps.map((step) => ({
          stepId: step.id,
          title: step.title,
          status: step.status,
          ...(step.startedAt == null ? {} : { startedAt: step.startedAt }),
          ...(step.settledAt == null ? {} : { settledAt: step.settledAt }),
          ...(step.result == null ? {} : { result: step.result }),
          ...(step.error == null ? {} : { error: step.error }),
        }));
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="workflow-run-${run.id}.json"`);
        res.status(200).json({ run: view, artifacts });
      } catch (error) {
        logger.error('[workflows] failed to export run', error);
        unavailable(res);
      }
    },

    approveStep: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { runId } = req.params as { runId?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (runId == null) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const parsed = parseApproveWorkflowStep(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      try {
        const run = await deps.methods.approveWorkflowStep({
          id: runId,
          userId: owner,
          stepIndex: parsed.value.stepIndex,
          now: now(),
        });
        if (run == null) {
          res.status(409).json({ error: 'That step is not waiting for approval' });
          return;
        }
        deps.wake();
        res.status(200).json({ run: toRunView(run) });
      } catch (error) {
        logger.error('[workflows] failed to approve step', error);
        unavailable(res);
      }
    },

    pauseRun: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { runId } = req.params as { runId?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (runId == null) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      try {
        const run = await deps.methods.pauseWorkflowRun(runId, owner, now());
        if (run == null) {
          res.status(409).json({ error: 'That run cannot be paused' });
          return;
        }
        deps.wake();
        res.status(200).json({ run: toRunView(run) });
      } catch (error) {
        logger.error('[workflows] failed to pause run', error);
        unavailable(res);
      }
    },

    resumeRun: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { runId } = req.params as { runId?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (runId == null) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      try {
        const run = await deps.methods.resumeWorkflowRun(runId, owner, now());
        if (run == null) {
          res.status(409).json({ error: 'That run is not paused' });
          return;
        }
        deps.wake();
        res.status(200).json({ run: toRunView(run) });
      } catch (error) {
        logger.error('[workflows] failed to resume run', error);
        unavailable(res);
      }
    },

    cancelRun: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      const { runId } = req.params as { runId?: string };
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (runId == null) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      try {
        const existing = await deps.methods.getWorkflowRun(runId, owner);
        if (existing == null) {
          res.status(404).json({ error: 'Run not found' });
          return;
        }
        const run = await deps.methods.cancelWorkflowRun(runId, owner, now());
        if (run == null) {
          res.status(404).json({ error: 'Run not found' });
          return;
        }
        const retire = deps.retireQueuedDelivery;
        if (retire != null) {
          await Promise.all(
            existing.steps.map(async (step) => {
              if (step.status !== 'running' || step.deliveryKey == null) {
                return;
              }
              try {
                await retire(step.deliveryKey, existing.workflowId);
              } catch (cause) {
                logger.warn('[workflows] queued delivery retirement failed', {
                  runId,
                  stepId: step.id,
                  error: cause instanceof Error ? cause.message : String(cause),
                });
              }
            }),
          );
        }
        await stopActiveTurns(existing);
        res.status(200).json({ run: toRunView(run) });
      } catch (error) {
        logger.error('[workflows] failed to cancel run', error);
        unavailable(res);
      }
    },
  };
}

export type WorkflowHandlers = ReturnType<typeof createWorkflowHandlers>;
