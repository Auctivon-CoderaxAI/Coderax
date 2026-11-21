import { WORKFLOW_HANDOFF_MAX_LENGTH } from 'coderax-data-provider';
import { getTenantId, SYSTEM_TENANT_ID } from '@coderax/data-schemas';
import type { WorkflowRunVerification } from 'coderax-data-provider';
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
  const instructions: string[] = [];
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
        instructions.push(entry.instruction);
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
    instructions,
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

  it('carries a linear predecessor result into the next turn input', async () => {
    const ctx = setup([step(), step({ id: 'two', title: 'Two' })]);
    await ctx.engine.runTick();
    ctx.run.steps[0].result = 'unique predecessor artifact';
    ctx.setGeneration({ status: 'complete', createdAt: ctx.nowMs() });
    await ctx.engine.runTick();

    expect(ctx.enqueued).toEqual(['one', 'two']);
    expect(ctx.instructions[1]).toContain('unique predecessor artifact');
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

function branchSetup(
  steps: WorkflowStepRecord[],
  options: { maxParallel?: number; result?: (stepId: string) => string } = {},
) {
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
      readStepResult: async ({ step: entry }) => options.result?.(entry.id) ?? `result:${entry.id}`,
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
        step({ id: 'root-a', dependsOn: [], maxAttempts: 1 }),
        step({ id: 'root-b', dependsOn: [], maxAttempts: 1 }),
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

  it('runs schedule and run claims in explicit system tenant context', async () => {
    const observed: string[] = [];
    const engine = createWorkflowEngine({
      store: {
        claimRuns: async () => {
          observed.push(`run:${getTenantId()}`);
          return [];
        },
        saveRun: async () => true,
        releaseRun: async () => undefined,
      },
      enqueueStep: async () => 'delivery',
      getGeneration: async () => null,
      schedules: {
        claimDue: async () => {
          observed.push(`schedule:${getTenantId()}`);
          return [];
        },
        complete: async () => undefined,
        release: async () => undefined,
        computeNextRunAt: () => new Date('2026-02-02T00:00:00.000Z'),
      },
      workerId: 'system-context-worker',
    });

    await engine.runTick();
    expect(observed).toEqual([`schedule:${SYSTEM_TENANT_ID}`, `run:${SYSTEM_TENANT_ID}`]);
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

describe('createWorkflowEngine advanced branching', () => {
  it('starts an any-join merge as soon as one branch completes', async () => {
    const ctx = branchSetup(
      [
        step({ id: 'left', dependsOn: [], maxAttempts: 1 }),
        step({ id: 'right', dependsOn: [], maxAttempts: 1 }),
        step({ id: 'merge', dependsOn: ['left', 'right'], join: 'any', maxAttempts: 1 }),
      ],
      { maxParallel: 2 },
    );

    await ctx.engine.runTick();
    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['left', 'right']);

    ctx.complete('left', 'complete');
    await ctx.engine.runTick();

    const merge = ctx.enqueued.find((entry) => entry.id === 'merge');
    expect(merge).toBeDefined();
    expect(merge?.instruction).toContain('result:left');
    expect(merge?.instruction).not.toContain('result:right');
  });

  it('runs a step only when the predecessor result contains the required text', async () => {
    const approved = branchSetup(
      [
        step({ id: 'review', maxAttempts: 1 }),
        step({
          id: 'ship',
          dependsOn: ['review'],
          runIf: { stepId: 'review', status: 'completed', resultIncludes: 'APPROVED' },
          maxAttempts: 1,
        }),
      ],
      { result: (id) => (id === 'review' ? 'Verdict: APPROVED' : `result:${id}`) },
    );

    await approved.engine.runTick();
    approved.complete('review', 'complete');
    await approved.engine.runTick();
    expect(approved.enqueued.map((entry) => entry.id)).toEqual(['review', 'ship']);

    const rejected = branchSetup(
      [
        step({ id: 'review', maxAttempts: 1 }),
        step({
          id: 'ship',
          dependsOn: ['review'],
          runIf: { stepId: 'review', status: 'completed', resultIncludes: 'APPROVED' },
          maxAttempts: 1,
        }),
      ],
      { result: (id) => (id === 'review' ? 'Verdict: REJECTED' : `result:${id}`) },
    );

    await rejected.engine.runTick();
    rejected.complete('review', 'complete');
    await rejected.engine.runTick();
    expect(rejected.enqueued.map((entry) => entry.id)).toEqual(['review']);
    expect(rejected.run.steps.find((entry) => entry.id === 'ship')?.reason).toContain(
      'did not produce the required result',
    );
  });

  it('requires every condition in an array to hold', async () => {
    const ctx = branchSetup(
      [
        step({ id: 'review', maxAttempts: 1 }),
        step({
          id: 'ship',
          dependsOn: ['review'],
          runIf: [
            { stepId: 'review', status: 'completed' },
            { stepId: 'review', status: 'completed', resultIncludes: 'APPROVED' },
          ],
          maxAttempts: 1,
        }),
      ],
      { result: () => 'Verdict: REJECTED' },
    );

    await ctx.engine.runTick();
    ctx.complete('review', 'complete');
    await ctx.engine.runTick();

    expect(ctx.enqueued.map((entry) => entry.id)).toEqual(['review']);
    expect(ctx.run.steps.find((entry) => entry.id === 'ship')?.status).toBe('skipped');
  });

  it('shares long branch outputs with a merge step instead of dropping them', async () => {
    const marker = (id: string) => `${id}-marker-${'x'.repeat(12_000)}`;
    const ctx = branchSetup(
      [
        step({ id: 'left', dependsOn: [], maxAttempts: 1 }),
        step({ id: 'right', dependsOn: [], maxAttempts: 1 }),
        step({ id: 'merge', dependsOn: ['left', 'right'], maxAttempts: 1 }),
      ],
      { maxParallel: 2, result: marker },
    );

    await ctx.engine.runTick();
    ctx.complete('left', 'complete');
    ctx.complete('right', 'complete');
    await ctx.engine.runTick();

    const merge = ctx.enqueued.find((entry) => entry.id === 'merge');
    expect(merge).toBeDefined();
    expect(merge?.instruction).toContain('left-marker');
    expect(merge?.instruction).toContain('right-marker');
    expect(merge?.instruction.length).toBeLessThanOrEqual(8_000 + WORKFLOW_HANDOFF_MAX_LENGTH);
  });
});

describe('createWorkflowEngine cancellation fencing', () => {
  function runWith(steps: WorkflowStepRecord[]): WorkflowRunRecord {
    return {
      id: 'run-cancel',
      userId: 'user-1',
      workflowId: 'wf-1',
      workflowName: 'Cancel',
      agentId: 'agent-1',
      status: 'queued',
      currentStep: 0,
      steps: steps.map((entry) => ({ ...entry })),
      conversationId: 'conversation-1',
      events: [],
    };
  }

  it('does not enqueue a step when the lease-fenced dispatch write loses to cancellation', async () => {
    const run = runWith([step({ id: 'first', maxAttempts: 1 })]);
    const enqueued: string[] = [];
    const engine = createWorkflowEngine(
      {
        store: {
          claimRuns: async () => [{ ...run, steps: run.steps.map((entry) => ({ ...entry })) }],
          saveRun: async () => false,
          releaseRun: async () => undefined,
        },
        enqueueStep: async ({ step: entry }) => {
          enqueued.push(entry.id);
          return 'delivery';
        },
        getGeneration: async () => null,
        workerId: 'worker-1',
      },
      { retryBaseMs: 1_000, retryCapMs: 1_000 },
    );

    await engine.runTick();
    expect(enqueued).toEqual([]);
  });

  it('aborts a turn admitted just before the run was cancelled', async () => {
    const run = runWith([step({ id: 'first', maxAttempts: 1 })]);
    let saveCalls = 0;
    let generation: WorkflowGenerationState | null = null;
    const abortGeneration = jest.fn(async () => undefined);
    const engine = createWorkflowEngine({
      store: {
        claimRuns: async () => [{ ...run, steps: run.steps.map((entry) => ({ ...entry })) }],
        saveRun: async () => {
          saveCalls += 1;
          // The intent write succeeds, then cancellation clears the lease.
          return saveCalls === 1;
        },
        releaseRun: async () => undefined,
      },
      enqueueStep: async () => {
        generation = { status: 'running', createdAt: 100 };
        return 'delivery:first:1';
      },
      getGeneration: async () => generation,
      abortGeneration,
      workerId: 'worker-1',
    });

    await engine.runTick();
    expect(abortGeneration).toHaveBeenCalledWith('conversation-1', { expectedCreatedAt: 100 });
  });

  it('re-queues a dispatch intent whose worker crashed before enqueueing', async () => {
    const startedAt = new Date('2026-05-01T00:00:00.000Z');
    const run = runWith([
      step({ id: 'first', maxAttempts: 2, status: 'running', attempts: 1, startedAt }),
    ]);
    let clock = new Date(startedAt.getTime() + 5_000);
    const enqueued: string[] = [];
    const engine = createWorkflowEngine(
      {
        store: {
          claimRuns: async () => [{ ...run, steps: run.steps.map((entry) => ({ ...entry })) }],
          saveRun: async ({ patch }) => {
            Object.assign(run, patch);
            if (patch.steps != null) {
              run.steps = patch.steps.map((entry) => ({ ...entry }));
            }
            return true;
          },
          releaseRun: async () => undefined,
        },
        enqueueStep: async ({ step: entry }) => {
          enqueued.push(entry.id);
          return 'delivery';
        },
        getGeneration: async () => null,
        now: () => new Date(clock),
        workerId: 'worker-1',
      },
      { retryBaseMs: 1_000, retryCapMs: 1_000 },
    );

    await engine.runTick();
    expect(run.steps[0].status).toBe('queued');
    expect(enqueued).toEqual([]);

    clock = new Date(clock.getTime() + 1_000);
    await engine.runTick();
    expect(enqueued).toEqual(['first']);
    expect(run.steps[0].attempts).toBe(2);
  });

  it('keeps a run active while a sibling settles when another enqueue fails', async () => {
    const run = runWith([
      step({ id: 'sibling', dependsOn: [] }),
      step({ id: 'broken', dependsOn: [], maxAttempts: 1 }),
    ]);
    run.status = 'queued';
    run.settings = { maxParallel: 2 };
    let generation: WorkflowGenerationState | null = null;
    const engine = createWorkflowEngine({
      store: {
        claimRuns: async () => [{ ...run, steps: run.steps.map((entry) => ({ ...entry })) }],
        saveRun: async ({ patch }) => {
          Object.assign(run, patch);
          if (patch.steps != null) {
            run.steps = patch.steps.map((entry) => ({ ...entry }));
          }
          return true;
        },
        releaseRun: async () => undefined,
      },
      enqueueStep: async ({ step: entry }) => {
        if (entry.id === 'broken') {
          throw new Error('cannot enqueue');
        }
        return 'delivery:sibling:1';
      },
      getGeneration: async () => generation,
      workerId: 'worker-1',
    });

    await engine.runTick();
    expect(run.status).toBe('running');
    expect(run.steps.find((entry) => entry.id === 'broken')?.status).toBe('failed');
    expect(run.steps.find((entry) => entry.id === 'sibling')?.status).toBe('running');

    generation = { status: 'complete', createdAt: Date.now() };
    await engine.runTick();
    expect(run.status).toBe('failed');
  });

  it('retries a pending completion chain until the host delivers it', async () => {
    const run = {
      ...runWith([step({ status: 'completed' })]),
      status: 'completed' as const,
      onCompleteWorkflowId: 'wf-next',
      chainPending: true,
    };
    const onRunSettled = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary delivery failure'))
      .mockResolvedValueOnce(undefined);
    const engine = createWorkflowEngine({
      store: {
        claimRuns: async () => [{ ...run, steps: run.steps.map((entry) => ({ ...entry })) }],
        saveRun: async ({ patch }) => {
          if (patch.chainPending === false) {
            run.chainPending = false;
          }
          return true;
        },
        releaseRun: async () => undefined,
      },
      enqueueStep: async () => 'unused',
      getGeneration: async () => null,
      onRunSettled,
      workerId: 'worker-1',
    });

    await engine.runTick();
    expect(run.chainPending).toBe(true);
    expect(onRunSettled).toHaveBeenCalledTimes(1);

    await engine.runTick();
    expect(run.chainPending).toBe(false);
    expect(onRunSettled).toHaveBeenCalledTimes(2);
  });

  describe('build settlement', () => {
    const buildRun = () => ({
      ...runWith([step({ status: 'completed', result: 'ran the focused tests' })]),
      status: 'queued' as const,
      settings: {
        build: {
          mode: 'autonomous' as const,
          requiredGates: ['tests' as const],
          requirePullRequest: false,
        },
      },
    });

    const settle = async (verifyRun?: () => Promise<WorkflowRunVerification>) => {
      const run = buildRun();
      const engine = createWorkflowEngine({
        store: {
          claimRuns: async () => [{ ...run, steps: run.steps.map((entry) => ({ ...entry })) }],
          saveRun: async ({ patch }) => {
            Object.assign(run, patch);
            if (patch.steps != null) {
              run.steps = patch.steps.map((entry) => ({ ...entry }));
            }
            return true;
          },
          releaseRun: async () => undefined,
        },
        enqueueStep: async () => 'unused',
        getGeneration: async () => null,
        ...(verifyRun == null ? {} : { verifyRun }),
        workerId: 'worker-1',
      });
      await engine.runTick();
      return run;
    };

    const verdict = (status: 'verified' | 'failed'): WorkflowRunVerification => ({
      status,
      mode: 'autonomous',
      outcome: status === 'verified' ? 'verified_complete' : 'complete_unverified',
      checkedAt: '2026-01-01T00:00:00.000Z',
      summary: status === 'verified' ? 'Verified complete.' : 'Required gate tests did not pass',
      gates: [],
      blockers: status === 'verified' ? [] : ['Required gate tests did not pass'],
    });

    it('fails a build run when settlement has no verifier', async () => {
      const run = await settle();

      expect(run.status).toBe('failed');
      expect(run.verification?.status).toBe('failed');
      expect(run.error).toContain('evidence');
    });

    it('retains a failed verdict and does not complete the run', async () => {
      const verifyRun = jest.fn(async () => verdict('failed'));
      const run = await settle(verifyRun);

      expect(verifyRun).toHaveBeenCalledTimes(1);
      expect(run.status).toBe('failed');
      expect(run.verification?.blockers).toEqual(['Required gate tests did not pass']);
    });

    it('completes the run with the verified verdict', async () => {
      const run = await settle(async () => verdict('verified'));

      expect(run.status).toBe('completed');
      expect(run.verification?.status).toBe('verified');
      expect(run.error).toBeNull();
    });

    it('fails a build run when the verifier throws', async () => {
      const run = await settle(async () => {
        throw new Error('runner exploded');
      });

      expect(run.status).toBe('failed');
      expect(run.verification?.status).toBe('failed');
      expect(run.error).not.toContain('runner exploded');
    });
  });
});
