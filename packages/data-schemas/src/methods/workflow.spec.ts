import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { WorkflowRunVerification } from 'coderax-data-provider';
import { createWorkflowMethods, WorkflowWorkspaceConflictError } from '~/methods/workflow';
import { createWorkflowModel, createWorkflowRunModel } from '~/models/workflow';

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

  beforeEach(async () => {
    // dropDatabase removes the unique reservation index; rebuild it so every
    // test exercises the same atomic constraint as production.
    await mongoose.models.WorkflowRun.syncIndexes();
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

  it('persists the build repository and per-run workspace binding', async () => {
    const userId = owner();
    const settings = {
      build: {
        mode: 'autonomous' as const,
        requiredGates: ['tests' as const],
        repository: { owner: 'Auctivon-CoderaxAI', name: 'Coderax', baseRef: 'main' },
        workspace: 'build-checkout',
      },
    };
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Bound build',
      agentId: 'agent-1',
      steps: [{ id: 'ship', title: 'Ship', instruction: 'Ship the bound change' }],
      settings,
    });
    const run = await methods.createWorkflowRun({
      userId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: workflow.agentId,
      steps: workflow.steps,
      conversationId: 'conversation-workspace',
      settings,
    });

    const reloaded = await methods.getWorkflowRun(run.id, userId);
    expect(reloaded?.settings?.build).toMatchObject({
      repository: { owner: 'Auctivon-CoderaxAI', name: 'Coderax', baseRef: 'main' },
      workspace: 'build-checkout',
    });

    const [listed] = await methods.listWorkflowRuns(userId, workflow.id);
    expect(listed.settings?.build?.workspace).toBe('build-checkout');
    expect(reloaded?.workspaceKey).toBe('build-checkout');

    const [claimed] = await methods.claimWorkflowRuns({
      workerId: 'workspace-worker',
      leaseToken: 'workspace-lease',
      now: new Date(),
      leaseUntil: new Date(Date.now() + 30_000),
      limit: 1,
    });
    expect(claimed?.id).toBe(run.id);
    const failed = await methods.updateWorkflowRun({
      id: run.id,
      leaseToken: 'workspace-lease',
      now: new Date(),
      patch: { status: 'failed' },
    });
    expect(failed?.workspaceKey).toBeUndefined();

    const replacement = await methods.createWorkflowRun({
      userId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: workflow.agentId,
      steps: workflow.steps,
      conversationId: 'conversation-after-settle',
      settings,
    });
    expect(replacement.workspaceKey).toBe('build-checkout');
  });

  it('reserves a build workspace atomically across users', async () => {
    const workspace = 'contended-checkout';
    const settings = {
      build: {
        mode: 'autonomous' as const,
        requiredGates: ['tests' as const],
        repository: { owner: 'Auctivon-CoderaxAI', name: 'Coderax' },
        workspace,
      },
    };
    const buildWorkflow = (userId: string, name: string) =>
      methods.createWorkflow({
        userId,
        name,
        agentId: 'agent-1',
        steps: [{ id: 'ship', title: 'Ship', instruction: 'Ship it' }],
        settings,
      });
    const launch = (
      userId: string,
      workflow: Awaited<ReturnType<typeof buildWorkflow>>,
      conversationId: string,
    ) =>
      methods.createWorkflowRun({
        userId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        agentId: workflow.agentId,
        steps: workflow.steps,
        conversationId,
        settings,
        trigger: { type: 'manual' as const },
      });

    const firstUser = owner();
    const secondUser = owner();
    const [firstWorkflow, secondWorkflow] = await Promise.all([
      buildWorkflow(firstUser, 'First build'),
      buildWorkflow(secondUser, 'Second build'),
    ]);

    const results = await Promise.allSettled([
      launch(firstUser, firstWorkflow, 'first-conversation'),
      launch(secondUser, secondWorkflow, 'second-conversation'),
    ]);
    const winnerIndex = results.findIndex((result) => result.status === 'fulfilled');
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    const loser = results[winnerIndex === 0 ? 1 : 0];
    expect(loser.status).toBe('rejected');
    if (loser.status === 'rejected') {
      expect(loser.reason).toBeInstanceOf(WorkflowWorkspaceConflictError);
    }

    const winnerUserId = winnerIndex === 0 ? firstUser : secondUser;
    const loserUserId = winnerIndex === 0 ? secondUser : firstUser;
    const loserWorkflow = winnerIndex === 0 ? secondWorkflow : firstWorkflow;
    const winner = results[winnerIndex];
    if (winner.status !== 'fulfilled') {
      throw new Error('expected one workspace reservation winner');
    }
    expect(winner.value.id).toBeDefined();

    await methods.cancelWorkflowRun(winner.value.id, winnerUserId, new Date());
    // Cancellation keeps the checkout until the handler has stopped the writer.
    expect((await methods.getWorkflowRun(winner.value.id, winnerUserId))?.workspaceKey).toBe(
      workspace,
    );
    await expect(launch(loserUserId, loserWorkflow, 'blocked-conversation')).rejects.toBeInstanceOf(
      WorkflowWorkspaceConflictError,
    );
    await expect(methods.releaseWorkflowWorkspace(winner.value.id, winnerUserId)).resolves.toBe(
      true,
    );
    const retry = await launch(loserUserId, loserWorkflow, 'retry-conversation');
    expect(retry.workspaceKey).toBe(workspace);
  });

  it('applies the reservation to event-triggered runs', async () => {
    const workspace = 'event-checkout';
    const settings = {
      build: {
        mode: 'autonomous' as const,
        requiredGates: ['tests' as const],
        repository: { owner: 'Auctivon-CoderaxAI', name: 'Coderax' },
        workspace,
      },
    };
    const activeUser = owner();
    const eventUser = owner();
    const activeWorkflow = await methods.createWorkflow({
      userId: activeUser,
      name: 'Active build',
      agentId: 'agent-1',
      steps: [{ id: 'ship', title: 'Ship', instruction: 'Ship it' }],
      settings,
    });
    await methods.createWorkflowRun({
      userId: activeUser,
      workflowId: activeWorkflow.id,
      workflowName: activeWorkflow.name,
      agentId: activeWorkflow.agentId,
      steps: activeWorkflow.steps,
      conversationId: 'active-conversation',
      settings,
    });
    const eventWorkflow = await methods.createWorkflow({
      userId: eventUser,
      name: 'Event build',
      agentId: 'agent-1',
      steps: [{ id: 'ship', title: 'Ship', instruction: 'Ship it' }],
      settings,
      eventTriggers: [{ eventType: 'deploy.failed', sourceId: 'webhook-1' }],
    });

    await expect(
      methods.createWorkflowEventRun({
        userId: eventUser,
        workflowId: eventWorkflow.id,
        eventId: 'event-1',
        eventType: 'deploy.failed',
        sourceId: 'webhook-1',
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(WorkflowWorkspaceConflictError);
    expect(await methods.listWorkflowRuns(eventUser, eventWorkflow.id)).toEqual([]);
  });

  it('does not advance a due schedule while its workspace is reserved', async () => {
    const workspace = 'scheduled-checkout';
    const settings = {
      build: {
        mode: 'autonomous' as const,
        requiredGates: ['tests' as const],
        repository: { owner: 'Auctivon-CoderaxAI', name: 'Coderax' },
        workspace,
      },
    };
    const activeUser = owner();
    const scheduledUser = owner();
    const activeWorkflow = await methods.createWorkflow({
      userId: activeUser,
      name: 'Active build',
      agentId: 'agent-1',
      steps: [{ id: 'ship', title: 'Ship', instruction: 'Ship it' }],
      settings,
    });
    await methods.createWorkflowRun({
      userId: activeUser,
      workflowId: activeWorkflow.id,
      workflowName: activeWorkflow.name,
      agentId: activeWorkflow.agentId,
      steps: activeWorkflow.steps,
      conversationId: 'active-scheduled-conversation',
      settings,
    });
    const scheduledFor = new Date(Date.now() - 60_000);
    const scheduled = await methods.createWorkflow({
      userId: scheduledUser,
      name: 'Scheduled build',
      agentId: 'agent-1',
      steps: [{ id: 'ship', title: 'Ship', instruction: 'Ship it' }],
      settings,
      schedule: {
        enabled: true,
        cadence: { frequency: 'daily', hour: 9, minute: 0 },
        timezone: 'UTC',
        nextRunAt: scheduledFor,
      },
    });
    const [claim] = await methods.claimDueWorkflowSchedules({
      workerId: 'schedule-worker',
      now: new Date(),
      leaseUntil: new Date(Date.now() + 30_000),
      limit: 1,
    });
    expect(claim?.id).toBe(scheduled.id);
    const claimToken = claim?.schedule?.claimToken;
    expect(claimToken).toBeDefined();

    await expect(
      methods.completeWorkflowScheduleClaim({
        workflowId: scheduled.id,
        claimToken: claimToken as string,
        scheduledFor,
        nextRunAt: new Date(scheduledFor.getTime() + 24 * 60 * 60_000),
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(WorkflowWorkspaceConflictError);
    expect(await methods.listWorkflowRuns(scheduledUser, scheduled.id)).toEqual([]);
    const reloaded = await methods.getWorkflow(scheduled.id, scheduledUser);
    expect(reloaded?.schedule?.nextRunAt?.toISOString()).toBe(scheduledFor.toISOString());
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

  it('round-trips a build verification verdict through the run store', async () => {
    const userId = owner();
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Verified build',
      agentId: 'agent-1',
      steps: [{ id: 'ship', title: 'Ship', instruction: 'Ship the verified change' }],
    });
    const run = await methods.createWorkflowRun({
      userId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: workflow.agentId,
      steps: workflow.steps,
      conversationId: 'conversation-verification',
    });
    /** Absence is meaningful: the run has not been checked yet. */
    expect(run.verification).toBeUndefined();

    const now = new Date('2026-11-20T12:00:00.000Z');
    const [claimed] = await methods.claimWorkflowRuns({
      workerId: 'worker-verification',
      leaseToken: 'lease-verification',
      now,
      leaseUntil: new Date(now.getTime() + 30_000),
      limit: 1,
    });
    expect(claimed?.id).toBe(run.id);

    const verification: WorkflowRunVerification = {
      status: 'failed',
      mode: 'verified',
      outcome: 'partial',
      checkedAt: '2026-11-20T11:59:30.000Z',
      summary: 'Tests and build passed; the security audit did not.',
      gates: [
        { gate: 'tests', status: 'passed', summary: '1842 tests passed' },
        { gate: 'build', status: 'passed' },
        { gate: 'security', status: 'failed', summary: '2 high severity advisories' },
        { gate: 'review', status: 'not_run' },
      ],
      blockers: ['2 high severity advisories', 'Independent review evidence missing'],
      pullRequestUrl: 'https://github.com/Auctivon-CoderaxAI/Coderax/pull/226',
    };
    const settled = await methods.updateWorkflowRun({
      id: run.id,
      leaseToken: 'lease-verification',
      now,
      patch: {
        status: 'failed',
        error: 'Build evidence did not verify',
        verification,
        settledAt: now,
      },
    });
    expect(settled?.status).toBe('failed');
    expect(settled?.verification).toEqual(verification);

    const reloaded = await methods.getWorkflowRun(run.id, userId);
    expect(reloaded?.verification).toEqual(verification);
    expect(reloaded?.settledAt?.toISOString()).toBe(now.toISOString());

    const [listed] = await methods.listWorkflowRuns(userId, workflow.id);
    expect(listed.id).toBe(run.id);
    expect(listed.verification).toEqual(verification);

    /** A later settlement write must not silently drop the retained verdict. */
    const extended = await methods.updateWorkflowRun({
      id: run.id,
      leaseToken: 'lease-verification',
      now: new Date(now.getTime() + 1_000),
      patch: { error: 'Build evidence did not verify: security' },
    });
    expect(extended?.verification).toEqual(verification);
  });
});
