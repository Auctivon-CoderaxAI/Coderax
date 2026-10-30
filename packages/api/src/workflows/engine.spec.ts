import type {
  WorkflowEngineStore,
  WorkflowGenerationState,
  WorkflowRunPatch,
  WorkflowRunRecord,
  WorkflowStepRecord,
} from './types';
import { createWorkflowEngine } from './engine';

const step = (overrides: Partial<WorkflowStepRecord> = {}): WorkflowStepRecord => ({
  id: 'one',
  title: 'One',
  instruction: 'Do the thing',
  approvalRequired: false,
  maxAttempts: 2,
  status: 'pending',
  attempts: 0,
  ...overrides,
});

function setup(steps: WorkflowStepRecord[], options: { stepTimeoutMs?: number } = {}) {
  let clock = new Date('2026-01-01T00:00:00.000Z');
  const now = () => new Date(clock);
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const run: WorkflowRunRecord = {
    id: 'run-1',
    userId: 'user-1',
    workflowId: 'wf-1',
    workflowName: 'Release',
    agentId: 'agent-1',
    status: 'queued',
    currentStep: 0,
    steps: steps.map((entry) => ({ ...entry })),
    conversationId: 'conversation-1',
    events: [],
  };
  let generation: WorkflowGenerationState | null = null;
  const enqueued: string[] = [];
  const store: WorkflowEngineStore = {
    claimRuns: async () => {
      if (
        run.status === 'completed' ||
        run.status === 'failed' ||
        run.status === 'cancelled' ||
        run.status === 'waiting_approval'
      ) {
        return [];
      }
      return [{ ...run, steps: run.steps.map((entry) => ({ ...entry })) }];
    },
    saveRun: async ({ patch }: { patch: WorkflowRunPatch }) => {
      Object.assign(run, patch);
      if (patch.steps != null) {
        run.steps = patch.steps.map((entry) => ({ ...entry }));
      }
      return true;
    },
    releaseRun: async () => undefined,
  };
  const engine = createWorkflowEngine(
    {
      store,
      enqueueStep: async ({ step: entry }) => {
        enqueued.push(entry.id);
        generation = { status: 'running', createdAt: clock.getTime() };
        return `delivery:${entry.id}:${entry.attempts}`;
      },
      getGeneration: async () => generation,
      now,
      random: () => 0.5,
      workerId: 'worker-1',
    },
    {
      retryBaseMs: 1_000,
      retryCapMs: 1_000,
      stepTimeoutMs: options.stepTimeoutMs ?? 30 * 60_000,
    },
  );
  return {
    engine,
    run,
    enqueued,
    advance,
    nowMs: () => clock.getTime(),
    generation: () => generation,
    setGeneration: (next: WorkflowGenerationState | null) => {
      generation = next;
    },
  };
}

describe('createWorkflowEngine', () => {
  it('runs steps in order and completes the run', async () => {
    const ctx = setup([step(), step({ id: 'two', title: 'Two' })]);
    await ctx.engine.runTick();
    expect(ctx.enqueued).toEqual(['one']);
    expect(ctx.run.status).toBe('running');
    expect(ctx.run.steps[0].status).toBe('running');
    expect(ctx.run.steps[0].deliveryKey).toBe('delivery:one:1');

    await ctx.engine.runTick();
    expect(ctx.enqueued).toEqual(['one']);

    ctx.setGeneration({ status: 'complete', createdAt: ctx.nowMs() });
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('completed');
    expect(ctx.run.currentStep).toBe(1);
    expect(ctx.enqueued).toEqual(['one', 'two']);

    ctx.setGeneration({ status: 'complete', createdAt: ctx.nowMs() });
    await ctx.engine.runTick();
    expect(ctx.run.steps[1].status).toBe('completed');
    expect(ctx.run.status).toBe('completed');
    expect(ctx.run.settledAt).toBeInstanceOf(Date);
  });

  it('waits for approval before dispatching a guarded step', async () => {
    const ctx = setup([step(), step({ id: 'two', approvalRequired: true })]);
    await ctx.engine.runTick();
    ctx.setGeneration({ status: 'complete', createdAt: ctx.nowMs() });
    await ctx.engine.runTick();

    expect(ctx.enqueued).toEqual(['one']);
    expect(ctx.run.status).toBe('waiting_approval');
    expect(ctx.run.currentStep).toBe(1);

    ctx.run.status = 'queued';
    ctx.run.steps[1].approvedAt = new Date('2026-01-01T00:00:00.000Z');
    await ctx.engine.runTick();
    expect(ctx.run.status).toBe('running');
    expect(ctx.enqueued).toEqual(['one', 'two']);
  });

  it('retries a failed generation and then fails the run', async () => {
    const ctx = setup([step({ maxAttempts: 2 })]);
    await ctx.engine.runTick();
    ctx.setGeneration({ status: 'error', createdAt: ctx.nowMs() });
    await ctx.engine.runTick();

    expect(ctx.run.steps[0].status).toBe('queued');
    expect(ctx.run.steps[0].deliveryKey).toBeUndefined();
    expect(ctx.run.steps[0].availableAt).toBeInstanceOf(Date);
    expect(ctx.run.status).toBe('running');

    ctx.advance(1_000);
    await ctx.engine.runTick();
    expect(ctx.enqueued).toEqual(['one', 'one']);
    expect(ctx.run.steps[0].attempts).toBe(2);

    ctx.setGeneration({ status: 'error', createdAt: ctx.nowMs() });
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('failed');
    expect(ctx.run.status).toBe('failed');
  });

  it('gives a timed-out retry its own full timeout window', async () => {
    const ctx = setup([step({ maxAttempts: 2 })], { stepTimeoutMs: 1_000 });
    await ctx.engine.runTick();
    const firstAttemptAt = ctx.run.steps[0].startedAt?.getTime();

    ctx.advance(1_100);
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('queued');

    ctx.advance(1_000);
    await ctx.engine.runTick();
    expect(ctx.enqueued).toEqual(['one', 'one']);
    expect(ctx.run.steps[0].attempts).toBe(2);
    expect(ctx.run.steps[0].startedAt?.getTime()).toBe(ctx.nowMs());
    expect(firstAttemptAt).toBeDefined();
    expect(ctx.run.steps[0].startedAt?.getTime()).toBeGreaterThan(firstAttemptAt ?? -1);

    ctx.advance(900);
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('running');

    ctx.advance(200);
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('failed');
  });

  it('ignores a completed generation from an earlier retry attempt', async () => {
    const ctx = setup([step({ maxAttempts: 2 })], { stepTimeoutMs: 1_000 });
    await ctx.engine.runTick();
    const staleGenerationAt = ctx.nowMs();

    ctx.advance(1_100);
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('queued');

    ctx.advance(1_000);
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].attempts).toBe(2);

    ctx.setGeneration({ status: 'complete', createdAt: staleGenerationAt });
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('running');

    ctx.setGeneration({ status: 'complete', createdAt: ctx.nowMs() });
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('completed');
    expect(ctx.run.status).toBe('completed');
  });

  it('fails a step whose generation never settles', async () => {
    const ctx = setup([step({ maxAttempts: 1 })], { stepTimeoutMs: 1_000 });
    await ctx.engine.runTick();
    ctx.advance(2_000);
    await ctx.engine.runTick();

    expect(ctx.run.steps[0].status).toBe('failed');
    expect(ctx.run.status).toBe('failed');
    expect(ctx.run.steps[0].error).not.toContain('stack');
  });

  it('ignores a generation that predates the current step', async () => {
    const ctx = setup([step()]);
    ctx.setGeneration({ status: 'complete', createdAt: 0 });
    await ctx.engine.runTick();

    // The first tick only dispatches; the stale completed job must not finish it.
    expect(ctx.enqueued).toEqual(['one']);
    expect(ctx.run.steps[0].status).toBe('running');

    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('running');

    ctx.setGeneration({ status: 'complete', createdAt: ctx.nowMs() });
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('completed');
  });

  it('does not dispatch twice while a step is in flight', async () => {
    const ctx = setup([step()]);
    await ctx.engine.runTick();
    await ctx.engine.runTick();
    await ctx.engine.runTick();
    expect(ctx.enqueued).toEqual(['one']);
  });
});

type EnqueuedStep = { id: string; conversationId?: string; instruction: string };

function branchSetup(steps: WorkflowStepRecord[], options: { maxParallel?: number } = {}) {
  let clock = new Date('2026-02-01T00:00:00.000Z');
  const now = () => new Date(clock);
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const run: WorkflowRunRecord = {
    id: 'run-branch',
    userId: 'user-1',
    workflowId: 'wf-1',
    workflowName: 'Branch',
    agentId: 'agent-1',
    status: 'queued',
    currentStep: 0,
    steps: steps.map((entry) => ({ ...entry })),
    conversationId: 'root-conversation',
    settings: { maxParallel: options.maxParallel ?? 4 },
    events: [],
  };
  const enqueued: EnqueuedStep[] = [];
  const generations = new Map<string, WorkflowGenerationState>();
  const store: WorkflowEngineStore = {
    claimRuns: async () =>
      run.status === 'queued' || run.status === 'running'
        ? [{ ...run, steps: run.steps.map((entry) => ({ ...entry })) }]
        : [],
    saveRun: async ({ patch }) => {
      Object.assign(run, patch);
      if (patch.steps != null) {
        run.steps = patch.steps.map((entry) => ({ ...entry }));
      }
      return true;
    },
    releaseRun: async () => undefined,
  };
  const engine = createWorkflowEngine(
    {
      store,
      enqueueStep: async ({ run: snapshot, step: entry }) => {
        enqueued.push({
          id: entry.id,
          ...(entry.conversationId == null ? {} : { conversationId: entry.conversationId }),
          instruction: entry.instruction,
        });
        const conversationId = entry.conversationId ?? snapshot.conversationId;
        if (conversationId != null) {
          generations.set(conversationId, { status: 'running', createdAt: clock.getTime() });
        }
        return `delivery:${entry.id}:${entry.attempts}`;
      },
      getGeneration: async (conversationId) => generations.get(conversationId) ?? null,
      readStepResult: async ({ step: entry }) => `result:${entry.id}`,
      now,
      random: () => 0.5,
      workerId: 'worker-1',
    },
    { retryBaseMs: 1_000, retryCapMs: 1_000 },
  );
  return {
    engine,
    run,
    enqueued,
    now,
    advance,
    complete: (stepId: string, status: 'complete' | 'error') => {
      const entry = [...enqueued].reverse().find((candidate) => candidate.id === stepId);
      if (entry?.conversationId == null) {
        throw new Error(`No conversation was recorded for ${stepId}`);
      }
      generations.set(entry.conversationId, { status, createdAt: clock.getTime() });
    },
  };
}

describe('createWorkflowEngine branches', () => {
  it('isolates independent root generations and lets each settle separately', async () => {
    const ctx = branchSetup(
      [
        step({ id: 'first-root', dependsOn: [], maxAttempts: 1 }),
        step({ id: 'second-root', dependsOn: [], maxAttempts: 1 }),
      ],
      { maxParallel: 2 },
    );

    await ctx.engine.runTick();
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['first-root', 'second-root']);
    const first = ctx.enqueued[0].conversationId;
    const second = ctx.enqueued[1].conversationId;
    expect(first).toBe('root-conversation');
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(ctx.run.steps[0].conversationId).toBe(first);
    expect(ctx.run.steps[1].conversationId).toBe(second);

    // Completing one parallel root must not complete or replace the other.
    ctx.complete('second-root', 'complete');
    await ctx.engine.runTick();
    expect(ctx.run.steps[0].status).toBe('running');
    expect(ctx.run.steps[1].status).toBe('completed');
    expect(ctx.run.status).toBe('running');

    ctx.complete('first-root', 'complete');
    await ctx.engine.runTick();
    expect(ctx.run.status).toBe('completed');
  });

  it('runs independent branches in parallel and hands their results to the merge step', async () => {
    const ctx = branchSetup([
      step({ id: 'root', maxAttempts: 1 }),
      step({ id: 'left', dependsOn: ['root'], maxAttempts: 1 }),
      step({ id: 'right', dependsOn: ['root'], maxAttempts: 1 }),
      step({ id: 'merge', dependsOn: ['left', 'right'], maxAttempts: 1 }),
    ]);

    await ctx.engine.runTick();
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['root']);

    ctx.complete('root', 'complete');
    await ctx.engine.runTick();
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['root', 'left', 'right']);
    const left = ctx.enqueued.find((entry) => entry.id === 'left');
    const right = ctx.enqueued.find((entry) => entry.id === 'right');
    expect(left?.conversationId).toBeDefined();
    expect(right?.conversationId).toBeDefined();
    expect(left?.conversationId).not.toBe(right?.conversationId);

    ctx.complete('left', 'complete');
    ctx.complete('right', 'complete');
    await ctx.engine.runTick();
    const merge = ctx.enqueued.find((entry) => entry.id === 'merge');
    expect(merge).toBeDefined();
    expect(merge?.conversationId).not.toBe(left?.conversationId);
    expect(merge?.instruction).toContain('Context from earlier branches');
    expect(merge?.instruction).toContain('result:left');
    expect(merge?.instruction).toContain('result:right');

    ctx.complete('merge', 'complete');
    await ctx.engine.runTick();
    expect(ctx.run.status).toBe('completed');
    expect(ctx.run.events.map((entry) => entry.type)).toContain('run.completed');
  });

  it('skips an unselected branch and lets a failure handler complete the run', async () => {
    const ctx = branchSetup([
      step({ id: 'attempt', maxAttempts: 1 }),
      step({
        id: 'success-path',
        dependsOn: ['attempt'],
        runIf: { stepId: 'attempt', status: 'completed' },
        maxAttempts: 1,
      }),
      step({
        id: 'failure-path',
        dependsOn: ['attempt'],
        runIf: { stepId: 'attempt', status: 'failed' },
        maxAttempts: 1,
      }),
    ]);

    await ctx.engine.runTick();
    ctx.complete('attempt', 'error');
    await ctx.engine.runTick();
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['attempt', 'failure-path']);

    ctx.complete('failure-path', 'complete');
    await ctx.engine.runTick();
    expect(ctx.run.steps.find((entry) => entry.id === 'success-path')?.status).toBe('skipped');
    expect(ctx.run.steps.find((entry) => entry.id === 'failure-path')?.status).toBe('completed');
    expect(ctx.run.status).toBe('completed');
  });

  it('pauses at a step boundary and resumes without duplicating the settled step', async () => {
    const ctx = branchSetup([
      step({ id: 'one', maxAttempts: 1 }),
      step({ id: 'two', dependsOn: ['one'], maxAttempts: 1 }),
    ]);

    await ctx.engine.runTick();
    ctx.run.pauseRequestedAt = ctx.now();
    ctx.complete('one', 'complete');
    await ctx.engine.runTick();

    expect(ctx.run.status).toBe('paused');
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['one']);

    ctx.run.status = 'queued';
    ctx.run.pauseRequestedAt = undefined;
    await ctx.engine.runTick();
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['one', 'two']);
    expect(ctx.run.status).toBe('running');
  });

  it('does not dispatch dependent branches while a parallel root drains for pause', async () => {
    const ctx = branchSetup(
      [
        step({ id: 'root-a', maxAttempts: 1 }),
        step({ id: 'root-b', maxAttempts: 1 }),
        step({ id: 'after-a', dependsOn: ['root-a'], maxAttempts: 1 }),
      ],
      { maxParallel: 2 },
    );

    await ctx.engine.runTick();
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['root-a', 'root-b']);

    ctx.run.pauseRequestedAt = ctx.now();
    ctx.complete('root-a', 'complete');
    await ctx.engine.runTick();
    expect(ctx.run.status).toBe('running');
    expect(ctx.run.steps.find((entry) => entry.id === 'root-a')?.status).toBe('completed');
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['root-a', 'root-b']);

    ctx.complete('root-b', 'complete');
    await ctx.engine.runTick();
    expect(ctx.run.status).toBe('paused');
    expect(ctx.run.steps.find((entry) => entry.id === 'after-a')?.status).toBe('pending');
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['root-a', 'root-b']);

    ctx.run.status = 'queued';
    ctx.run.pauseRequestedAt = undefined;
    await ctx.engine.runTick();
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['root-a', 'root-b', 'after-a']);
  });

  it('drains a due schedule once and advances its next occurrence', async () => {
    const complete = jest.fn(async () => undefined);
    const claimDue = jest.fn(async () => [
      {
        workflowId: 'wf-1',
        claimToken: 'claim-1',
        scheduledFor: new Date('2026-02-01T00:00:00.000Z'),
        cadence: { frequency: 'daily' as const, hour: 9, minute: 0 },
        timezone: 'UTC',
      },
    ]);
    const nextRunAt = new Date('2026-02-02T09:00:00.000Z');
    const engine = createWorkflowEngine({
      store: {
        claimRuns: async () => [],
        saveRun: async () => true,
        releaseRun: async () => undefined,
      },
      enqueueStep: async () => 'delivery',
      getGeneration: async () => null,
      schedules: {
        claimDue,
        complete,
        release: jest.fn(async () => undefined),
        computeNextRunAt: () => nextRunAt,
      },
      now: () => new Date('2026-02-01T00:00:00.000Z'),
      workerId: 'worker-1',
    });

    await engine.runTick();
    expect(claimDue).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        claimToken: 'claim-1',
        nextRunAt,
      }),
    );
  });
});
