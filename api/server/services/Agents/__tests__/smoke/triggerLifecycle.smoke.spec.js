const mockDeps = {};
const mockService = {
  purgeUser: jest.fn(async () => undefined),
  enqueue: jest.fn(async () => 'enqueued'),
  retire: jest.fn(async () => 'retired'),
  getDelivery: jest.fn(async () => 'delivery'),
  getCompletionWaitMaxIntervalMs: jest.fn(() => 1234),
  getBackgroundCompletionResultBatchSize: jest.fn(() => 7),
};
const mockQueuedTurn = {
  settleBeforeDeadLetter: jest.fn(),
  prepareContinue: jest.fn(),
};

jest.mock('@coderax/api', () => {
  const capture = (name, value) =>
    jest.fn((...args) => {
      mockDeps[name] = args;
      return value;
    });
  return {
    createAgentTriggerService: capture('createAgentTriggerService', mockService),
    createCheckpointDeletionReclaimer: capture('createCheckpointDeletionReclaimer', 'reclaimer'),
    createAgentContinuationResolver: capture('createAgentContinuationResolver', 'continuation'),
    createAgentEventContinueResolver: capture('createAgentEventContinueResolver', 'event-actor'),
    createSubagentCompletionWakeupResolver: capture(
      'createSubagentCompletionWakeupResolver',
      'subagent-adapter',
    ),
    SUBAGENT_COMPLETION_SOURCE: 'subagent-source',
    createBackgroundToolCompletionWakeupResolver: capture(
      'createBackgroundToolCompletionWakeupResolver',
      'background-adapter',
    ),
    createBackgroundToolDeadClaimRecovery: capture(
      'createBackgroundToolDeadClaimRecovery',
      'dead-claim-recovery',
    ),
    BACKGROUND_TOOL_COMPLETION_SOURCE: 'background-source',
    createAgentQueuedTurnLifecycle: capture('createAgentQueuedTurnLifecycle', mockQueuedTurn),
    AGENT_QUEUED_TURN_SOURCE: 'queued-turn-source',
    GenerationJobManager: {
      getJob: jest.fn((conversationId) => ({ conversationId })),
      getGenerationAdmissionEvidence: jest.fn(),
      getAccountCleanupJobIdsForUser: jest.fn(() => ['job-a']),
      onGenerationSettled: jest.fn(() => 'unsubscribe'),
      supportsDetachedAgentEventActions: true,
    },
    isWorkflowStepActive: jest.fn((run, input) => run.activeStepId === input.stepId),
  };
});

jest.mock('~/models', () => ({
  getScheduleMCPCompletionState: jest.fn(),
  releaseBackgroundToolResultClaims: jest.fn(),
  releaseAgentBackgroundToolResultClaims: jest.fn(),
  isAgentTriggerPrincipalActive: jest.fn(),
  getWorkflowRun: jest.fn(async (runId, userId) => ({ runId, userId, activeStepId: 'step-2' })),
}));

const { GenerationJobManager } = require('@coderax/api');
const methods = require('~/models');
const triggers = require('../../triggers');

describe('trigger lifecycle wiring (triggers.js)', () => {
  it('routes the completion wait interval through the live trigger service', () => {
    const [subagentDeps] = mockDeps.createSubagentCompletionWakeupResolver;
    const [backgroundDeps] = mockDeps.createBackgroundToolCompletionWakeupResolver;

    expect(subagentDeps.getWaitMaxIntervalMs()).toBe(1234);
    expect(backgroundDeps.getWaitMaxIntervalMs()).toBe(1234);
    expect(mockService.getCompletionWaitMaxIntervalMs).toHaveBeenCalledTimes(2);
  });

  it('registers every internal continuation source with its adapter', () => {
    const [resolverDeps] = mockDeps.createAgentContinuationResolver;

    expect(resolverDeps.eventActor).toBe('event-actor');
    expect([...resolverDeps.internalSources.entries()]).toEqual([
      ['subagent-source', 'subagent-adapter'],
      ['background-source', 'background-adapter'],
      ['queued-turn-source', mockQueuedTurn.prepareContinue],
    ]);
  });

  it('ignores agent events until a workflow handler is registered, then routes them to it', () => {
    const [serviceDeps] = mockDeps.createAgentTriggerService;
    const event = { type: 'agent.completed', id: 'event-1' };
    const handler = jest.fn(() => 'workflow-run');

    expect(serviceDeps.onAgentEvent(event)).toBeUndefined();
    triggers.setWorkflowEventHandler(handler);

    expect(serviceDeps.onAgentEvent(event)).toBe('workflow-run');
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('checks workflow step activity against the run loaded for the input run and user', async () => {
    const [serviceDeps] = mockDeps.createAgentTriggerService;

    await expect(
      serviceDeps.isWorkflowStepActive({ runId: 'run-1', userId: 'user-1', stepId: 'step-2' }),
    ).resolves.toBe(true);
    await expect(
      serviceDeps.isWorkflowStepActive({ runId: 'run-1', userId: 'user-1', stepId: 'step-9' }),
    ).resolves.toBe(false);
    expect(methods.getWorkflowRun).toHaveBeenCalledWith('run-1', 'user-1');
  });

  it('queued-turn lifecycle delegates delivery operations to the trigger service', async () => {
    const [lifecycleDeps] = mockDeps.createAgentQueuedTurnLifecycle;

    await expect(lifecycleDeps.enqueue('a', 'b')).resolves.toBe('enqueued');
    await expect(lifecycleDeps.retireDelivery('c')).resolves.toBe('retired');
    await expect(lifecycleDeps.getDelivery('d')).resolves.toBe('delivery');
    expect(mockService.enqueue).toHaveBeenCalledWith('a', 'b');
    expect(mockService.retire).toHaveBeenCalledWith('c');
    expect(mockService.getDelivery).toHaveBeenCalledWith('d');
  });

  it('exposes detached-action support and generation settlement from GenerationJobManager', () => {
    const [serviceDeps] = mockDeps.createAgentTriggerService;
    const listener = jest.fn();

    expect(serviceDeps.supportsDetachedActionCompletion()).toBe(true);
    expect(serviceDeps.subscribeGenerationSettled(listener)).toBe('unsubscribe');
    expect(GenerationJobManager.onGenerationSettled).toHaveBeenCalledWith(listener);
    expect(serviceDeps.settleSourceBeforeDeadLetter).toBe(mockQueuedTurn.settleBeforeDeadLetter);
    expect(serviceDeps.isPrincipalActive).toBe(methods.isAgentTriggerPrincipalActive);
  });

  it('purges a user through the trigger service', async () => {
    await triggers.purgeAgentTriggerDeliveriesForUser('user-7');

    expect(mockService.purgeUser).toHaveBeenCalledWith('user-7');
  });
});
