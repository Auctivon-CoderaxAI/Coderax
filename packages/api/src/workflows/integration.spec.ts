import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMethods, createModels } from '@coderax/data-schemas';
import type { WorkflowAgentEvent } from './events';
import { createWorkflowSchedules, createWorkflowStore } from './store';
import { createWorkflowSettlementHandler } from './host';
import { computeNextRunAt } from '../schedules/cadence';
import { createWorkflowEventStarter } from './events';
import { createWorkflowHandlers } from './handlers';
import { createWorkflowEngine } from './engine';

/**
 * Exercises the durable path end to end: a real Mongo workflow definition, a
 * real run claimed and advanced by the runner, and the approval gate. Only the
 * model turn itself is simulated, because no provider is configured in tests.
 */
describe('workflow engine with Mongo persistence', () => {
  let mongo: MongoMemoryServer;
  let methods: ReturnType<typeof createMethods>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    createModels(mongoose);
    methods = createMethods(mongoose);
  }, 60_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  afterEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  const owner = () => new mongoose.Types.ObjectId().toString();

  function engineFor(options: {
    conversationId: string;
    enqueued: string[];
    generations: Map<string, { status: string; createdAt: number }>;
    now: () => Date;
    methods: ReturnType<typeof createMethods>;
  }) {
    return createWorkflowEngine(
      {
        store: createWorkflowStore(options.methods),
        enqueueStep: async ({ step }) => {
          options.enqueued.push(step.id);
          options.generations.set(options.conversationId, {
            status: 'running',
            createdAt: options.now().getTime(),
          });
          return `delivery:${step.id}:${step.attempts}`;
        },
        getGeneration: async () => options.generations.get(options.conversationId) ?? null,
        readStepResult: async ({ step }) => `artifact:${step.id}`,
        now: options.now,
        workerId: 'integration-worker',
      },
      { retryBaseMs: 1_000, retryCapMs: 1_000 },
    );
  }

  it('runs create → execute → approval → continue → complete', async () => {
    const userId = owner();
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Ship a change',
      agentId: 'agent-1',
      steps: [
        { id: 'draft', title: 'Draft', instruction: 'Draft the change' },
        {
          id: 'publish',
          title: 'Publish',
          instruction: 'Publish the change',
          approvalRequired: true,
          dependsOn: ['draft'],
        },
      ],
    });
    const run = await methods.createWorkflowRun({
      userId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: workflow.agentId,
      steps: workflow.steps,
      conversationId: 'integration-conversation',
      trigger: { type: 'manual' },
    });

    const clock = new Date('2026-03-01T00:00:00.000Z');
    const now = () => new Date(clock);
    const generations = new Map<string, { status: string; createdAt: number }>();
    const enqueued: string[] = [];
    const engine = engineFor({
      conversationId: 'integration-conversation',
      enqueued,
      generations,
      now,
      methods,
    });

    await engine.runTick();
    expect(enqueued).toEqual(['draft']);
    expect((await methods.getWorkflowRun(run.id, userId))?.status).toBe('running');

    generations.set('integration-conversation', {
      status: 'complete',
      createdAt: clock.getTime(),
    });
    await engine.runTick();

    const waiting = await methods.getWorkflowRun(run.id, userId);
    expect(waiting?.status).toBe('waiting_approval');
    expect(waiting?.steps[0].status).toBe('completed');
    expect(waiting?.steps[0].result).toBe('artifact:draft');
    expect(enqueued).toEqual(['draft']);

    await methods.approveWorkflowStep({ id: run.id, userId, stepIndex: 1, now: now() });
    await engine.runTick();
    expect(enqueued).toEqual(['draft', 'publish']);

    generations.set('integration-conversation', {
      status: 'complete',
      createdAt: clock.getTime(),
    });
    await engine.runTick();

    const finished = await methods.getWorkflowRun(run.id, userId);
    expect(finished?.status).toBe('completed');
    expect(finished?.settledAt).toBeInstanceOf(Date);
    expect(finished?.steps[1].status).toBe('completed');
    expect(finished?.events.map((entry) => entry.type)).toEqual(
      expect.arrayContaining([
        'run.queued',
        'step.dispatched',
        'step.completed',
        'step.approval_required',
        'step.approved',
        'run.completed',
      ]),
    );

    enqueued.length = 0;
    await engine.runTick();
    expect(enqueued).toEqual([]);
  });

  it('retires queued deliveries after durable cancellation and aborts active turns', async () => {
    const userId = owner();
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Cancel before dispatch',
      agentId: 'agent-1',
      steps: [{ id: 'queued-step', title: 'Queued', instruction: 'Run a tool' }],
    });
    const run = await methods.createWorkflowRun({
      userId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      agentId: workflow.agentId,
      steps: workflow.steps,
      conversationId: 'cancel-conversation',
      trigger: { type: 'manual' },
    });
    const generations = new Map<string, { status: string; createdAt: number }>();
    const enqueued: string[] = [];
    const engine = engineFor({
      conversationId: 'cancel-conversation',
      enqueued,
      generations,
      now: () => new Date('2026-03-01T00:00:00.000Z'),
      methods,
    });
    await engine.runTick();
    const active = await methods.getWorkflowRun(run.id, userId);
    expect(active?.steps[0].deliveryKey).toBe('delivery:queued-step:1');

    const retireQueuedDelivery = jest.fn(async () => true);
    const abortActiveRun = jest.fn(async () => undefined);
    const handlers = createWorkflowHandlers({
      methods,
      canRunAgent: async () => true,
      wake: () => undefined,
      retireQueuedDelivery,
      abortActiveRun,
    });
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Parameters<typeof handlers.cancelRun>[1];
    const request = {
      user: { id: userId },
      params: { runId: run.id },
    } as unknown as Parameters<typeof handlers.cancelRun>[0];
    await handlers.cancelRun(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(retireQueuedDelivery).toHaveBeenCalledWith('delivery:queued-step:1', workflow.id);
    expect(abortActiveRun).toHaveBeenCalledWith('cancel-conversation');
    expect((await methods.getWorkflowRun(run.id, userId))?.status).toBe('cancelled');

    // A later chat turn may reuse this conversation. Repeating cancellation
    // must not abort it or re-retire a delivery after the run is terminal.
    abortActiveRun.mockClear();
    retireQueuedDelivery.mockClear();
    await handlers.cancelRun(request, response);
    expect(response.status).toHaveBeenLastCalledWith(200);
    expect(abortActiveRun).not.toHaveBeenCalled();
    expect(retireQueuedDelivery).not.toHaveBeenCalled();

    await engine.runTick();
    expect(enqueued).toEqual(['queued-step']);
  });

  it('serializes reciprocal completion-target updates and leaves no cycle', async () => {
    const userId = owner();
    const a = await methods.createWorkflow({
      userId,
      name: 'A',
      agentId: 'agent-1',
      steps: [{ id: 'a', title: 'A', instruction: 'A' }],
    });
    const b = await methods.createWorkflow({
      userId,
      name: 'B',
      agentId: 'agent-1',
      steps: [{ id: 'b', title: 'B', instruction: 'B' }],
    });
    const handlers = createWorkflowHandlers({
      methods,
      canRunAgent: async () => true,
      wake: () => undefined,
    });
    const update = async (id: string, target: string) => {
      const status = jest.fn();
      const response = { status, json: jest.fn() };
      status.mockReturnValue(response);
      await handlers.updateWorkflow(
        {
          user: { id: userId },
          params: { id },
          body: { onCompleteWorkflowId: target },
        } as unknown as Parameters<typeof handlers.updateWorkflow>[0],
        response as unknown as Parameters<typeof handlers.updateWorkflow>[1],
      );
      return status;
    };

    const [first, second] = await Promise.all([update(a.id, b.id), update(b.id, a.id)]);
    const statuses = [first, second]
      .map((status) => status.mock.calls[0]?.[0])
      .sort((left, right) => Number(left) - Number(right));
    expect(statuses).toEqual([200, 400]);

    const reloaded = await Promise.all([
      methods.getWorkflow(a.id, userId),
      methods.getWorkflow(b.id, userId),
    ]);
    expect(reloaded.filter((workflow) => workflow?.onCompleteWorkflowId != null)).toHaveLength(1);
  });

  it('settles A to B to A without creating an alternating third run', async () => {
    const userId = owner();
    const b = await methods.createWorkflow({
      userId,
      name: 'B',
      agentId: 'agent-1',
      steps: [{ id: 'b', title: 'B', instruction: 'B' }],
    });
    const a = await methods.createWorkflow({
      userId,
      name: 'A',
      agentId: 'agent-1',
      steps: [{ id: 'a', title: 'A', instruction: 'A' }],
      onCompleteWorkflowId: b.id,
    });
    await methods.updateWorkflow(b.id, userId, { onCompleteWorkflowId: a.id });

    const runA = await methods.createWorkflowRun({
      userId,
      workflowId: a.id,
      workflowName: a.name,
      agentId: a.agentId,
      steps: a.steps,
      conversationId: 'conversation-a',
      workflowAncestry: [a.id],
      onCompleteWorkflowId: b.id,
      trigger: { type: 'manual' },
    });
    const now = new Date();
    const [leasedA] = await methods.claimWorkflowRuns({
      workerId: 'worker-a',
      leaseToken: 'lease-a',
      now,
      leaseUntil: new Date(now.getTime() + 30_000),
      limit: 1,
    });
    expect(leasedA?.id).toBe(runA.id);
    const completedA = await methods.updateWorkflowRun({
      id: runA.id,
      leaseToken: 'lease-a',
      now,
      patch: { status: 'completed', settledAt: now },
    });
    if (completedA == null) {
      throw new Error('A run did not complete');
    }

    const hostRun = (run: NonNullable<typeof completedA>) => ({
      ...run,
      userId,
      events: (run.events ?? []).map((entry) => ({
        ...entry,
        at: entry.at.toISOString(),
      })),
    });
    const wake = jest.fn();
    const settle = createWorkflowSettlementHandler({ methods, wake });
    await settle(hostRun(completedA));

    const afterA = await methods.listWorkflowRuns(userId);
    expect(afterA).toHaveLength(2);
    const childB = afterA.find((run) => run.workflowId === b.id);
    if (childB == null) {
      throw new Error('B child was not created');
    }
    expect(childB.workflowAncestry).toEqual([a.id, b.id]);
    expect(childB.onCompleteWorkflowId).toBe(a.id);
    expect(childB.dedupeKey).toBe(`workflow-chain:${runA.id}`);
    expect(wake).toHaveBeenCalledTimes(1);

    const next = new Date(now.getTime() + 1_000);
    const [leasedB] = await methods.claimWorkflowRuns({
      workerId: 'worker-b',
      leaseToken: 'lease-b',
      now: next,
      leaseUntil: new Date(next.getTime() + 30_000),
      limit: 1,
    });
    expect(leasedB?.id).toBe(childB.id);
    const completedB = await methods.updateWorkflowRun({
      id: childB.id,
      leaseToken: 'lease-b',
      now: next,
      patch: { status: 'completed', settledAt: next },
    });
    if (completedB == null) {
      throw new Error('B run did not complete');
    }

    await settle(hostRun(completedB));

    const finalRuns = await methods.listWorkflowRuns(userId);
    expect(finalRuns).toHaveLength(2);
    expect(finalRuns.filter((run) => run.workflowId === a.id)).toHaveLength(1);
    expect(finalRuns.filter((run) => run.workflowId === b.id)).toHaveLength(1);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('starts a scheduled workflow exactly once and stops an active run on cancel', async () => {
    const userId = owner();
    const clock = new Date('2026-03-01T00:00:00.000Z');
    const now = () => new Date(clock);
    const scheduledFor = new Date(clock.getTime() - 60_000);
    const workflow = await methods.createWorkflow({
      userId,
      name: 'Scheduled review',
      agentId: 'agent-1',
      steps: [
        { id: 'review', title: 'Review', instruction: 'Review the repository' },
        {
          id: 'report',
          title: 'Report',
          instruction: 'Report the findings',
          dependsOn: ['review'],
        },
      ],
      schedule: {
        enabled: true,
        cadence: { frequency: 'daily', hour: 9, minute: 0 },
        timezone: 'UTC',
        nextRunAt: scheduledFor,
      },
    });

    const generations = new Map<string, { status: string; createdAt: number }>();
    const enqueued = new Map<string, string[]>();
    const engine = createWorkflowEngine(
      {
        store: createWorkflowStore(methods),
        enqueueStep: async ({ run, step }) => {
          const key = step.conversationId ?? run.conversationId ?? 'missing';
          enqueued.set(key, [...(enqueued.get(key) ?? []), step.id]);
          generations.set(key, { status: 'running', createdAt: clock.getTime() });
          return `delivery:${step.id}:${step.attempts}`;
        },
        getGeneration: async (conversationId) => generations.get(conversationId) ?? null,
        now,
        workerId: 'integration-worker',
        schedules: createWorkflowSchedules({
          claimDue: methods.claimDueWorkflowSchedules,
          complete: methods.completeWorkflowScheduleClaim,
          release: methods.releaseWorkflowScheduleClaim,
          nextRunAt: ({ cadence, timezone, after, workflowId }) =>
            computeNextRunAt({ cadence, timezone, after, scheduleId: workflowId }),
        }),
      },
      { retryBaseMs: 1_000, retryCapMs: 1_000 },
    );

    await engine.runTick();
    const runs = await methods.listWorkflowRuns(userId, workflow.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger?.type).toBe('schedule');
    expect(runs[0].status).toBe('running');
    expect([...enqueued.values()].flat()).toEqual(['review']);

    const reloaded = await methods.getWorkflow(workflow.id, userId);
    expect(reloaded?.schedule?.nextRunAt?.getTime()).toBeGreaterThan(clock.getTime());

    const cancelled = await methods.cancelWorkflowRun(runs[0].id, userId, new Date());
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.steps[0].status).toBe('cancelled');
    expect(cancelled?.steps[1].status).toBe('skipped');

    await engine.runTick();
    expect([...enqueued.values()].flat()).toEqual(['review']);
    expect((await methods.getWorkflowRun(runs[0].id, userId))?.status).toBe('cancelled');

    // A fresh engine tick cannot double-start the same occurrence.
    const runsAfter = await methods.listWorkflowRuns(userId, workflow.id);
    expect(runsAfter).toHaveLength(1);
  });

  it('starts from a replayed agent event and completes the run', async () => {
    const userId = owner();
    const clock = new Date('2026-03-02T00:00:00.000Z');
    const now = () => new Date(clock);
    const workflow = await methods.createWorkflow({
      userId,
      tenantId: 'tenant-1',
      name: 'Deploy watch',
      agentId: 'agent-1',
      steps: [{ id: 'inspect', title: 'Inspect', instruction: 'Inspect the deployment' }],
      eventTriggers: [{ eventType: 'deploy.failed', input: 'Inspect the failed deployment.' }],
    });
    const starter = createWorkflowEventStarter({
      listWorkflowsForEvent: methods.listWorkflowsForEvent,
      createWorkflowEventRun: methods.createWorkflowEventRun,
      wake: jest.fn(),
      now,
    });
    const enqueued: Array<{ id: string; conversationId?: string }> = [];
    const generations = new Map<string, { status: string; createdAt: number }>();
    const engine = createWorkflowEngine(
      {
        store: createWorkflowStore(methods),
        enqueueStep: async ({ run, step }) => {
          const conversationId = step.conversationId ?? run.conversationId;
          enqueued.push({
            id: step.id,
            ...(conversationId == null ? {} : { conversationId }),
          });
          if (conversationId != null) {
            generations.set(conversationId, { status: 'running', createdAt: clock.getTime() });
          }
          return `delivery:${step.id}:${step.attempts}`;
        },
        getGeneration: async (conversationId) => generations.get(conversationId) ?? null,
        readStepResult: async () => 'Deployment inspected: the probe timed out.',
        now,
        workerId: 'event-worker',
      },
      { retryBaseMs: 1_000, retryCapMs: 1_000 },
    );
    const event: WorkflowAgentEvent = {
      userId,
      tenantId: 'tenant-1',
      eventId: 'delivery-1',
      eventType: 'deploy.failed',
      sourceId: 'webhook-1',
      sourceType: 'webhook',
      payload: { service: 'api' },
    };

    await expect(starter(event)).resolves.toBe(1);
    await expect(starter(event)).resolves.toBe(0);

    const [run] = await methods.listWorkflowRuns(userId, workflow.id);
    expect(run.trigger).toEqual({ type: 'event', sourceId: 'webhook-1', label: 'deploy.failed' });
    expect(run.input).toContain('Inspect the failed deployment.');
    expect(run.input).toContain('"service":"api"');
    expect(run.status).toBe('queued');

    await engine.runTick();
    expect(enqueued.map((entry) => entry.id)).toEqual(['inspect']);
    const conversationId = enqueued[0].conversationId;
    expect(conversationId).toBeDefined();

    generations.set(conversationId as string, {
      status: 'complete',
      createdAt: clock.getTime(),
    });
    await engine.runTick();

    const finished = await methods.getWorkflowRun(run.id, userId);
    expect(finished?.status).toBe('completed');
    expect(finished?.steps[0].result).toBe('Deployment inspected: the probe timed out.');
    expect(finished?.events.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(['trigger.fired', 'run.queued', 'run.completed']),
    );
  });
});
