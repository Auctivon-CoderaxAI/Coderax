import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createWorkflowModel, createWorkflowRunModel } from '~/models/workflow';
import { createWorkflowMethods } from './workflow';

describe('workflow persistence', () => {
  let mongo: MongoMemoryServer;
  let methods: ReturnType<typeof createWorkflowMethods>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    createWorkflowModel(mongoose);
    createWorkflowRunModel(mongoose);
    methods = createWorkflowMethods(mongoose);
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  afterEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  const owner = () => new mongoose.Types.ObjectId().toString();

  it('persists a DAG definition, its settings and a schedule', async () => {
    const userId = owner();
    const nextRunAt = new Date(Date.now() + 60_000);
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Release',
      agentId: 'agent-1',
      steps: [
        { id: 'collect', title: 'Collect', instruction: 'Collect changes' },
        { id: 'notes', title: 'Notes', instruction: 'Write notes' },
      ],
      settings: { maxParallel: 3 },
      schedule: {
        enabled: true,
        cadence: { frequency: 'daily', hour: 9, minute: 0 },
        timezone: 'UTC',
        nextRunAt,
      },
    });

    expect(workflow.id).toBeDefined();
    expect(workflow.steps[1].dependsOn).toEqual(['collect']);
    expect(workflow.settings?.maxParallel).toBe(3);
    expect(workflow.schedule?.enabled).toBe(true);

    const loaded = await methods.getWorkflow(workflow.id, userId);
    expect(loaded?.schedule?.nextRunAt?.toISOString()).toBe(nextRunAt.toISOString());
    expect(await methods.getWorkflow(workflow.id, owner())).toBeNull();

    const cleared = await methods.updateWorkflow(workflow.id, userId, { schedule: null });
    expect(cleared?.schedule).toBeUndefined();
  });

  it('leases runs, records approvals and supports pause and resume', async () => {
    const userId = owner();
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Guarded',
      agentId: 'agent-1',
      steps: [
        { id: 'one', title: 'One', instruction: 'First', approvalRequired: true },
        { id: 'two', title: 'Two', instruction: 'Second' },
      ],
    });
    const run = await methods.createWorkflowRun({
      userId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: workflow.agentId,
      steps: workflow.steps,
      conversationId: 'conversation-1',
      trigger: { type: 'manual' },
    });
    expect(run.status).toBe('queued');
    expect(run.events.map((entry) => entry.type)).toEqual(['run.queued']);

    const now = new Date();
    const claimed = await methods.claimWorkflowRuns({
      workerId: 'worker-1',
      leaseToken: 'lease-1',
      now,
      leaseUntil: new Date(now.getTime() + 30_000),
      limit: 5,
    });
    expect(claimed.map((entry) => entry.id)).toEqual([run.id]);
    expect(
      await methods.claimWorkflowRuns({
        workerId: 'worker-2',
        leaseToken: 'lease-2',
        now,
        leaseUntil: new Date(now.getTime() + 30_000),
        limit: 5,
      }),
    ).toEqual([]);

    const waiting = await methods.updateWorkflowRun({
      id: run.id,
      leaseToken: 'lease-1',
      now,
      patch: {
        status: 'waiting_approval',
        steps: claimed[0].steps.map((entry) => ({ ...entry, approvalRequired: true })),
      },
    });
    expect(waiting?.status).toBe('waiting_approval');

    const approved = await methods.approveWorkflowStep({
      id: run.id,
      userId,
      stepIndex: 0,
      now,
    });
    expect(approved?.status).toBe('queued');
    expect(approved?.steps[0].approvedAt).toBeInstanceOf(Date);
    expect(approved?.events.map((entry) => entry.type)).toContain('step.approved');

    const paused = await methods.pauseWorkflowRun(run.id, userId, now);
    expect(paused?.status).toBe('paused');
    expect(paused?.pauseRequestedAt).toBeInstanceOf(Date);

    const resumed = await methods.resumeWorkflowRun(run.id, userId, now);
    expect(resumed?.status).toBe('queued');
    expect(resumed?.pauseRequestedAt).toBeUndefined();
  });

  it('cancels pending steps and refuses to advance a terminal run', async () => {
    const userId = owner();
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Stoppable',
      agentId: 'agent-1',
      steps: [
        { id: 'one', title: 'One', instruction: 'First' },
        { id: 'two', title: 'Two', instruction: 'Second' },
      ],
    });
    const run = await methods.createWorkflowRun({
      userId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: workflow.agentId,
      steps: workflow.steps,
      conversationId: 'conversation-2',
    });
    const now = new Date();
    const cancelled = await methods.cancelWorkflowRun(run.id, userId, now);
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.settledAt).toBeInstanceOf(Date);
    expect(cancelled?.steps.every((entry) => entry.status === 'skipped')).toBe(true);
    expect(cancelled?.events.map((entry) => entry.type)).toContain('run.cancelled');

    const again = await methods.cancelWorkflowRun(run.id, userId, new Date());
    expect(again?.status).toBe('cancelled');
  });

  it('creates exactly one run per scheduled occurrence and advances the schedule', async () => {
    const userId = owner();
    const scheduledFor = new Date(Date.now() - 60_000);
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Scheduled',
      agentId: 'agent-1',
      steps: [{ id: 'one', title: 'One', instruction: 'First' }],
      schedule: {
        enabled: true,
        cadence: { frequency: 'daily', hour: 9, minute: 0 },
        timezone: 'UTC',
        nextRunAt: scheduledFor,
      },
    });

    const due = await methods.claimDueWorkflowSchedules({
      workerId: 'worker-1',
      now: new Date(),
      leaseUntil: new Date(Date.now() + 30_000),
      limit: 5,
    });
    expect(due.map((entry) => entry.id)).toEqual([workflow.id]);
    const claimToken = due[0].schedule?.claimToken;
    expect(claimToken).toBeDefined();

    const nextRunAt = new Date(Date.now() + 24 * 60 * 60_000);
    const run = await methods.completeWorkflowScheduleClaim({
      workflowId: workflow.id,
      claimToken: claimToken as string,
      scheduledFor,
      nextRunAt,
      now: new Date(),
    });
    expect(run?.trigger?.type).toBe('schedule');
    expect(run?.dedupeKey).toBe(`workflow-schedule:${workflow.id}:${scheduledFor.toISOString()}`);
    expect(run?.events.map((entry) => entry.type)).toContain('trigger.fired');

    const replay = await methods.completeWorkflowScheduleClaim({
      workflowId: workflow.id,
      claimToken: claimToken as string,
      scheduledFor,
      nextRunAt,
      now: new Date(),
    });
    expect(replay).toBeNull();
    expect(
      await methods.claimDueWorkflowSchedules({
        workerId: 'worker-2',
        now: new Date(),
        leaseUntil: new Date(Date.now() + 30_000),
        limit: 5,
      }),
    ).toEqual([]);

    const reloaded = await methods.getWorkflow(workflow.id, userId);
    expect(reloaded?.schedule?.nextRunAt?.toISOString()).toBe(nextRunAt.toISOString());
    expect(
      (await methods.listWorkflowRuns(userId, workflow.id)).filter(
        (entry) => entry.trigger?.type === 'schedule',
      ),
    ).toHaveLength(1);
  });
});
