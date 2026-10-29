import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMethods, createModels } from '@coderax/data-schemas';
import { createWorkflowSchedules, createWorkflowStore } from './store';
import { createWorkflowEngine } from './engine';
import { createWorkflowHandlers } from './handlers';
import { computeNextRunAt } from '../schedules/cadence';

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
    await engine.runTick();
    expect(enqueued).toEqual(['queued-step']);
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
});
