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

  it('persists distinct step conversation IDs across a worker lease and MongoDB reload', async () => {
    const userId = owner();
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Parallel conversations',
      agentId: 'agent-1',
      steps: [
        { id: 'left', title: 'Left', instruction: 'Left task', dependsOn: [] },
        { id: 'right', title: 'Right', instruction: 'Right task', dependsOn: [] },
      ],
    });
    const run = await methods.createWorkflowRun({
      userId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: workflow.agentId,
      steps: workflow.steps,
      conversationId: 'root-conversation',
    });
    const now = new Date();
    const [claimed] = await methods.claimWorkflowRuns({
      workerId: 'worker-conversations',
      leaseToken: 'lease-conversations',
      now,
      leaseUntil: new Date(now.getTime() + 30_000),
      limit: 1,
    });
    expect(claimed?.id).toBe(run.id);

    const updated = await methods.updateWorkflowRun({
      id: run.id,
      leaseToken: 'lease-conversations',
      now,
      patch: {
        status: 'running',
        steps: claimed.steps.map((step, index) => ({
          ...step,
          status: 'running' as const,
          startedAt: now,
          conversationId: `step-conversation-${index}`,
        })),
      },
    });
    expect(updated?.steps.map((step) => step.conversationId)).toEqual([
      'step-conversation-0',
      'step-conversation-1',
    ]);

    const reloaded = await methods.getWorkflowRun(run.id, userId);
    expect(reloaded?.steps.map((step) => step.conversationId)).toEqual([
      'step-conversation-0',
      'step-conversation-1',
    ]);
    expect(reloaded?.steps[0].conversationId).not.toBe(reloaded?.steps[1].conversationId);
    expect(await methods.getWorkflowRun(run.id, owner())).toBeNull();
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

  it('preserves the scheduled occurrence identity when the advance write fails', async () => {
    const userId = owner();
    const scheduledFor = new Date('2026-03-01T09:00:00.000Z');
    const retryAt = new Date('2026-03-01T09:01:00.000Z');
    const nextRunAt = new Date('2026-03-02T09:00:00.000Z');
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Retry schedule',
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
      now: new Date('2026-03-01T09:00:01.000Z'),
      leaseUntil: new Date('2026-03-01T09:00:31.000Z'),
      limit: 5,
    });
    const claimToken = due[0].schedule?.claimToken as string;
    const workflowModel = mongoose.model('Workflow');
    const update = jest
      .spyOn(workflowModel, 'updateOne')
      .mockRejectedValueOnce(new Error('schedule advance unavailable'));

    await expect(
      methods.completeWorkflowScheduleClaim({
        workflowId: workflow.id,
        claimToken,
        scheduledFor,
        nextRunAt,
        now: new Date('2026-03-01T09:00:01.000Z'),
      }),
    ).rejects.toThrow('schedule advance unavailable');
    update.mockRestore();

    await methods.releaseWorkflowScheduleClaim({
      workflowId: workflow.id,
      claimToken,
      retryAt,
    });
    const retry = await methods.claimDueWorkflowSchedules({
      workerId: 'worker-2',
      now: retryAt,
      leaseUntil: new Date(retryAt.getTime() + 30_000),
      limit: 5,
    });
    expect(retry).toHaveLength(1);
    expect(new Date(retry[0].schedule?.nextRunAt as Date).toISOString()).toBe(
      scheduledFor.toISOString(),
    );

    const [inserted] = await methods.listWorkflowRuns(userId, workflow.id);
    expect(inserted).toBeDefined();
    const beforeReplay = await methods.getWorkflow(workflow.id, userId);
    expect(beforeReplay?.schedule?.nextRunAt?.toISOString()).toBe(scheduledFor.toISOString());

    const replay = await methods.completeWorkflowScheduleClaim({
      workflowId: workflow.id,
      claimToken: retry[0].schedule?.claimToken as string,
      scheduledFor,
      nextRunAt,
      now: retryAt,
    });
    expect(replay?.id).toBe(inserted.id);
    expect(replay?.dedupeKey).toBe(inserted.dedupeKey);
    expect(replay?.trigger?.label).toBe(scheduledFor.toISOString());

    const runs = await methods.listWorkflowRuns(userId, workflow.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(inserted.id);
    const reloaded = await methods.getWorkflow(workflow.id, userId);
    expect(reloaded?.schedule?.nextRunAt?.toISOString()).toBe(nextRunAt.toISOString());
    expect(reloaded?.schedule?.retryAt).toBeUndefined();
  });

  it('persists rich branch conditions and joins through a reload', async () => {
    const userId = owner();
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Branching',
      agentId: 'agent-1',
      steps: [
        { id: 'review', title: 'Review', instruction: 'Review the change' },
        {
          id: 'ship',
          title: 'Ship',
          instruction: 'Ship the change',
          dependsOn: ['review'],
          join: 'any',
          runIf: [
            { stepId: 'review', status: 'completed', resultIncludes: 'APPROVED' },
            { stepId: 'review', status: 'failed' },
          ],
        },
      ],
    });

    const reloaded = await methods.getWorkflow(workflow.id, userId);
    expect(reloaded?.steps[1].join).toBe('any');
    expect(reloaded?.steps[1].runIf).toEqual([
      { stepId: 'review', status: 'completed', resultIncludes: 'APPROVED' },
      { stepId: 'review', status: 'failed' },
    ]);
  });

  it('starts one durable run per event occurrence and keeps tenants and owners apart', async () => {
    const userId = owner();
    const workflow = await methods.createWorkflow({
      userId,
      tenantId: 'tenant-1',
      name: 'Deploy watch',
      agentId: 'agent-1',
      steps: [{ id: 'inspect', title: 'Inspect', instruction: 'Inspect the deployment' }],
      eventTriggers: [{ eventType: 'deploy.failed', input: 'Inspect the failed deployment.' }],
    });
    const restricted = await methods.createWorkflow({
      userId,
      tenantId: 'tenant-1',
      name: 'One source',
      agentId: 'agent-1',
      steps: [{ id: 'inspect', title: 'Inspect', instruction: 'Inspect the deployment' }],
      eventTriggers: [{ eventType: 'deploy.failed', sourceId: 'webhook-2' }],
    });

    const lookup = {
      userId,
      tenantId: 'tenant-1',
      eventType: 'deploy.failed',
      sourceId: 'webhook-1',
    };
    expect((await methods.listWorkflowsForEvent(lookup)).map((entry) => entry.id)).toEqual([
      workflow.id,
    ]);
    expect(await methods.listWorkflowsForEvent({ ...lookup, sourceId: 'webhook-2' })).toHaveLength(
      2,
    );
    expect(await methods.listWorkflowsForEvent({ ...lookup, tenantId: 'tenant-2' })).toEqual([]);
    expect(await methods.listWorkflowsForEvent({ ...lookup, userId: owner() })).toEqual([]);

    const now = new Date('2026-06-01T00:00:00.000Z');
    const first = await methods.createWorkflowEventRun({
      ...lookup,
      workflowId: workflow.id,
      eventId: 'event-1',
      now,
    });
    expect(first?.status).toBe('queued');
    expect(first?.trigger).toEqual({
      type: 'event',
      sourceId: 'webhook-1',
      label: 'deploy.failed',
    });
    expect(first?.dedupeKey).toBe(`workflow-event:${workflow.id}:webhook-1:event-1`);
    expect(first?.input).toBe('Inspect the failed deployment.');

    expect(
      await methods.createWorkflowEventRun({
        ...lookup,
        workflowId: workflow.id,
        eventId: 'event-1',
        now,
      }),
    ).toBeNull();
    expect(await methods.listWorkflowRuns(userId, workflow.id)).toHaveLength(1);

    expect(
      await methods.createWorkflowEventRun({
        ...lookup,
        workflowId: restricted.id,
        eventId: 'event-1',
        now,
      }),
    ).toBeNull();
    expect(
      await methods.createWorkflowEventRun({
        ...lookup,
        userId: owner(),
        workflowId: workflow.id,
        eventId: 'event-2',
        now,
      }),
    ).toBeNull();

    const cleared = await methods.updateWorkflow(workflow.id, userId, { eventTriggers: null });
    expect(cleared?.eventTriggers ?? []).toEqual([]);
    expect(await methods.listWorkflowsForEvent({ ...lookup, sourceId: 'webhook-1' })).toEqual([]);
  });

  it('erases workflows and runs for one deleted account only', async () => {
    const userId = owner();
    const otherUserId = owner();
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Delete me',
      agentId: 'agent-1',
      steps: [{ id: 'one', title: 'One', instruction: 'First' }],
    });
    await methods.createWorkflowRun({
      userId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: workflow.agentId,
      steps: workflow.steps,
      conversationId: 'conversation-delete',
    });
    const surviving = await methods.createWorkflow({
      userId: otherUserId,
      name: 'Keep me',
      agentId: 'agent-1',
      steps: [{ id: 'one', title: 'One', instruction: 'First' }],
    });

    await methods.deleteWorkflowsByUser(userId);

    expect(await methods.listWorkflows(userId)).toEqual([]);
    expect(await methods.listWorkflowRuns(userId)).toEqual([]);
    expect((await methods.listWorkflows(otherUserId)).map((entry) => entry.id)).toEqual([
      surviving.id,
    ]);
  });
});
