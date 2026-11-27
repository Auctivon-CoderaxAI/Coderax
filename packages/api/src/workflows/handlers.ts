import { randomUUID } from 'node:crypto';
import { logger, WorkflowWorkspaceConflictError } from '@coderax/data-schemas';
import {
  WORKFLOW_RUNS_PAGE_MAX,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_TEMPLATES,
} from 'coderax-data-provider';
import type {
  WorkflowArtifact,
  WorkflowEventTrigger,
  WorkflowRunStatus,
  WorkflowRunView,
  WorkflowStepInput,
  WorkflowStepView,
  WorkflowView,
} from 'coderax-data-provider';
import type { WorkflowScheduleWrite } from '@coderax/data-schemas';
import type { WorkflowMethods } from '@coderax/data-schemas';
import type { Response } from 'express';
import type { WorkflowSchedulePayload } from './definition';
import type { ServerRequest } from '~/types';
import {
  formatWorkflowRunStreamId,
  latestRunSequence,
  parseWorkflowRunStreamId,
  sequenceRunEvents,
  toServerSentEventFrame,
} from './runStream';
import {
  parseApproveWorkflowStep,
  parseCreateWorkflow,
  parseStartWorkflowRun,
  parseUpdateWorkflow,
} from './definition';
import { parseStartBuild, prepareBuildLaunch } from '../autobuild/start';
import { computeNextRunAt, isValidTimezone } from '../schedules/cadence';

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
  eventTriggers?: WorkflowEventTrigger[];
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
  verification?: WorkflowRunView['verification'];
  trigger?: WorkflowRunView['trigger'];
  events?: Array<{
    at: Date | string;
    type: WorkflowRunView['events'][number]['type'];
    stepId?: string;
    message?: string;
    seq?: number;
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
    ...(workflow.eventTriggers == null || workflow.eventTriggers.length === 0
      ? {}
      : { eventTriggers: workflow.eventTriggers }),
    ...(workflow.onCompleteWorkflowId == null
      ? {}
      : { onCompleteWorkflowId: workflow.onCompleteWorkflowId }),
    createdAt: iso(workflow.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(workflow.updatedAt) ?? new Date(0).toISOString(),
  };
}

function toRunEventView(entry: {
  at: Date | string;
  type: WorkflowRunView['events'][number]['type'];
  stepId?: string;
  message?: string;
}): WorkflowRunView['events'][number] {
  return {
    at: iso(entry.at) ?? new Date(0).toISOString(),
    type: entry.type,
    ...(entry.stepId == null ? {} : { stepId: entry.stepId }),
    ...(entry.message == null ? {} : { message: entry.message }),
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
    ...(run.verification == null ? {} : { verification: run.verification }),
    ...(run.trigger == null ? {} : { trigger: run.trigger }),
    events: (run.events ?? []).map(toRunEventView),
    ...(run.pauseRequestedAt == null ? {} : { pauseRequestedAt: iso(run.pauseRequestedAt) }),
    createdAt: iso(run.createdAt) ?? new Date(0).toISOString(),
    ...(run.startedAt == null ? {} : { startedAt: iso(run.startedAt) }),
    ...(run.settledAt == null ? {} : { settledAt: iso(run.settledAt) }),
  };
}

function userId(req: ServerRequest): string | undefined {
  return req.user?.id;
}

/** A stream cursor is read from the request, never assumed. */
function headerValue(req: ServerRequest, name: string): string | undefined {
  const value = req.headers?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function queryValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0];
  }
  return undefined;
}

const RUN_STATUS_SET = new Set<string>(WORKFLOW_RUN_STATUSES);

/** `status` is a comma-separated list; an unknown name is a client error. */
function parseRunStatuses(value: string | undefined): WorkflowRunStatus[] | null {
  if (value == null) {
    return [];
  }
  const statuses = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (statuses.some((entry) => !RUN_STATUS_SET.has(entry))) {
    return null;
  }
  return statuses as WorkflowRunStatus[];
}

function parseRunLimit(value: string | undefined): number | null {
  if (value == null) {
    return WORKFLOW_RUNS_PAGE_MAX;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const limit = Number(value);
  return limit >= 1 && limit <= WORKFLOW_RUNS_PAGE_MAX ? limit : null;
}

/** `undefined` means absent, `null` means present but unparseable. */
function parseRunBefore(value: string | undefined): Date | null | undefined {
  if (value == null) {
    return undefined;
  }
  const before = new Date(value);
  return Number.isNaN(before.getTime()) ? null : before;
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
  // A run snapshot is one indexed row; 250 ms keeps the run card responsive
  // while a model turn is in flight without a write fan-out.
  const streamPollMs = deps.streamPollMs ?? 250;
  const ownerLocks = new Map<string, Promise<unknown>>();

  /** Serializes chain validation with the mutation in this process. */
  const withOwnerLock = async <T>(owner: string, action: () => Promise<T>): Promise<T> => {
    const previous = ownerLocks.get(owner) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    ownerLocks.set(owner, tail);
    try {
      return await current;
    } finally {
      if (ownerLocks.get(owner) === tail) {
        ownerLocks.delete(owner);
      }
    }
  };

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

  /** True only when every known writer for this run has been stopped. */
  const stopActiveTurns = async (run: {
    conversationId?: string;
    steps: Array<{ conversationId?: string; status: string }>;
  }): Promise<boolean> => {
    if (deps.abortActiveRun == null) {
      return true;
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
    const results = await Promise.allSettled(
      Array.from(conversations).map(async (conversationId) => {
        try {
          await deps.abortActiveRun?.(conversationId);
        } catch (cause) {
          logger.warn('[workflows] active turn abort failed', {
            conversationId,
            error: cause instanceof Error ? cause.message : String(cause),
          });
          throw cause;
        }
      }),
    );
    return results.every((result) => result.status === 'fulfilled');
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

    /**
     * Plan, validate and compile a project request, then create and start the
     * ordinary durable workflow that executes it. Planning is deterministic and
     * zero-cost here; a free/local model adapter can supply richer plans through
     * `planBuild` without changing this launch contract.
     */
    startBuild: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const parsed = parseStartBuild(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const prepared = prepareBuildLaunch(parsed.value);
      if (!prepared.ok) {
        res.status(400).json({ error: prepared.error.message });
        return;
      }

      const payload = prepared.value.compiled.workflow;
      const agentIds = new Set<string>([payload.agentId]);
      for (const step of payload.steps) {
        if (step.agentId != null) {
          agentIds.add(step.agentId);
        }
      }
      let createdWorkflowId: string | null = null;
      try {
        for (const agentId of agentIds) {
          if (!(await deps.canRunAgent(agentId, req))) {
            res.status(403).json({ error: 'You cannot run that agent' });
            return;
          }
        }
        const workflow = await deps.methods.createWorkflow({
          userId: owner,
          ...(req.user?.tenantId == null ? {} : { tenantId: req.user.tenantId }),
          name: payload.name,
          ...(payload.description == null ? {} : { description: payload.description }),
          agentId: payload.agentId,
          steps: payload.steps,
          ...(payload.settings == null ? {} : { settings: payload.settings }),
        });
        createdWorkflowId = workflow.id;
        const run = await deps.methods.createWorkflowRun({
          userId: owner,
          ...(req.user?.tenantId == null ? {} : { tenantId: req.user.tenantId }),
          workflowId: workflow.id,
          workflowName: workflow.name,
          agentId: workflow.agentId,
          steps: workflow.steps,
          conversationId: createRunId(),
          ...(workflow.settings == null ? {} : { settings: workflow.settings }),
          trigger: { type: 'manual' },
          input: parsed.value.request,
        });
        // The run now owns the workflow; a later failure must not delete it.
        createdWorkflowId = null;
        deps.wake();
        res.status(202).json({
          workflow: toWorkflowView(workflow),
          run: toRunView(run),
          build: {
            planner: 'deterministic',
            requestedMode: prepared.value.decision.requested,
            mode: prepared.value.decision.mode,
            degraded: prepared.value.decision.degraded,
            ...(prepared.value.decision.reason == null
              ? {}
              : { reason: prepared.value.decision.reason }),
            taskCount: prepared.value.plan.tasks.length,
            requiredGates: prepared.value.compiled.requiredGates,
            unresolvedRoles: prepared.value.compiled.unresolvedRoles,
          },
        });
      } catch (error) {
        if (createdWorkflowId != null) {
          await deps.methods.deleteWorkflow(createdWorkflowId, owner).catch((cleanupError) => {
            logger.warn('[workflows] failed to clean up unstarted build workflow', {
              workflowId: createdWorkflowId,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            });
          });
        }
        if (error instanceof WorkflowWorkspaceConflictError) {
          res
            .status(409)
            .json({ error: 'That build workspace is already in use by an active run' });
          return;
        }
        logger.error('[workflows] failed to start autonomous build', error);
        unavailable(res);
      }
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
          ...(parsed.value.eventTriggers == null || parsed.value.eventTriggers.length === 0
            ? {}
            : { eventTriggers: parsed.value.eventTriggers }),
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
        const updated = await withOwnerLock(owner, async () => {
          if (
            parsed.value.onCompleteWorkflowId !== undefined &&
            !(await chainIsValid(owner, id, parsed.value.onCompleteWorkflowId))
          ) {
            return { kind: 'invalid' as const };
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
            ...(parsed.value.eventTriggers === undefined
              ? {}
              : { eventTriggers: parsed.value.eventTriggers }),
            ...(parsed.value.onCompleteWorkflowId === undefined
              ? {}
              : { onCompleteWorkflowId: parsed.value.onCompleteWorkflowId }),
          });
          return workflow == null
            ? { kind: 'missing' as const }
            : { kind: 'ok' as const, workflow };
        });
        if (updated.kind === 'invalid') {
          res.status(400).json({ error: 'That completion target is not available' });
          return;
        }
        if (updated.kind === 'missing') {
          res.status(404).json({ error: 'Workflow not found' });
          return;
        }
        res.status(200).json(toWorkflowView(updated.workflow));
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

    /**
     * The owner-wide run index. A run started in the web UI is discoverable
     * here without knowing the workflow id that started it.
     */
    listAllRuns: async (req: ServerRequest, res: Response): Promise<void> => {
      const owner = userId(req);
      if (owner == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const query = (req.query ?? {}) as Record<string, unknown>;
      const statuses = parseRunStatuses(queryValue(query.status));
      if (statuses == null) {
        res.status(400).json({ error: 'Unknown run status' });
        return;
      }
      const limit = parseRunLimit(queryValue(query.limit));
      if (limit == null) {
        res.status(400).json({ error: `limit must be 1-${WORKFLOW_RUNS_PAGE_MAX}` });
        return;
      }
      const before = parseRunBefore(queryValue(query.before));
      if (before === null) {
        res.status(400).json({ error: 'before must be an ISO timestamp' });
        return;
      }
      try {
        const runs = await deps.methods.listWorkflowRuns(owner, queryValue(query.workflowId), {
          ...(statuses.length === 0 ? {} : { status: statuses }),
          ...(before === undefined ? {} : { before }),
          limit,
        });
        const oldest = runs[runs.length - 1];
        res.status(200).json({
          runs: runs.map(toRunView),
          /* Only a full page can have a successor. An exact fit costs one empty
           * read, which is cheaper than skipping a run. */
          nextBefore:
            runs.length === limit && oldest?.createdAt != null
              ? (iso(oldest.createdAt) ?? null)
              : null,
        });
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
        if (error instanceof WorkflowWorkspaceConflictError) {
          res
            .status(409)
            .json({ error: 'That build workspace is already in use by an active run' });
          return;
        }
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
      let initial: WorkflowRunRecordView | null;
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

      /**
       * A reconnect names the last durable event it applied. The cursor is
       * ignored unless it belongs to this run, and it cannot go backwards.
       */
      const cursor = parseWorkflowRunStreamId(headerValue(req, 'last-event-id'));
      const latest = latestRunSequence(initial.events);
      // A cursor past the log cannot be honoured: clamping it to the latest
      // durable event keeps a stale client from suppressing everything after it.
      const resumedFrom =
        cursor != null && cursor.runId === runId ? Math.min(cursor.sequence, latest) : null;
      let delivered = resumedFrom ?? latest;

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      // A dropped connection retries on its own; one second is the same order
      // as the poll below, so the gap is a frame rather than a lost interval.
      res.write('retry: 1000\n\n');

      let closed = false;
      let lastSnapshot = '';

      /** Writes each event this client has not applied, in log order. */
      const writeEvents = (run: WorkflowRunRecordView): void => {
        for (const { sequence, event } of sequenceRunEvents(run.events, delivered)) {
          res.write(
            toServerSentEventFrame({
              event: 'run-event',
              id: formatWorkflowRunStreamId(runId, sequence),
              data: { runId, sequence, event: toRunEventView(event) },
            }),
          );
          delivered = sequence;
        }
      };

      /**
       * The current run under a cursor that covers every event it contains, so
       * a client that applies the snapshot never needs those events again.
       * An unchanged snapshot is not resent.
       */
      const writeSnapshot = (run: WorkflowRunRecordView): void => {
        delivered = Math.max(delivered, latestRunSequence(run.events));
        const payload = toServerSentEventFrame({
          event: 'snapshot',
          id: formatWorkflowRunStreamId(runId, delivered),
          data: { run: toRunView(run) },
        });
        if (payload === lastSnapshot) {
          return;
        }
        lastSnapshot = payload;
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

      let pollPending = false;
      const timer = setInterval(() => {
        if (closed || pollPending) {
          return;
        }
        pollPending = true;
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
            writeEvents(run);
            writeSnapshot(run);
            if (TERMINAL_STATUSES.includes(run.status)) {
              stop();
            }
          })
          .catch((error: unknown) => {
            logger.warn('[workflows] run stream poll failed', {
              runId,
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            pollPending = false;
          });
      }, streamPollMs);
      timer.unref?.();

      req.on('close', () => {
        closed = true;
        clearInterval(timer);
      });

      // A fresh connection takes the snapshot as its cursor; a reconnect first
      // receives exactly the events it missed, in order.
      if (resumedFrom != null) {
        writeEvents(initial);
      }
      writeSnapshot(initial);
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
        // A repeated cancellation must not abort an unrelated turn started later
        // in the same conversation, or retire deliveries belonging to that turn.
        if (TERMINAL_STATUSES.includes(existing.status)) {
          res.status(200).json({ run: toRunView(existing) });
          return;
        }
        const run = await deps.methods.cancelWorkflowRun(runId, owner, now());
        if (run == null) {
          res.status(404).json({ error: 'Run not found' });
          return;
        }
        let stopped = false;
        try {
          const retire = deps.retireQueuedDelivery;
          if (retire != null) {
            await Promise.all(
              existing.steps.map(async (step) => {
                if (
                  (step.status !== 'running' && step.status !== 'queued') ||
                  step.deliveryKey == null
                ) {
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
          stopped = await stopActiveTurns(existing);
        } finally {
          // The checkout stays reserved while retirement and abort are in
          // flight, so a new build cannot start before the old writer stops.
          if (stopped) {
            await deps.methods.releaseWorkflowWorkspace(runId, owner).catch((cause) => {
              logger.warn('[workflows] workspace release after cancellation failed', {
                runId,
                error: cause instanceof Error ? cause.message : String(cause),
              });
            });
          } else {
            // Fail closed: a writer we could not stop must not share its checkout.
            logger.warn('[workflows] workspace held because a writer did not stop', { runId });
          }
        }
        res.status(200).json({ run: toRunView(run) });
      } catch (error) {
        logger.error('[workflows] failed to cancel run', error);
        unavailable(res);
      }
    },
  };
}

export type WorkflowHandlers = ReturnType<typeof createWorkflowHandlers>;
