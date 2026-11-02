import type {
  WorkflowAgentEvent,
  WorkflowEventStarterDeps,
  WorkflowEventSubscription,
} from './events';
import { createWorkflowEventStarter, isWorkflowTriggerableEvent } from './events';

const event = (overrides: Partial<WorkflowAgentEvent> = {}): WorkflowAgentEvent => ({
  userId: 'user-1',
  tenantId: 'tenant-1',
  eventId: 'event-1',
  eventType: 'deploy.failed',
  sourceId: 'source-1',
  sourceType: 'webhook',
  ...overrides,
});

const subscription = (overrides: Partial<WorkflowEventSubscription> = {}) =>
  ({
    id: 'workflow-1',
    eventTriggers: [{ eventType: 'deploy.failed', sourceId: 'source-1' }],
    ...overrides,
  }) as WorkflowEventSubscription;

function setup(subscriptions: WorkflowEventSubscription[], run: unknown | null = { id: 'run-1' }) {
  const listWorkflowsForEvent = jest.fn(
    async (_input: Parameters<WorkflowEventStarterDeps['listWorkflowsForEvent']>[0]) =>
      subscriptions,
  );
  const createWorkflowEventRun = jest.fn(
    async (_input: Parameters<WorkflowEventStarterDeps['createWorkflowEventRun']>[0]) => run,
  );
  const wake = jest.fn();
  const starter = createWorkflowEventStarter({
    listWorkflowsForEvent,
    createWorkflowEventRun,
    wake,
    now: () => new Date('2026-04-01T00:00:00.000Z'),
  });
  return { starter, listWorkflowsForEvent, createWorkflowEventRun, wake };
}

describe('createWorkflowEventStarter', () => {
  it('starts a run for an authorized matching subscription and wakes the runner', async () => {
    const ctx = setup([subscription()]);

    await expect(ctx.starter(event({ payload: { service: 'api' } }))).resolves.toBe(1);

    expect(ctx.listWorkflowsForEvent).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-1',
      eventType: 'deploy.failed',
      sourceId: 'source-1',
    });
    expect(ctx.createWorkflowEventRun).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
        workflowId: 'workflow-1',
        eventId: 'event-1',
        eventType: 'deploy.failed',
        sourceId: 'source-1',
        now: new Date('2026-04-01T00:00:00.000Z'),
      }),
    );
    const input = ctx.createWorkflowEventRun.mock.calls[0][0].input as string;
    expect(input).toContain('Event type: deploy.failed');
    expect(input).toContain('Source: source-1');
    expect(input).toContain('"service":"api"');
    expect(ctx.wake).toHaveBeenCalledTimes(1);
  });

  it('does not fan out internal, workflow, or workflow-step events', async () => {
    const ctx = setup([subscription()]);

    await expect(
      ctx.starter(event({ eventType: 'workflow.step', sourceType: 'workflow' })),
    ).resolves.toBe(0);
    await expect(ctx.starter(event({ sourceType: 'internal' }))).resolves.toBe(0);
    await expect(ctx.starter(event({ sourceType: 'workflow' }))).resolves.toBe(0);

    expect(ctx.listWorkflowsForEvent).not.toHaveBeenCalled();
    expect(ctx.wake).not.toHaveBeenCalled();
  });

  it('is idempotent: a replayed occurrence that already has a run does not wake twice', async () => {
    const ctx = setup([subscription()], null);

    await expect(ctx.starter(event())).resolves.toBe(0);
    expect(ctx.createWorkflowEventRun).toHaveBeenCalledTimes(1);
    expect(ctx.wake).not.toHaveBeenCalled();
  });

  it('skips a source-restricted subscription for a different source', async () => {
    const ctx = setup([subscription()]);

    await expect(ctx.starter(event({ sourceId: 'source-2' }))).resolves.toBe(0);
    expect(ctx.createWorkflowEventRun).not.toHaveBeenCalled();
  });

  it('bounds a large event payload', async () => {
    const ctx = setup([subscription()]);
    await ctx.starter(event({ payload: { service: 'api', log: 'x'.repeat(10_000) } }));

    const input = ctx.createWorkflowEventRun.mock.calls[0][0].input as string;
    expect(input).toContain('"service":"api"');
    expect(input.length).toBeLessThanOrEqual(8_000);
  });
});

describe('isWorkflowTriggerableEvent', () => {
  it('requires an identity and an external source type', () => {
    expect(isWorkflowTriggerableEvent(event())).toBe(true);
    expect(isWorkflowTriggerableEvent(event({ eventId: '' }))).toBe(false);
    expect(isWorkflowTriggerableEvent(event({ sourceId: '' }))).toBe(false);
    expect(isWorkflowTriggerableEvent(event({ eventType: 'workflow.step' }))).toBe(false);
  });
});
