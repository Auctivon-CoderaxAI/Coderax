import { logger } from '@coderax/data-schemas';
import type { WorkflowRunRecord } from './types';
import {
  WorkflowStepInactiveError,
  assertWorkflowStepDeliveryActive,
  createWorkflowLifecycle,
  createWorkflowSettlementHandler,
  createWorkflowTerminalOutcomeHandler,
  parseWorkflowStepDelivery,
} from './host';
import { InMemoryEventTransport } from '../stream/implementations/InMemoryEventTransport';
import { InMemoryJobStore } from '../stream/implementations/InMemoryJobStore';
import { GenerationJobManagerClass } from '../stream/GenerationJobManager';
import { createWorkflowEngine } from './engine';

const trigger = {
  deliveryId: 'wf:run-1:step-1:2',
  event: {
    type: 'workflow.step',
    source: { type: 'workflow', id: 'workflow-1' },
  },
  metadata: {
    workflowRunId: 'run-1',
    workflowStepId: 'step-1',
  },
};

const runWithStep = (): WorkflowRunRecord => ({
  id: 'run-1',
  userId: 'user-1',
  workflowId: 'workflow-1',
  workflowName: 'Release',
  agentId: 'agent-1',
  status: 'running',
  currentStep: 0,
  steps: [
    {
      id: 'one',
      title: 'Step one',
      instruction: 'Do it',
      approvalRequired: false,
      maxAttempts: 1,
      status: 'running',
      attempts: 1,
      deliveryKey: 'delivery-1',
      conversationId: 'conversation-1',
    },
  ],
  events: [],
});

const run = (overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord => ({
  id: 'run-1',
  userId: 'user-1',
  workflowId: 'workflow-1',
  workflowName: 'Release',
  agentId: 'agent-1',
  status: 'running',
  currentStep: 0,
  steps: [
    {
      id: 'step-1',
      title: 'Step one',
      instruction: 'Do it',
      approvalRequired: false,
      maxAttempts: 1,
      status: 'running',
      attempts: 2,
    },
  ],
  events: [],
  ...overrides,
});

describe('workflow step delivery admission', () => {
  it('parses the trusted workflow fire envelope', () => {
    expect(parseWorkflowStepDelivery(trigger)).toEqual({
      runId: 'run-1',
      stepId: 'step-1',
      attempt: 2,
      workflowId: 'workflow-1',
    });
    expect(parseWorkflowStepDelivery({ ...trigger, deliveryId: 'trigger_hash' })).toBeNull();
    expect(
      parseWorkflowStepDelivery({ ...trigger, event: { type: 'schedule.occurrence' } }),
    ).toBeNull();
  });

  it('accepts the active attempt and rejects a cancelled run', async () => {
    const getWorkflowRun = jest.fn().mockResolvedValue(run());
    await expect(
      assertWorkflowStepDeliveryActive({ getWorkflowRun, trigger, userId: 'user-1' }),
    ).resolves.toBeUndefined();

    getWorkflowRun.mockResolvedValueOnce(run({ status: 'cancelled' }));
    await expect(
      assertWorkflowStepDeliveryActive({ getWorkflowRun, trigger, userId: 'user-1' }),
    ).rejects.toBeInstanceOf(WorkflowStepInactiveError);
  });

  it('persists a terminal receipt before default job cleanup removes the job', async () => {
    const manager = new GenerationJobManagerClass();
    manager.configure({
      jobStore: new InMemoryJobStore(),
      eventTransport: new InMemoryEventTransport(),
      isRedis: false,
      cleanupOnComplete: true,
    });
    manager.initialize();

    const run = runWithStep();
    const wake = jest.fn();
    const record = jest.fn(
      async (input: { attempt: number; status: 'complete' | 'error'; result?: string | null }) => {
        run.steps[0].terminalStatus = input.status;
        run.steps[0].terminalAttempt = input.attempt;
        run.steps[0].result = input.result ?? undefined;
        return true;
      },
    );
    manager.setTerminalHostActionHandler(
      createWorkflowTerminalOutcomeHandler({
        record,
        readResult: async () => 'first result',
        wake,
        now: () => new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    const job = await manager.createJob('stream-1', 'user-1', 'conversation-1', {
      initialMetadata: {
        workflowRunId: 'run-1',
        workflowStepId: 'one',
        workflowStepAttempt: 1,
      },
    });
    await manager.armTerminalHostAction('stream-1', job.createdAt);
    const executionId = job.metadata.providerExecutionId as string;
    await manager.beginProviderExecution('stream-1', job.createdAt, executionId);
    await manager.completeJob('stream-1', undefined, job.createdAt);
    await manager.markProviderExecutionDrained('stream-1', job.createdAt, executionId);

    expect(await manager.getJob('stream-1')).toBeUndefined();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, status: 'complete', result: 'first result' }),
    );
    expect(wake).toHaveBeenCalledTimes(1);

    const getGeneration = jest.fn(async () => {
      throw new Error('the deleted job must not be read');
    });
    const engine = createWorkflowEngine({
      store: {
        claimRuns: async () => [run],
        saveRun: async ({ patch }) => {
          Object.assign(run, patch);
          if (patch.steps != null) {
            run.steps = patch.steps;
          }
          return true;
        },
        extendLease: async () => true,
        releaseRun: async () => undefined,
      },
      enqueueStep: jest.fn(async () => 'unused'),
      getGeneration,
      workerId: 'worker-1',
    });
    await engine.runTick();

    expect(getGeneration).not.toHaveBeenCalled();
    expect(run.steps[0].status).toBe('completed');
    expect(run.status).toBe('completed');
    await manager.destroy();
  });

  it('stops an automatic chain when its ancestry already contains the target', async () => {
    const created: Array<Record<string, unknown>> = [];
    const workflows: Record<string, { id: string; onCompleteWorkflowId?: string }> = {
      a: { id: 'a', onCompleteWorkflowId: 'b' },
      b: { id: 'b', onCompleteWorkflowId: 'a' },
    };
    const handler = createWorkflowSettlementHandler({
      methods: {
        getWorkflow: async (id: string) => workflows[id] ?? null,
        createWorkflowRun: async (input: Record<string, unknown>) => {
          created.push(input);
          return { ...input, id: 'child' } as never;
        },
      } as never,
      wake: () => undefined,
    });
    const parent = {
      ...runWithStep(),
      workflowId: 'a',
      status: 'completed' as const,
      workflowAncestry: ['a'],
      onCompleteWorkflowId: 'b',
    };
    await handler(parent);
    expect(created).toHaveLength(1);
    expect(created[0].workflowAncestry).toEqual(['a', 'b']);

    await handler({
      ...parent,
      workflowId: 'b',
      workflowAncestry: ['a', 'b'],
      onCompleteWorkflowId: 'a',
    });
    expect(created).toHaveLength(1);
  });

  it('rejects a stale attempt after the job exists', async () => {
    await expect(
      assertWorkflowStepDeliveryActive({
        getWorkflowRun: async () =>
          run({
            steps: run().steps.map((step) => ({ ...step, attempts: 3 })),
          }),
        trigger,
        userId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(WorkflowStepInactiveError);
  });
});

describe('workflow engine startup ordering', () => {
  const makeEngine = () => ({
    start: jest.fn(),
    stop: jest.fn(async () => undefined),
    wake: jest.fn(),
    runTick: jest.fn(async () => 0),
  });

  it('defers early wakes and reads until deployment settings initialize the engine', () => {
    const engine = makeEngine();
    const createEngine = jest.fn(() => engine);
    const lifecycle = createWorkflowLifecycle(createEngine);
    lifecycle.wake();
    expect(createEngine).not.toHaveBeenCalled();
    expect(() => lifecycle.getEngine()).toThrow('Workflow engine is not initialized');

    const options = { concurrency: 2, retryBaseMs: 750, stepTimeoutMs: 4_000 };
    expect(lifecycle.initialize(options)).toBe(true);
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(createEngine).toHaveBeenCalledWith(options);
    expect(engine.start).toHaveBeenCalledTimes(1);

    lifecycle.wake();
    expect(engine.wake).toHaveBeenCalledTimes(1);
    expect(createEngine).toHaveBeenCalledTimes(1);
  });

  it('does not arm when the build workspace environment is not configured', () => {
    const engine = makeEngine();
    const createEngine = jest.fn(() => engine);
    const lifecycle = createWorkflowLifecycle(createEngine);

    expect(
      lifecycle.initialize(
        {
          buildVerification: {
            workspaceRoot: '/srv/builds',
            workspaceEnvironmentId: 'build-machien',
            commands: [{ gate: 'tests', command: 'npm' }],
          },
        },
        [{ id: 'build-machine', type: 'attached' }],
      ),
    ).toBe(false);

    expect(createEngine).not.toHaveBeenCalled();
    expect(engine.start).not.toHaveBeenCalled();
    expect(() => lifecycle.getEngine()).toThrow('Workflow engine is not initialized');
  });

  it('logs why the build workspace configuration refused to arm', () => {
    const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const lifecycle = createWorkflowLifecycle(makeEngine);

    expect(
      lifecycle.initialize(
        {
          buildVerification: {
            workspaceRoot: '/srv/builds',
            workspaceEnvironmentId: 'build-machien',
            commands: [{ gate: 'tests', command: 'npm' }],
          },
        },
        [{ id: 'build-machine', type: 'attached' }],
      ),
    ).toBe(false);

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        'workflows.buildVerification.workspaceEnvironmentId "build-machien" is not a configured stateful-code environment',
      ),
      expect.any(Error),
    );
    errorLog.mockRestore();
  });

  it('never wakes a runner after initialization fails', () => {
    const engine = makeEngine();
    engine.start.mockImplementation(() => {
      throw new Error('runner unavailable');
    });
    const lifecycle = createWorkflowLifecycle(() => engine);
    expect(lifecycle.initialize({ concurrency: 2 })).toBe(false);
    lifecycle.wake();
    expect(engine.wake).not.toHaveBeenCalled();
    expect(() => lifecycle.getEngine()).toThrow('Workflow engine is not initialized');
  });
});
