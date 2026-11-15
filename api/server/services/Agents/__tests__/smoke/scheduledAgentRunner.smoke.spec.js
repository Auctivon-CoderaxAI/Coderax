const mockDeps = {};
const mockOrder = [];
const mockService = {
  initialize: jest.fn(async () => mockOrder.push('service.initialize')),
  stop: jest.fn(async () => mockOrder.push('service.stop')),
  dispatch: jest.fn(),
  enqueue: jest.fn(),
  retire: jest.fn(),
  getDelivery: jest.fn(),
  purgeUser: jest.fn(async () => undefined),
  getCompletionWaitMaxIntervalMs: jest.fn(() => 1234),
  getBackgroundCompletionResultBatchSize: jest.fn(() => 7),
};
const mockQueuedTurn = {
  initialize: jest.fn(async () => mockOrder.push('queuedTurn.initialize')),
  stop: jest.fn(async () => mockOrder.push('queuedTurn.stop')),
  settleBeforeDeadLetter: jest.fn(),
  prepareContinue: jest.fn(),
  schedule: jest.fn(),
  cancel: jest.fn(),
};

jest.mock(
  '@coderax/api',
  () => {
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
      createSubagentCompletionWakeupResolver: capture('createSubagentCompletionWakeupResolver', 'subagent-adapter'),
      SUBAGENT_COMPLETION_SOURCE: 'subagent-source',
      createBackgroundToolCompletionWakeupResolver: capture(
        'createBackgroundToolCompletionWakeupResolver',
        'background-adapter',
      ),
      createBackgroundToolDeadClaimRecovery: capture('createBackgroundToolDeadClaimRecovery', 'dead-claim-recovery'),
      BACKGROUND_TOOL_COMPLETION_SOURCE: 'background-source',
      createAgentQueuedTurnLifecycle: capture('createAgentQueuedTurnLifecycle', mockQueuedTurn),
      AGENT_QUEUED_TURN_SOURCE: 'queued-turn-source',
      GenerationJobManager: {
        getJob: jest.fn((conversationId) => ({ conversationId })),
        getGenerationAdmissionEvidence: jest.fn(() => ({ admitted: true })),
      },
      isWorkflowStepActive: jest.fn(() => true),
    };
  },
  { virtual: true },
);

jest.mock('~/models', () => ({
  getScheduleMCPCompletionState: jest.fn(),
  releaseBackgroundToolResultClaims: jest.fn(),
  releaseAgentBackgroundToolResultClaims: jest.fn(),
  isAgentTriggerPrincipalActive: jest.fn(),
  getWorkflowRun: jest.fn(),
}));

const { GenerationJobManager } = require('@coderax/api');
const methods = require('~/models');
const triggers = require('../../triggers');

describe('scheduled agent runner wiring (triggers.js)', () => {
  beforeEach(() => {
    mockOrder.length = 0;
  });

  it('passes options to the trigger service and maps idle polling to the queued-turn lifecycle', async () => {
    const options = { idlePolling: { queuedTurnMaxIntervalMs: 2500 } };

    await triggers.initializeAgentTriggerService(options);

    expect(mockService.initialize).toHaveBeenCalledWith(options);
    expect(mockQueuedTurn.initialize).toHaveBeenCalledWith({ maxIdleIntervalMs: 2500 });
    expect(mockOrder).toEqual(['service.initialize', 'queuedTurn.initialize']);
  });

  it('initializes without idle polling options', async () => {
    await triggers.initializeAgentTriggerService(undefined);

    expect(mockQueuedTurn.initialize).toHaveBeenLastCalledWith({ maxIdleIntervalMs: undefined });
  });

  it('stops the queued-turn lifecycle before the trigger service', async () => {
    await triggers.stopAgentTriggerService();

    expect(mockOrder).toEqual(['queuedTurn.stop', 'service.stop']);
  });

  it('forwards admission evidence arguments to GenerationJobManager in order', () => {
    const [deps] = mockDeps.createBackgroundToolCompletionWakeupResolver;

    const evidence = deps.getGenerationAdmissionEvidence('user-1', 'request-1', 'stream-1', 'convo-1');

    expect(GenerationJobManager.getGenerationAdmissionEvidence).toHaveBeenCalledWith(
      'user-1',
      'request-1',
      'stream-1',
      'convo-1',
    );
    expect(evidence).toEqual({ admitted: true });
  });

  it('builds the background completion adapter from the shared models module', () => {
    const [deps] = mockDeps.createBackgroundToolCompletionWakeupResolver;

    expect(deps.methods).toBe(methods);
    expect(deps.getScheduleMCPCompletionState).toBe(methods.getScheduleMCPCompletionState);
    expect(deps.recoverDeadClaim).toBe('dead-claim-recovery');
    expect(deps.getResultBatchSize()).toBe(7);
    expect(deps.getGenerationJob('convo-9')).toEqual({ conversationId: 'convo-9' });
  });

  it('exposes the trigger service operations under their public names', () => {
    expect(triggers.dispatchAgentTrigger).toBe(mockService.dispatch);
    expect(triggers.enqueueAgentTrigger).toBe(mockService.enqueue);
    expect(triggers.retireAgentTrigger).toBe(mockService.retire);
    expect(triggers.scheduleAgentQueuedTurn).toBe(mockQueuedTurn.schedule);
    expect(triggers.cancelAgentQueuedTurn).toBe(mockQueuedTurn.cancel);
  });
});