import { randomUUID } from 'node:crypto';
import {
  WORKFLOW_EVENTS_MAX,
  WORKFLOW_RUNS_PAGE_MAX,
  WORKFLOW_RUN_INPUT_MAX_LENGTH,
  WORKFLOW_STEP_MAX_ATTEMPTS,
} from 'coderax-data-provider';
import type {
  WorkflowEventTrigger,
  WorkflowRunEventType,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  WorkflowSettings,
  WorkflowStepInput,
  WorkflowStepStatus,
} from 'coderax-data-provider';
import type { Model, Types } from 'mongoose';
import type {
  IWorkflow,
  IWorkflowDocument,
  IWorkflowRun,
  IWorkflowRunEvent,
  IWorkflowSchedule,
  IWorkflowStepRun,
} from '~/types/workflow';
export type WorkflowScheduleWrite = Omit<
  IWorkflowSchedule,
  'leaseBy' | 'leaseUntil' | 'claimToken'
>;

export interface CreateWorkflowInput {
  userId: string;
  tenantId?: string;
  name: string;
  description?: string;
  agentId: string;
  steps: WorkflowStepInput[];
  settings?: WorkflowSettings;
  schedule?: WorkflowScheduleWrite;
  eventTriggers?: WorkflowEventTrigger[];
  onCompleteWorkflowId?: string;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string | null;
  agentId?: string;
  steps?: WorkflowStepInput[];
  settings?: WorkflowSettings | null;
  schedule?: WorkflowScheduleWrite | null;
  eventTriggers?: WorkflowEventTrigger[] | null;
  onCompleteWorkflowId?: string | null;
}

export interface CreateWorkflowRunInput {
  userId: string;
  tenantId?: string;
  workflowId: string;
  workflowName: string;
  agentId: string;
  steps: WorkflowStepInput[];
  conversationId: string;
  input?: string;
  settings?: WorkflowSettings;
  trigger?: WorkflowRunTrigger;
  onCompleteWorkflowId?: string;
  dedupeKey?: string;
}

export interface WorkflowEventLookupInput {
  userId: string;
  tenantId?: string;
  eventType: string;
  sourceId: string;
}

export interface CreateWorkflowEventRunInput {
  userId: string;
  tenantId?: string;
  workflowId: string;
  eventId: string;
  eventType: string;
  sourceId: string;
  input?: string;
  now: Date;
}

export interface ClaimWorkflowRunsInput {
  workerId: string;
  leaseToken: string;
  now: Date;
  leaseUntil: Date;
  limit: number;
}

export interface WorkflowRunPatch {
  status?: WorkflowRunStatus;
  currentStep?: number;
  steps?: IWorkflowStepRun[];
  conversationId?: string;
  events?: IWorkflowRunEvent[];
  error?: string | null;
  chainPending?: boolean;
  leaseUntil?: Date;
  pauseRequestedAt?: Date | null;
  startedAt?: Date;
  settledAt?: Date | null;
}

export interface UpdateWorkflowRunInput {
  id: string;
  leaseToken: string;
  now: Date;
  patch: WorkflowRunPatch;
}

export interface ApproveWorkflowStepInput {
  id: string;
  userId: string;
  stepIndex: number;
  now: Date;
}

export interface ClaimWorkflowSchedulesInput {
  workerId: string;
  now: Date;
  leaseUntil: Date;
  limit: number;
}

export interface CompleteWorkflowScheduleClaimInput {
  workflowId: string;
  claimToken: string;
  scheduledFor: Date;
  nextRunAt: Date | null;
  now: Date;
}

export interface WorkflowMethods {
  createWorkflow: (input: CreateWorkflowInput) => Promise<IWorkflow>;
  listWorkflows: (userId: string) => Promise<IWorkflow[]>;
  getWorkflow: (id: string, userId: string) => Promise<IWorkflow | null>;
  updateWorkflow: (
    id: string,
    userId: string,
    input: UpdateWorkflowInput,
  ) => Promise<IWorkflow | null>;
  deleteWorkflow: (id: string, userId: string) => Promise<boolean>;
  /** Account-deletion erasure for every workflow and run owned by one user. */
  deleteWorkflowsByUser: (userId: string) => Promise<void>;
  createWorkflowRun: (input: CreateWorkflowRunInput) => Promise<IWorkflowRun>;
  getWorkflowRun: (id: string, userId: string) => Promise<IWorkflowRun | null>;
  listWorkflowRuns: (userId: string, workflowId?: string) => Promise<IWorkflowRun[]>;
  claimWorkflowRuns: (input: ClaimWorkflowRunsInput) => Promise<IWorkflowRun[]>;
  updateWorkflowRun: (input: UpdateWorkflowRunInput) => Promise<IWorkflowRun | null>;
  releaseWorkflowRun: (id: string, leaseToken: string, now: Date) => Promise<boolean>;
  approveWorkflowStep: (input: ApproveWorkflowStepInput) => Promise<IWorkflowRun | null>;
  pauseWorkflowRun: (id: string, userId: string, now: Date) => Promise<IWorkflowRun | null>;
  resumeWorkflowRun: (id: string, userId: string, now: Date) => Promise<IWorkflowRun | null>;
  cancelWorkflowRun: (id: string, userId: string, now: Date) => Promise<IWorkflowRun | null>;
  /** Workflows owned by the principal that subscribe to this event. */
  listWorkflowsForEvent: (input: WorkflowEventLookupInput) => Promise<IWorkflow[]>;
  /** Starts one durable run per event occurrence; null means it already exists. */
  createWorkflowEventRun: (input: CreateWorkflowEventRunInput) => Promise<IWorkflowRun | null>;
  claimDueWorkflowSchedules: (input: ClaimWorkflowSchedulesInput) => Promise<IWorkflow[]>;
  completeWorkflowScheduleClaim: (
    input: CompleteWorkflowScheduleClaimInput,
  ) => Promise<IWorkflowRun | null>;
  releaseWorkflowScheduleClaim: (input: {
    workflowId: string;
    claimToken: string;
    nextRunAt: Date;
  }) => Promise<void>;
}

const ACTIVE_RUN_STATUSES: WorkflowRunStatus[] = ['queued', 'running'];
const PAUSABLE_RUN_STATUSES: WorkflowRunStatus[] = ['queued', 'running'];
const TERMINAL_RUN_STATUSES: WorkflowRunStatus[] = ['completed', 'failed', 'cancelled'];

function dependencyIds(
  step: WorkflowStepInput,
  index: number,
  steps: WorkflowStepInput[],
): string[] {
  if (step.dependsOn != null) {
    return Array.from(new Set(step.dependsOn));
  }
  return index === 0 ? [] : [steps[index - 1].id];
}

function stepFields(step: WorkflowStepInput, index: number, steps: WorkflowStepInput[]) {
  return {
    id: step.id,
    title: step.title,
    instruction: step.instruction,
    approvalRequired: step.approvalRequired === true,
    maxAttempts: Math.min(Math.max(step.maxAttempts ?? 3, 1), WORKFLOW_STEP_MAX_ATTEMPTS),
    dependsOn: dependencyIds(step, index, steps),
    ...(step.agentId == null ? {} : { agentId: step.agentId }),
    ...(step.runIf == null ? {} : { runIf: step.runIf }),
    ...(step.join == null ? {} : { join: step.join }),
    ...(step.timeoutMs == null ? {} : { timeoutMs: step.timeoutMs }),
  };
}

/** Matches one stored subscription: exact event type, and either any source or this one. */
function eventTriggerLookup(input: {
  eventType: string;
  sourceId: string;
}): Record<string, unknown> {
  return {
    eventTriggers: {
      $elemMatch: {
        eventType: input.eventType,
        $or: [{ sourceId: { $exists: false } }, { sourceId: null }, { sourceId: input.sourceId }],
      },
    },
  };
}

function normalizeStep(
  step: WorkflowStepInput,
  index: number,
  steps: WorkflowStepInput[],
): IWorkflowStepRun {
  return {
    ...stepFields(step, index, steps),
    status: 'pending',
    attempts: 0,
  };
}

function terminalStep(status: WorkflowStepStatus): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'skipped' || status === 'cancelled'
  );
}

function event(
  type: WorkflowRunEventType,
  at: Date,
  extra: { stepId?: string; message?: string } = {},
): IWorkflowRunEvent {
  return { type, at, ...extra };
}

function withEvent(events: IWorkflowRunEvent[], entry: IWorkflowRunEvent): IWorkflowRunEvent[] {
  const next = [...events, entry];
  return next.length > WORKFLOW_EVENTS_MAX ? next.slice(-WORKFLOW_EVENTS_MAX) : next;
}

function scheduleUpdate(nextRunAt: Date | null): Record<string, unknown> {
  if (nextRunAt == null) {
    return {
      $set: { 'schedule.enabled': false },
      $unset: {
        'schedule.nextRunAt': '',
        'schedule.leaseBy': '',
        'schedule.leaseUntil': '',
        'schedule.claimToken': '',
      },
    };
  }
  return {
    $set: { 'schedule.nextRunAt': nextRunAt },
    $unset: { 'schedule.leaseBy': '', 'schedule.leaseUntil': '', 'schedule.claimToken': '' },
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

export function createWorkflowMethods(mongoose: typeof import('mongoose')): WorkflowMethods {
  const Workflow = () => mongoose.models.Workflow as Model<IWorkflowDocument> | undefined;
  const WorkflowRun = () => mongoose.models.WorkflowRun as Model<IWorkflowRun> | undefined;

  const workflowModel = (): Model<IWorkflowDocument> => {
    const model = Workflow();
    if (model == null) {
      throw new Error('Workflow model is not registered');
    }
    return model;
  };

  const runModel = (): Model<IWorkflowRun> => {
    const model = WorkflowRun();
    if (model == null) {
      throw new Error('WorkflowRun model is not registered');
    }
    return model;
  };

  const objectId = (value: string): Types.ObjectId => new mongoose.Types.ObjectId(value);

  return {
    createWorkflow: async (input) => {
      const created = await workflowModel().create({
        id: randomUUID(),
        user: objectId(input.userId),
        ...(input.tenantId == null ? {} : { tenantId: input.tenantId }),
        name: input.name,
        ...(input.description == null ? {} : { description: input.description }),
        agentId: input.agentId,
        steps: input.steps.map((step, index) => stepFields(step, index, input.steps)),
        ...(input.settings == null ? {} : { settings: input.settings }),
        ...(input.schedule == null ? {} : { schedule: input.schedule }),
        ...(input.eventTriggers == null || input.eventTriggers.length === 0
          ? {}
          : { eventTriggers: input.eventTriggers }),
        ...(input.onCompleteWorkflowId == null
          ? {}
          : { onCompleteWorkflowId: input.onCompleteWorkflowId }),
      });
      return created.toObject() as IWorkflow;
    },

    listWorkflows: async (userId) => {
      const rows = await workflowModel()
        .find({ user: objectId(userId) })
        .sort({ createdAt: -1 })
        .limit(WORKFLOW_RUNS_PAGE_MAX)
        .lean<IWorkflow[]>();
      return rows;
    },

    getWorkflow: async (id, userId) =>
      workflowModel()
        .findOne({ id, user: objectId(userId) })
        .lean<IWorkflow | null>(),

    updateWorkflow: async (id, userId, input) => {
      const $set: Record<string, unknown> = {};
      const $unset: Record<string, ''> = {};
      if (input.name !== undefined) {
        $set.name = input.name;
      }
      if (input.agentId !== undefined) {
        $set.agentId = input.agentId;
      }
      if (input.steps !== undefined) {
        $set.steps = input.steps.map((step, index) =>
          stepFields(step, index, input.steps as WorkflowStepInput[]),
        );
      }
      if (input.settings === null) {
        $unset.settings = '';
      } else if (input.settings !== undefined) {
        $set.settings = input.settings;
      }
      if (input.schedule === null) {
        $unset.schedule = '';
      } else if (input.schedule !== undefined) {
        $set.schedule = input.schedule;
      }
      if (input.eventTriggers === null) {
        $unset.eventTriggers = '';
      } else if (input.eventTriggers !== undefined) {
        if (input.eventTriggers.length === 0) {
          $unset.eventTriggers = '';
        } else {
          $set.eventTriggers = input.eventTriggers;
        }
      }
      if (input.onCompleteWorkflowId === null) {
        $unset.onCompleteWorkflowId = '';
      } else if (input.onCompleteWorkflowId !== undefined) {
        $set.onCompleteWorkflowId = input.onCompleteWorkflowId;
      }
      if (input.description === null) {
        $unset.description = '';
      } else if (input.description !== undefined) {
        $set.description = input.description;
      }
      const update: Record<string, unknown> = {};
      if (Object.keys($set).length > 0) {
        update.$set = $set;
      }
      if (Object.keys($unset).length > 0) {
        update.$unset = $unset;
      }
      if (Object.keys(update).length === 0) {
        return workflowModel()
          .findOne({ id, user: objectId(userId) })
          .lean<IWorkflow | null>();
      }
      return workflowModel()
        .findOneAndUpdate({ id, user: objectId(userId) }, update, { new: true })
        .lean<IWorkflow | null>();
    },

    deleteWorkflow: async (id, userId) => {
      const result = await workflowModel().deleteOne({ id, user: objectId(userId) });
      if (result.deletedCount === 0) {
        return false;
      }
      await runModel().deleteMany({ workflowId: id, user: objectId(userId) });
      return true;
    },

    deleteWorkflowsByUser: async (userId) => {
      const user = objectId(userId);
      // Runs first: once the definitions are gone no new run can be created
      // from a schedule or event subscription while cleanup is in progress.
      await runModel().deleteMany({ user });
      await workflowModel().deleteMany({ user });
    },

    createWorkflowRun: async (input) => {
      if (input.dedupeKey != null) {
        const existing = await runModel()
          .findOne({ dedupeKey: input.dedupeKey })
          .lean<IWorkflowRun | null>();
        if (existing != null) {
          return existing;
        }
      }
      const createdAt = new Date();
      let created;
      try {
        created = await runModel().create({
          id: randomUUID(),
          workflowId: input.workflowId,
          user: objectId(input.userId),
          ...(input.tenantId == null ? {} : { tenantId: input.tenantId }),
          workflowName: input.workflowName,
          agentId: input.agentId,
          status: 'queued',
          currentStep: 0,
          steps: input.steps.map((step, index) => normalizeStep(step, index, input.steps)),
          conversationId: input.conversationId,
          ...(input.input == null ? {} : { input: input.input }),
          ...(input.settings == null ? {} : { settings: input.settings }),
          ...(input.trigger == null ? {} : { trigger: input.trigger }),
          ...(input.onCompleteWorkflowId == null
            ? {}
            : { onCompleteWorkflowId: input.onCompleteWorkflowId }),
          ...(input.dedupeKey == null ? {} : { dedupeKey: input.dedupeKey }),
          events: [
            event('run.queued', createdAt, {
              ...(input.trigger == null ? {} : { message: input.trigger.type }),
            }),
          ],
        });
      } catch (error) {
        if (input.dedupeKey != null && isDuplicateKey(error)) {
          const existing = await runModel()
            .findOne({ dedupeKey: input.dedupeKey })
            .lean<IWorkflowRun | null>();
          if (existing != null) {
            return existing;
          }
        }
        throw error;
      }
      return created.toObject() as IWorkflowRun;
    },

    getWorkflowRun: async (id, userId) =>
      runModel()
        .findOne({ id, user: objectId(userId) })
        .lean<IWorkflowRun | null>(),

    listWorkflowRuns: async (userId, workflowId) => {
      const filter: Record<string, unknown> = { user: objectId(userId) };
      if (workflowId != null) {
        filter.workflowId = workflowId;
      }
      return runModel()
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(WORKFLOW_RUNS_PAGE_MAX)
        .lean<IWorkflowRun[]>();
    },

    claimWorkflowRuns: async ({ workerId, leaseToken, now, leaseUntil, limit }) => {
      const filter = {
        $and: [
          {
            $or: [
              { status: { $in: ACTIVE_RUN_STATUSES } },
              // A completed run with an undelivered chain is still claimable so
              // a crash between terminal save and child creation can be retried.
              { status: 'completed', chainPending: true },
            ],
          },
          {
            $or: [
              { leaseUntil: { $exists: false } },
              { leaseUntil: null },
              { leaseUntil: { $lte: now } },
            ],
          },
        ],
      };
      const claimed: IWorkflowRun[] = [];
      for (let index = 0; index < limit; index += 1) {
        const row = await runModel()
          .findOneAndUpdate(
            filter,
            { $set: { leaseBy: workerId, leaseToken, leaseUntil } },
            { new: true, sort: { createdAt: 1 } },
          )
          .lean<IWorkflowRun | null>();
        if (row == null) {
          break;
        }
        claimed.push(row);
      }
      return claimed;
    },

    updateWorkflowRun: async ({ id, leaseToken, now, patch }) => {
      const $set: Record<string, unknown> = { ...patch, updatedAt: now };
      const $unset: Record<string, ''> = {};
      if (patch.error === null) {
        delete $set.error;
        $unset.error = '';
      }
      if (patch.settledAt === null) {
        delete $set.settledAt;
        $unset.settledAt = '';
      }
      if (patch.pauseRequestedAt === null) {
        delete $set.pauseRequestedAt;
        $unset.pauseRequestedAt = '';
      }
      const update: Record<string, unknown> = { $set };
      if (Object.keys($unset).length > 0) {
        update.$unset = $unset;
      }
      return runModel()
        .findOneAndUpdate({ id, leaseToken }, update, { new: true })
        .lean<IWorkflowRun | null>();
    },

    releaseWorkflowRun: async (id, leaseToken, now) => {
      const result = await runModel().updateOne(
        { id, leaseToken },
        {
          $set: { updatedAt: now },
          $unset: { leaseBy: '', leaseToken: '', leaseUntil: '' },
        },
      );
      return result.modifiedCount > 0;
    },

    approveWorkflowStep: async ({ id, userId, stepIndex, now }) => {
      const run = await runModel()
        .findOne({ id, user: objectId(userId) })
        .lean<IWorkflowRun | null>();
      if (run == null || run.status !== 'waiting_approval') {
        return null;
      }
      const step = run.steps[stepIndex];
      if (step == null || step.approvalRequired !== true || step.approvedAt != null) {
        return null;
      }
      const steps = run.steps.map((entry, index) =>
        index === stepIndex ? { ...entry, approvedAt: now } : entry,
      );
      const events = withEvent(
        run.events ?? [],
        event('step.approved', now, { stepId: step.id, message: step.title }),
      );
      return runModel()
        .findOneAndUpdate(
          { id, user: objectId(userId), status: 'waiting_approval' },
          {
            $set: { steps, events, status: 'queued', updatedAt: now },
            $unset: { leaseBy: '', leaseToken: '', leaseUntil: '' },
          },
          { new: true },
        )
        .lean<IWorkflowRun | null>();
    },

    pauseWorkflowRun: async (id, userId, now) => {
      const run = await runModel()
        .findOne({ id, user: objectId(userId) })
        .lean<IWorkflowRun | null>();
      if (run == null || !PAUSABLE_RUN_STATUSES.includes(run.status)) {
        return null;
      }
      const inFlight = run.steps.some((step) => step.status === 'running');
      const events = withEvent(
        run.events ?? [],
        inFlight
          ? event('run.paused', now, { message: 'Pausing after the running step settles' })
          : event('run.paused', now),
      );
      return runModel()
        .findOneAndUpdate(
          { id, user: objectId(userId), status: { $in: PAUSABLE_RUN_STATUSES } },
          {
            $set: {
              status: inFlight ? 'running' : 'paused',
              pauseRequestedAt: now,
              events,
              updatedAt: now,
            },
          },
          { new: true },
        )
        .lean<IWorkflowRun | null>();
    },

    resumeWorkflowRun: async (id, userId, now) => {
      const run = await runModel()
        .findOne({ id, user: objectId(userId), status: 'paused' })
        .lean<IWorkflowRun | null>();
      if (run == null) {
        return null;
      }
      const events = withEvent(run.events ?? [], event('run.resumed', now));
      return runModel()
        .findOneAndUpdate(
          { id, user: objectId(userId), status: 'paused' },
          {
            $set: { status: 'queued', events, updatedAt: now },
            $unset: { pauseRequestedAt: '' },
          },
          { new: true },
        )
        .lean<IWorkflowRun | null>();
    },

    cancelWorkflowRun: async (id, userId, now) => {
      const run = await runModel()
        .findOne({ id, user: objectId(userId) })
        .lean<IWorkflowRun | null>();
      if (run == null) {
        return null;
      }
      if (TERMINAL_RUN_STATUSES.includes(run.status)) {
        return run;
      }
      const steps = run.steps.map((step) => {
        if (terminalStep(step.status)) {
          return step;
        }
        if (step.status === 'running') {
          return {
            ...step,
            status: 'cancelled' as const,
            settledAt: now,
            reason: 'Cancelled while this step was in flight',
          };
        }
        return { ...step, status: 'skipped' as const, settledAt: now };
      });
      const events = withEvent(run.events ?? [], event('run.cancelled', now));
      return runModel()
        .findOneAndUpdate(
          { id, user: objectId(userId), status: { $nin: TERMINAL_RUN_STATUSES } },
          {
            $set: { status: 'cancelled', steps, events, settledAt: now, updatedAt: now },
            $unset: { leaseBy: '', leaseToken: '', leaseUntil: '' },
          },
          { new: true },
        )
        .lean<IWorkflowRun | null>();
    },

    listWorkflowsForEvent: async (input) => {
      const filter: Record<string, unknown> = {
        user: objectId(input.userId),
        ...(input.tenantId == null ? {} : { tenantId: input.tenantId }),
        ...eventTriggerLookup(input),
      };
      return workflowModel()
        .find(filter)
        .sort({ createdAt: 1 })
        .limit(WORKFLOW_RUNS_PAGE_MAX)
        .lean<IWorkflow[]>();
    },

    createWorkflowEventRun: async (input) => {
      const workflow = await workflowModel()
        .findOne({
          id: input.workflowId,
          user: objectId(input.userId),
          ...(input.tenantId == null ? {} : { tenantId: input.tenantId }),
          ...eventTriggerLookup(input),
        })
        .lean<IWorkflow | null>();
      if (workflow == null) {
        return null;
      }
      const trigger = (workflow.eventTriggers ?? []).find(
        (entry) =>
          entry.eventType === input.eventType &&
          (entry.sourceId == null || entry.sourceId === input.sourceId),
      );
      const inputText = [trigger?.input, input.input]
        .filter((value): value is string => value != null && value.trim().length > 0)
        .join('\n\n')
        .slice(0, WORKFLOW_RUN_INPUT_MAX_LENGTH);
      const dedupeKey = `workflow-event:${workflow.id}:${input.sourceId}:${input.eventId}`;
      // A read first keeps the call idempotent even before the unique sparse
      // index has finished building; the index still closes the replica race.
      if ((await runModel().exists({ dedupeKey })) != null) {
        return null;
      }
      try {
        const created = await runModel().create({
          id: randomUUID(),
          workflowId: workflow.id,
          user: workflow.user,
          ...(workflow.tenantId == null ? {} : { tenantId: workflow.tenantId }),
          workflowName: workflow.name,
          agentId: workflow.agentId,
          status: 'queued',
          currentStep: 0,
          steps: workflow.steps.map((step, index) => normalizeStep(step, index, workflow.steps)),
          conversationId: randomUUID(),
          ...(inputText.length === 0 ? {} : { input: inputText }),
          ...(workflow.settings == null ? {} : { settings: workflow.settings }),
          ...(workflow.onCompleteWorkflowId == null
            ? {}
            : { onCompleteWorkflowId: workflow.onCompleteWorkflowId }),
          trigger: {
            type: 'event',
            sourceId: input.sourceId,
            label: input.eventType,
          },
          events: [
            event('trigger.fired', input.now, {
              message: `${input.eventType} from ${input.sourceId}`,
            }),
            event('run.queued', input.now, { message: 'event' }),
          ],
          dedupeKey,
        });
        return created.toObject() as IWorkflowRun;
      } catch (error) {
        if (!isDuplicateKey(error)) {
          throw error;
        }
        return null;
      }
    },

    claimDueWorkflowSchedules: async ({ workerId, now, leaseUntil, limit }) => {
      const claimed: IWorkflow[] = [];
      for (let index = 0; index < limit; index += 1) {
        const claimToken = randomUUID();
        const row = await workflowModel()
          .findOneAndUpdate(
            {
              'schedule.enabled': true,
              'schedule.nextRunAt': { $lte: now },
              $or: [
                { 'schedule.leaseUntil': { $exists: false } },
                { 'schedule.leaseUntil': null },
                { 'schedule.leaseUntil': { $lte: now } },
              ],
            },
            {
              $set: {
                'schedule.leaseBy': workerId,
                'schedule.leaseUntil': leaseUntil,
                'schedule.claimToken': claimToken,
              },
            },
            { new: true, sort: { 'schedule.nextRunAt': 1 } },
          )
          .lean<IWorkflow | null>();
        if (row == null) {
          break;
        }
        claimed.push(row);
      }
      return claimed;
    },

    completeWorkflowScheduleClaim: async ({
      workflowId,
      claimToken,
      scheduledFor,
      nextRunAt,
      now,
    }) => {
      const workflow = await workflowModel()
        .findOne({ id: workflowId, 'schedule.claimToken': claimToken })
        .lean<IWorkflow | null>();
      if (workflow == null) {
        return null;
      }
      const dedupeKey = `workflow-schedule:${workflowId}:${scheduledFor.toISOString()}`;
      let created: IWorkflowRun | null = null;
      try {
        created = await runModel().create({
          id: randomUUID(),
          workflowId: workflow.id,
          user: workflow.user,
          ...(workflow.tenantId == null ? {} : { tenantId: workflow.tenantId }),
          workflowName: workflow.name,
          agentId: workflow.agentId,
          status: 'queued',
          currentStep: 0,
          steps: workflow.steps.map((step, index) => normalizeStep(step, index, workflow.steps)),
          ...(workflow.settings == null ? {} : { settings: workflow.settings }),
          ...(workflow.schedule?.input == null ? {} : { input: workflow.schedule.input }),
          ...(workflow.onCompleteWorkflowId == null
            ? {}
            : { onCompleteWorkflowId: workflow.onCompleteWorkflowId }),
          trigger: {
            type: 'schedule',
            sourceId: workflowId,
            label: scheduledFor.toISOString(),
          },
          events: [
            event('trigger.fired', now, {
              message: `Schedule fired for ${scheduledFor.toISOString()}`,
            }),
            event('run.queued', now, { message: 'schedule' }),
          ],
          dedupeKey,
        });
        created = (created as unknown as { toObject: () => IWorkflowRun }).toObject();
      } catch (error) {
        if (!isDuplicateKey(error)) {
          throw error;
        }
      }
      await workflowModel().updateOne(
        { id: workflowId, 'schedule.claimToken': claimToken },
        scheduleUpdate(nextRunAt),
      );
      return created;
    },

    releaseWorkflowScheduleClaim: async ({ workflowId, claimToken, nextRunAt }) => {
      await workflowModel().updateOne(
        { id: workflowId, 'schedule.claimToken': claimToken },
        {
          $set: { 'schedule.nextRunAt': nextRunAt },
          $unset: { 'schedule.leaseBy': '', 'schedule.leaseUntil': '', 'schedule.claimToken': '' },
        },
      );
    },
  };
}

export { WORKFLOW_STEP_MAX_ATTEMPTS };
