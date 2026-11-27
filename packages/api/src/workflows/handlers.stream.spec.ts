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
    const getWorkflowRun = jest
      .fn()
      .mockResolvedValueOnce(run)
      .mockReturnValueOnce(pending)
      .mockResolvedValue(run);
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

const finishedRun = () => ({
  id: 'run-1',
  workflowId: 'workflow-1',
  workflowName: 'Test workflow',
  agentId: 'agent-1',
  status: 'completed' as const,
  steps: [],
  events: [
    { seq: 1, at: new Date('2026-01-01T00:00:00Z'), type: 'run.queued' as const },
    { seq: 2, at: new Date('2026-01-01T00:00:01Z'), type: 'run.started' as const },
    { seq: 3, at: new Date('2026-01-01T00:00:02Z'), type: 'run.completed' as const },
  ],
});

const createStreamResponse = () => {
  const writes: string[] = [];
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: (chunk: string) => {
      writes.push(chunk);
    },
    end: jest.fn(),
  };
  return { res, writes };
};

const frameIds = (writes: string[]): Array<string | undefined> =>
  writes
    .filter((chunk) => chunk.includes('data: '))
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('id: ')));

describe('workflow run stream replay', () => {
  const createHandlers = (run: unknown) =>
    createWorkflowHandlers({
      methods: { getWorkflowRun: jest.fn().mockResolvedValue(run) } as never,
      canRunAgent: async () => true,
      wake: () => undefined,
    });

  it('opens a fresh connection with one snapshot and no historical event frames', async () => {
    const handlers = createHandlers(finishedRun());
    const { res, writes } = createStreamResponse();

    await handlers.streamRun(
      { user: { id: 'user-1' }, params: { runId: 'run-1' }, on: jest.fn() } as never,
      res as never,
    );

    expect(writes[0]).toBe('retry: 1000\n\n');
    expect(writes).toHaveLength(2);
    expect(writes[1]).toContain('event: snapshot');
    expect(frameIds(writes)).toEqual(['id: run-1:3']);
    expect(writes[1]).not.toContain('event: run-event');
  });

  it('replays only the events a cursor has not applied, then the snapshot', async () => {
    const handlers = createHandlers(finishedRun());
    const { res, writes } = createStreamResponse();

    await handlers.streamRun(
      {
        user: { id: 'user-1' },
        params: { runId: 'run-1' },
        headers: { 'last-event-id': 'run-1:1' },
        on: jest.fn(),
      } as never,
      res as never,
    );

    expect(writes.filter((chunk) => chunk.includes('event: run-event'))).toHaveLength(2);
    expect(frameIds(writes)).toEqual(['id: run-1:2', 'id: run-1:3', 'id: run-1:3']);
    expect(writes[writes.length - 1]).toContain('event: snapshot');
  });

  it('signals missing history before the replacement snapshot advances the cursor', async () => {
    const run = finishedRun();
    run.events = run.events.slice(2);
    const { res, writes } = createStreamResponse();
    await createHandlers(run).streamRun(
      {
        user: { id: 'user-1' },
        params: { runId: 'run-1' },
        headers: { 'last-event-id': 'run-1:1' },
        on: jest.fn(),
      } as never,
      res as never,
    );
    expect(writes[1]).toContain('event: replay-gap');
    expect(writes[2]).toContain('event: snapshot');
    expect(frameIds(writes)).toEqual([undefined, 'id: run-1:3']);
  });

  it('ignores a cursor that belongs to another run', async () => {
    const handlers = createHandlers(finishedRun());
    const { res, writes } = createStreamResponse();

    await handlers.streamRun(
      {
        user: { id: 'user-1' },
        params: { runId: 'run-1' },
        headers: { 'last-event-id': 'run-2:2' },
        on: jest.fn(),
      } as never,
      res as never,
    );

    expect(frameIds(writes)).toEqual(['id: run-1:3']);
    expect(writes).toHaveLength(2);
  });

  it('replays nothing when the cursor already covers every event', async () => {
    const handlers = createHandlers(finishedRun());
    const { res, writes } = createStreamResponse();

    await handlers.streamRun(
      {
        user: { id: 'user-1' },
        params: { runId: 'run-1' },
        headers: { 'last-event-id': 'run-1:3' },
        on: jest.fn(),
      } as never,
      res as never,
    );

    expect(writes.filter((chunk) => chunk.includes('event: run-event'))).toHaveLength(0);
    expect(frameIds(writes)).toEqual(['id: run-1:3']);
  });
});

describe('workflow run index', () => {
  it('lists owner-wide runs and offers a cursor only on a full page', async () => {
    const listWorkflowRuns = jest.fn().mockResolvedValue([
      { ...finishedRun(), createdAt: new Date('2026-01-01T00:00:02Z') },
      { ...finishedRun(), id: 'run-2', createdAt: new Date('2026-01-01T00:00:01Z') },
    ]);
    const handlers = createWorkflowHandlers({
      methods: { listWorkflowRuns } as never,
      canRunAgent: async () => true,
      wake: () => undefined,
    });
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };

    await handlers.listAllRuns(
      { user: { id: 'user-1' }, query: { limit: '2', status: 'completed' } } as never,
      res as never,
    );

    expect(listWorkflowRuns).toHaveBeenCalledWith('user-1', undefined, {
      status: ['completed'],
      limit: 2,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ nextBefore: '2026-01-01T00:00:01.000Z' }),
    );
  });

  it('rejects an unknown status instead of returning a misleading empty page', async () => {
    const handlers = createWorkflowHandlers({
      methods: { listWorkflowRuns: jest.fn() } as never,
      canRunAgent: async () => true,
      wake: () => undefined,
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await handlers.listAllRuns(
      { user: { id: 'user-1' }, query: { status: 'done' } } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
