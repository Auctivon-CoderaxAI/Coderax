import type { AgentFireTriggerEnvelope } from '../agents/triggers/envelope';
import type { WorkflowRunRecord, WorkflowStepRecord } from './types';
import { createWorkflowStepEnqueuer } from './store';

const step = (overrides: Partial<WorkflowStepRecord> = {}): WorkflowStepRecord => ({
  id: 'implement',
  title: 'Implement',
  instruction: 'Implement it',
  approvalRequired: false,
  maxAttempts: 1,
  status: 'running',
  attempts: 1,
  conversationId: 'conversation-1',
  ...overrides,
});

const run = (overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord => ({
  id: 'run-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  workflowId: 'workflow-1',
  workflowName: 'Build',
  agentId: 'agent-1',
  status: 'running',
  currentStep: 0,
  steps: [step()],
  conversationId: 'conversation-1',
  events: [],
  ...overrides,
});

const buildRun = () =>
  run({
    settings: {
      build: {
        mode: 'autonomous',
        requiredGates: ['tests', 'review'],
        repository: { owner: 'Auctivon-CoderaxAI', name: 'Coderax' },
        workspace: 'checkout-1',
      },
    },
  });

describe('createWorkflowStepEnqueuer', () => {
  it('binds a build step to the run checkout on the configured machine', async () => {
    const enqueueTrigger = jest.fn(async (_envelope: unknown) => ({ deliveryKey: 'delivery-1' }));
    const enqueueStep = createWorkflowStepEnqueuer({
      enqueueTrigger,
      buildWorkspaceEnvironmentId: 'build-machine',
    });

    await enqueueStep({ run: buildRun(), step: step(), stepIndex: 0 });

    const envelope = enqueueTrigger.mock.calls[0][0] as AgentFireTriggerEnvelope;
    expect(envelope.mode).toBe('fire');
    expect(envelope.run).toMatchObject({
      conversationId: 'conversation-1',
      codeWorkspaces: [
        { environmentId: 'build-machine', workspaceId: 'checkout-1', checkout: 'source' },
      ],
      metadata: { workflowRunId: 'run-1', workflowStepId: 'implement' },
    });
  });

  it('leaves an ordinary workflow step unbound', async () => {
    const enqueueTrigger = jest.fn(async (_envelope: unknown) => ({ deliveryKey: 'delivery-1' }));
    const enqueueStep = createWorkflowStepEnqueuer({
      enqueueTrigger,
      buildWorkspaceEnvironmentId: 'build-machine',
    });

    await enqueueStep({ run: run(), step: step(), stepIndex: 0 });

    const envelope = enqueueTrigger.mock.calls[0][0] as AgentFireTriggerEnvelope;
    expect(envelope.run?.codeWorkspaces).toBeUndefined();
  });

  it('does not invent a checkout binding without a configured machine', async () => {
    const enqueueTrigger = jest.fn(async (_envelope: unknown) => ({ deliveryKey: 'delivery-1' }));
    const enqueueStep = createWorkflowStepEnqueuer({ enqueueTrigger });

    await enqueueStep({ run: buildRun(), step: step(), stepIndex: 0 });

    const envelope = enqueueTrigger.mock.calls[0][0] as AgentFireTriggerEnvelope;
    expect(envelope.run?.codeWorkspaces).toBeUndefined();
  });
});
