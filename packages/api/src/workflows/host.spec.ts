import type { WorkflowRunRecord } from './types';
import {
  WorkflowStepInactiveError,
  assertWorkflowStepDeliveryActive,
  parseWorkflowStepDelivery,
} from './host';

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
