import type { WorkGraphAgent } from './graph';
import { admitWorkAgent } from './admission';

const sources = [{ id: 'llama3:latest', provider: 'ollama', local: true }];

const agent = (
  id: string,
  overrides: Partial<WorkGraphAgent> = {},
): WorkGraphAgent => ({
  id,
  model: 'llama3:latest',
  provider: 'ollama',
  ...overrides,
});

describe('Work agent admission', () => {
  it('checks reachable agents through the injected loader and ACL', async () => {
    const root = agent('root', { agent_ids: ['private', 'visible'] });
    const loads: string[] = [];
    const checks: string[] = [];
    const result = await admitWorkAgent({
      requestedAgentId: 'root',
      sources,
      loadAgent: async (id) => {
        loads.push(id);
        if (id === 'root') return root;
        if (id === 'private') return agent(id, { model: 'gpt-4o', provider: 'openAI' });
        return agent(id);
      },
      canViewAgent: async (candidate) => {
        checks.push(candidate.id ?? '');
        return candidate.id !== 'private';
      },
    });

    expect(result).toMatchObject({ ok: true, model: { id: 'llama3:latest', provider: 'ollama' } });
    expect(loads).toEqual(['root', 'private', 'visible']);
    expect(checks).toEqual(['private', 'visible']);
  });

  it('returns stable failures for missing agents and disallowed models', async () => {
    await expect(
      admitWorkAgent({
        requestedAgentId: 'missing',
        sources,
        loadAgent: async () => null,
        canViewAgent: async () => true,
      }),
    ).resolves.toEqual({ ok: false, reason: 'agent_not_found' });

    await expect(
      admitWorkAgent({
        requestedAgentId: 'paid',
        sources,
        loadAgent: async () => agent('paid', { model: 'gpt-4o', provider: 'openAI' }),
        canViewAgent: async () => true,
      }),
    ).resolves.toEqual({ ok: false, reason: 'model_not_allowed' });
  });

  it('rejects disallowed reachable agents and mismatched requested models', async () => {
    await expect(
      admitWorkAgent({
        requestedAgentId: 'root',
        sources,
        loadAgent: async (id) =>
          id === 'root'
            ? agent(id, { agent_ids: ['paid'] })
            : agent(id, { model: 'gpt-4o', provider: 'openAI' }),
        canViewAgent: async () => true,
      }),
    ).resolves.toEqual({ ok: false, reason: 'graph_not_allowed' });

    await expect(
      admitWorkAgent({
        requestedAgentId: 'root',
        sources,
        requestedModel: 'different-model',
        loadAgent: async () => agent('root'),
        canViewAgent: async () => true,
      }),
    ).resolves.toEqual({ ok: false, reason: 'model_not_allowed' });
  });
});
