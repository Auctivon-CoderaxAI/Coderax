import type { WorkAgentPage, WorkAgentPageInput } from './agents';
import { createWorkAgentPageLoader, listEligibleWorkAgents } from './agents';
import { buildWorkModelOptions } from './models';

describe('Work agent catalog helpers', () => {
  it('loads every accessible-agent page using the returned cursor', async () => {
    const loadPage = jest
      .fn<Promise<WorkAgentPage<{ id: string }>>, [WorkAgentPageInput<string>]>()
      .mockResolvedValueOnce({ data: [{ id: 'a1' }], has_more: true, after: 'cursor-1' })
      .mockResolvedValueOnce({ data: [{ id: 'a2' }], has_more: false, after: null });
    const loadAll = createWorkAgentPageLoader(loadPage);

    await expect(
      loadAll({
        accessibleIds: ['visible'],
        tenantId: 'tenant-1',
        limit: 1000,
        includeExecutionConfig: true,
        includeModelConfig: true,
      }),
    ).resolves.toEqual([{ id: 'a1' }, { id: 'a2' }]);
    expect(loadPage).toHaveBeenNthCalledWith(2, {
      accessibleIds: ['visible'],
      tenantId: 'tenant-1',
      limit: 1000,
      includeExecutionConfig: true,
      includeModelConfig: true,
      after: 'cursor-1',
    });
  });

  it('fails closed when a paginated response does not advance its cursor', async () => {
    const loadAll = createWorkAgentPageLoader(async () => ({
      data: [{ id: 'a1' }],
      has_more: true,
      after: null,
    }));

    await expect(
      loadAll({
        accessibleIds: ['visible'],
        tenantId: null,
        limit: 1000,
        includeExecutionConfig: true,
        includeModelConfig: true,
      }),
    ).rejects.toThrow('Work agent pagination did not advance');
  });

  it('checks graph candidates concurrently up to the configured cap and keeps catalog order', async () => {
    const agents = Array.from({ length: 5 }, (_, index) => ({
      id: `root-${index}`,
      model: 'local-model',
      provider: 'ollama',
      agent_ids: [`child-${index}`],
    }));
    const models = buildWorkModelOptions([
      { id: 'local-model', provider: 'ollama', local: true },
    ]);
    let active = 0;
    let maximumActive = 0;

    const eligible = await listEligibleWorkAgents({
      agents,
      models,
      graphLimit: 64,
      concurrency: 2,
      loadAgent: async (id) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return { id, model: 'local-model', provider: 'ollama' };
      },
    });

    expect(maximumActive).toBe(2);
    expect(eligible.map(({ id }) => id)).toEqual(agents.map(({ id }) => id));
  });
});
