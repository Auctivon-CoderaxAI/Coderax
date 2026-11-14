import { createWorkflowHandlers } from './handlers';

describe('workflow run SSE polling', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not overlap slow Mongo reads and resumes polling after the read settles', async () => {
    jest.useFakeTimers();
    const run = {
      id: 'run-1',
      workflowId: 'workflow-1',
      workflowName: 'Test workflow',
      agentId: 'agent-1',
      status: 'running' as const,
      steps: [],
    };
    let releaseRead: ((value: typeof run) => void) | undefined;
    const pending = new Promise<typeof run>((resolve) => {
      releaseRead = resolve;
    });
    const getWorkflowRun = jest.fn().mockResolvedValueOnce(run).mockReturnValueOnce(pending).mockResolvedValue(run);
    const handlers = createWorkflowHandlers({
      methods: { getWorkflowRun } as never,
      canRunAgent: async () => true,
      wake: () => undefined,
      streamPollMs: 250,
    });
    const on = jest.fn();
    const req = { user: { id: 'user-1' }, params: { runId: 'run-1' }, on };
    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };

    await handlers.streamRun(req as never, res as never);
    expect(getWorkflowRun).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(250);
    expect(getWorkflowRun).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(750);
    expect(getWorkflowRun).toHaveBeenCalledTimes(2);

    releaseRead?.(run);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(250);
    expect(getWorkflowRun).toHaveBeenCalledTimes(3);

    const close = on.mock.calls.find(([event]) => event === 'close')?.[1];
    expect(close).toBeDefined();
    close?.();
    jest.advanceTimersByTime(1_000);
    expect(getWorkflowRun).toHaveBeenCalledTimes(3);
  });
});
