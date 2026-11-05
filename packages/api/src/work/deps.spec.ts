import { createRequire } from 'node:module';
import type { WorkDepsJobs, WorkDepsProjections, WorkDepsStore } from './deps';
import { workStateForJobStatus } from './state';
import { createWorkDepsFactory } from './deps';

const workModels = createRequire(__filename)(
  '../../../../api/server/routes/workModels.js',
) as WorkDepsProjections;

const WORK_ROW = {
  conversationId: 'c-1',
  title: 'Plan',
  isWork: true,
  workModel: 'llama3:latest',
  workState: 'completed',
};
const CHAT_ROW = { conversationId: 'c-2', title: 'Chat', isWork: false };

const projections: WorkDepsProjections = workModels;

function makeDeps(
  overrides: {
    db?: Partial<WorkDepsStore>;
    jobs?: Partial<WorkDepsJobs>;
  } = {},
) {
  const calls = { cursor: [] as unknown[], abort: [] as unknown[], warns: [] as string[] };
  const abortJob = overrides.jobs?.abortJob;
  const db: WorkDepsStore = {
    getConvosByCursor: async (userId, options) => {
      calls.cursor.push({ userId, options });
      return { conversations: [WORK_ROW, CHAT_ROW], nextCursor: null };
    },
    getConvo: async () => WORK_ROW,
    ...overrides.db,
  };
  const jobs: WorkDepsJobs = {
    getJob: async () => ({ metadata: { userId: 'user-1', tenantId: 'tenant-a' }, createdAt: 42 }),
    getJobStatus: async () => 'complete',
    ...overrides.jobs,
    abortJob: async (conversationId, options) => {
      calls.abort.push([conversationId, options]);
      return abortJob ? abortJob(conversationId, options) : { success: true };
    },
  };
  const factory = createWorkDepsFactory({
    db,
    jobs,
    loadModels: async () => ({ ollama: [{ model: 'llama3:latest', name: 'Llama 3' }] }),
    workStateForJobStatus,
    logger: { warn: (message) => calls.warns.push(message) },
    projections,
  });

  return { depsFor: factory, calls };
}

describe('createWorkDepsFactory', () => {
  it('flattens the native catalog through the real Work projections', async () => {
    const { depsFor } = makeDeps();

    await expect(depsFor({ user: { id: 'user-1' } }).listModels()).resolves.toEqual([
      { id: 'llama3:latest', label: 'Llama 3', provider: 'ollama', local: true },
    ]);
  });

  it('passes deployment Work graph limits into the request-scoped router deps', () => {
    const { depsFor } = makeDeps();
    const deps = depsFor({
      user: { id: 'user-1' },
      config: { config: { work: { agentGraphLimit: 128, agentGraphConcurrency: 4 } } },
    });

    expect(deps.agentGraphLimit).toBe(128);
    expect(deps.agentGraphConcurrency).toBe(4);
    const withoutYamlWork = depsFor({ user: { id: 'user-1' }, config: { config: {} } });
    expect(withoutYamlWork.agentGraphLimit).toBeUndefined();
    expect(withoutYamlWork.agentGraphConcurrency).toBeUndefined();
  });

  it('reads history newest-first for this owner and keeps only Work conversations', async () => {
    const { depsFor, calls } = makeDeps();
    const rows = await depsFor({ user: { id: 'user-1' } }).listConversations({
      userId: 'user-1',
      limit: 50,
    });

    expect(calls.cursor).toEqual([
      {
        userId: 'user-1',
        options: {
          limit: 50,
          isArchived: false,
          isWork: true,
          tenantId: null,
          sortBy: 'updatedAt',
          sortDirection: 'desc',
        },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { conversationId: string }).conversationId).toBe('c-1');
  });

  it('projects raw cursor rows before filtering Work history', async () => {
    const rawRows = [WORK_ROW, null, CHAT_ROW];
    const { depsFor } = makeDeps({
      db: { getConvosByCursor: async () => ({ conversations: rawRows, nextCursor: null }) },
    });

    expect(projections.rowsFromCursor({ conversations: rawRows })).toEqual(rawRows);
    await expect(
      depsFor({ user: { id: 'user-1' } }).listConversations({
        userId: 'user-1',
        limit: 3,
      }),
    ).resolves.toEqual([expect.objectContaining({ conversationId: 'c-1', isWork: true })]);
  });

  it('reads one conversation through the owner-scoped store', async () => {
    let read: unknown;
    const { depsFor } = makeDeps({
      db: {
        getConvo: async (userId, conversationId) => {
          read = { userId, conversationId };
          return WORK_ROW;
        },
      },
    });

    const conversation = await depsFor({ user: { id: 'user-1' } }).getConversation({
      userId: 'user-1',
      conversationId: 'c-1',
    });

    expect(read).toEqual({ userId: 'user-1', conversationId: 'c-1' });
    expect(conversation).toMatchObject({ isWork: true, workModel: 'llama3:latest' });
  });

  it('scopes Work history to the authenticated tenant, including tenantless requests', async () => {
    const getConvosByCursor = jest.fn(async () => ({
      conversations: [WORK_ROW],
      nextCursor: null,
    }));
    const { depsFor } = makeDeps({ db: { getConvosByCursor } });
    await depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } }).listConversations({
      userId: 'user-1',
      limit: 50,
    });
    await depsFor({ user: { id: 'user-1' } }).listConversations({
      userId: 'user-1',
      limit: 50,
    });
    expect(getConvosByCursor).toHaveBeenNthCalledWith(
      1, 'user-1', expect.objectContaining({ isWork: true, tenantId: 'tenant-a' }),
    );
    expect(getConvosByCursor).toHaveBeenNthCalledWith(
      2, 'user-1', expect.objectContaining({ isWork: true, tenantId: null }),
    );
  });

  it('denies tenant-scoped Work task reads to tenantless and foreign-tenant requests', async () => {
    const { depsFor } = makeDeps({
      db: { getConvo: async () => ({ ...WORK_ROW, tenantId: 'tenant-a' }) },
    });
    const input = { userId: 'user-1', conversationId: 'c-1' };
    await expect(depsFor({ user: { id: 'user-1' } }).getConversation(input)).resolves.toBeNull();
    await expect(
      depsFor({ user: { id: 'user-1', tenantId: 'tenant-b' } }).getConversation(input),
    ).resolves.toBeNull();
    await expect(
      depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } }).getConversation(input),
    ).resolves.toMatchObject({ conversationId: 'c-1', isWork: true });
  });

  it('does not expose a legacy tenantless Work task in a scoped tenant', async () => {
    const { depsFor } = makeDeps({
      db: { getConvo: async () => WORK_ROW },
    });
    const input = { userId: 'user-1', conversationId: 'c-1' };

    await expect(
      depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } }).getConversation(input),
    ).resolves.toBeNull();
    await expect(
      depsFor({ user: { id: 'user-1' } }).getConversation(input),
    ).resolves.toMatchObject({ conversationId: 'c-1', isWork: true });
  });

  it('takes run state from the native job status', async () => {
    const { depsFor } = makeDeps({ jobs: { getJobStatus: async () => 'complete' } });

    const getRunState = depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } }).getRunState;
    if (!getRunState) {
      throw new Error('getRunState missing');
    }
    await expect(getRunState({ userId: 'user-1', conversationId: 'c-1' })).resolves.toBe(
      'completed',
    );
  });

  it('never reads live state from a missing, foreign or tenant-unscoped job', async () => {
    for (const job of [
      null,
      { metadata: { userId: 'user-2', tenantId: 'tenant-a' } },
      { metadata: { userId: 'user-1', tenantId: 'tenant-b' } },
      { metadata: { userId: 'user-1' } },
      { metadata: { tenantId: 'tenant-a' } },
      { createdAt: 7 },
    ]) {
      const getJobStatus = jest.fn(async () => 'complete');
      const { depsFor } = makeDeps({
        jobs: { getJob: async () => job, getJobStatus },
      });
      const getRunState = depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } }).getRunState;
      if (!getRunState) {
        throw new Error('getRunState missing');
      }
      await expect(
        getRunState({ userId: 'user-1', conversationId: 'c-1' }),
      ).resolves.toBeNull();
      expect(getJobStatus).not.toHaveBeenCalled();
    }
  });

  it('reads live state only for the matching owner and tenant', async () => {
    const getJobStatus = jest.fn(async () => 'complete');
    const { depsFor } = makeDeps({ jobs: { getJobStatus } });
    const getRunState = depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } }).getRunState;
    if (!getRunState) {
      throw new Error('getRunState missing');
    }
    await expect(
      getRunState({ userId: 'user-1', conversationId: 'c-1' }),
    ).resolves.toBe('completed');
    expect(getJobStatus).toHaveBeenCalledTimes(1);
  });

  it('denies a tenantless request access to a tenant-scoped live job', async () => {
    const getJobStatus = jest.fn(async () => 'complete');
    const { depsFor } = makeDeps({ jobs: { getJobStatus } });
    const getRunState = depsFor({ user: { id: 'user-1' } }).getRunState;
    if (!getRunState) {
      throw new Error('getRunState missing');
    }

    await expect(
      getRunState({ userId: 'user-1', conversationId: 'c-1' }),
    ).resolves.toBeNull();
    expect(getJobStatus).not.toHaveBeenCalled();
  });

  it('allows a tenantless request to read its own tenantless live job', async () => {
    const getJobStatus = jest.fn(async () => 'complete');
    const { depsFor } = makeDeps({
      jobs: {
        getJob: async () => ({ metadata: { userId: 'user-1' }, createdAt: 42 }),
        getJobStatus,
      },
    });
    const getRunState = depsFor({ user: { id: 'user-1' } }).getRunState;
    if (!getRunState) {
      throw new Error('getRunState missing');
    }

    await expect(
      getRunState({ userId: 'user-1', conversationId: 'c-1' }),
    ).resolves.toBe('completed');
    expect(getJobStatus).toHaveBeenCalledTimes(1);
  });

  it('normalizes null and absent job tenants for tenantless status and cancellation only', async () => {
    for (const jobTenant of [null, undefined]) {
      const getJobStatus = jest.fn(async () => 'complete');
      const { depsFor, calls } = makeDeps({
        jobs: {
          getJob: async () => ({
            metadata: { userId: 'user-1', tenantId: jobTenant },
            createdAt: 42,
          }),
          getJobStatus,
        },
      });
      const input = { userId: 'user-1', conversationId: 'c-1' };
      const tenantless = depsFor({ user: { id: 'user-1' } });
      await expect(tenantless.getRunState?.(input)).resolves.toBe('completed');
      await expect(tenantless.cancelRun(input)).resolves.toBe(true);
      expect(getJobStatus).toHaveBeenCalledTimes(1);
      expect(calls.abort).toEqual([['c-1', { expectedCreatedAt: 42 }]]);

      const scoped = depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } });
      await expect(scoped.getRunState?.(input)).resolves.toBeNull();
      await expect(scoped.cancelRun(input)).resolves.toBe(false);
      expect(getJobStatus).toHaveBeenCalledTimes(1);
      expect(calls.abort).toHaveLength(1);
    }
  });

  it('refuses another user or tenant before aborting', async () => {
    for (const [job, req] of [
      [
        { metadata: { userId: 'user-2', tenantId: 'tenant-a' }, createdAt: 7 },
        { user: { id: 'user-1', tenantId: 'tenant-a' } },
      ],
      [
        { metadata: { userId: 'user-1', tenantId: 'tenant-b' }, createdAt: 7 },
        { user: { id: 'user-1', tenantId: 'tenant-a' } },
      ],
      [
        { metadata: { userId: 'user-1', tenantId: 'tenant-b' }, createdAt: 7 },
        { user: { id: 'user-1' }, tenantId: 'tenant-a' },
      ],
      [{ metadata: { userId: 'user-1' }, createdAt: 7 }, { user: { id: 'user-1', tenantId: 'tenant-a' } }],
      [{ metadata: { userId: 'user-1', tenantId: 'tenant-a' }, createdAt: 7 }, { user: { id: 'user-1' } }],
    ] as const) {
      const { depsFor, calls } = makeDeps({ jobs: { getJob: async () => job } });
      const cancelled = await depsFor(req).cancelRun({
        userId: 'user-1',
        conversationId: 'c-1',
      });

      expect(cancelled).toBe(false);
      expect(calls.abort).toHaveLength(0);
      expect(calls.warns).toHaveLength(1);
    }
  });

  it('passes the job creation time to the owner’s abort and reports its result', async () => {
    const { depsFor, calls } = makeDeps();
    const cancelled = await depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } }).cancelRun({
      userId: 'user-1',
      conversationId: 'c-1',
    });

    expect(cancelled).toBe(true);
    expect(calls.abort).toEqual([['c-1', { expectedCreatedAt: 42 }]]);
    expect(calls.warns).toHaveLength(0);
  });

  it('allows an owner to cancel a job when both tenant scopes are absent', async () => {
    const { depsFor, calls } = makeDeps({
      jobs: { getJob: async () => ({ metadata: { userId: 'user-1' }, createdAt: 42 }) },
    });
    const cancelled = await depsFor({ user: { id: 'user-1' } }).cancelRun({
      userId: 'user-1',
      conversationId: 'c-1',
    });

    expect(cancelled).toBe(true);
    expect(calls.abort).toEqual([['c-1', { expectedCreatedAt: 42 }]]);
    expect(calls.warns).toHaveLength(0);
  });

  it('reports a missing job and a lost abort as not cancelled', async () => {
    const missing = makeDeps({ jobs: { getJob: async () => null } });
    const lost = makeDeps({ jobs: { abortJob: async () => ({ success: false }) } });

    await expect(
      missing.depsFor({ user: { id: 'user-1' } }).cancelRun({
        userId: 'user-1',
        conversationId: 'c-1',
      }),
    ).resolves.toBe(false);
    await expect(
      lost.depsFor({ user: { id: 'user-1', tenantId: 'tenant-a' } }).cancelRun({
        userId: 'user-1',
        conversationId: 'c-1',
      }),
    ).resolves.toBe(false);
    expect(missing.calls.abort).toHaveLength(0);
    expect(lost.calls.abort).toEqual([['c-1', { expectedCreatedAt: 42 }]]);
  });

  it('rejects a factory without projections', () => {
    expect(() =>
      createWorkDepsFactory({
        db: {} as WorkDepsStore,
        jobs: {} as WorkDepsJobs,
        loadModels: async () => ({}),
        workStateForJobStatus: () => null,
        projections: undefined as never,
      }),
    ).toThrow(/requires db, jobs, loadModels/);
  });
});
