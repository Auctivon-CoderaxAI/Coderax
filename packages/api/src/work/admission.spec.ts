import type { WorkGraphAgent } from './graph';
import { resolveWorkAdmission, resolveWorkContext } from './admission';

const sources = [{ id: 'local-model', provider: 'ollama', local: true }];

describe('Work admission', () => {
  it('preserves automatic model resolution for non-agent tasks', async () => {
    await expect(
      resolveWorkAdmission({
        sources,
        requestedModel: 'auto',
        configuredDefaultModel: 'local-model',
        findAgent: async () => null,
        canViewAgent: async () => true,
      }),
    ).resolves.toEqual({
      ok: true,
      context: {
        isWork: true,
        workModel: 'local-model',
        workProvider: 'ollama',
        allowedModels: [{ id: 'local-model', provider: 'ollama' }],
      },
    });
  });

  it('rejects a selected agent graph that reaches a paid model', async () => {
    const root: WorkGraphAgent = {
      id: 'root',
      model: 'local-model',
      provider: 'ollama',
      agent_ids: ['child'],
    };
    await expect(
      resolveWorkAdmission({
        sources,
        requestedModel: 'auto',
        requestedAgentId: 'root',
        findAgent: async (id) =>
          id === 'root' ? root : { id: 'child', model: 'gpt-4o', provider: 'openAI' },
        canViewAgent: async () => true,
      }),
    ).resolves.toEqual({ ok: false, error: 'WORK_AGENT_GRAPH_NOT_ALLOWED' });
  });

  it('ignores inaccessible members because the native runner cannot execute them', async () => {
    const root: WorkGraphAgent = {
      id: 'root',
      model: 'local-model',
      provider: 'ollama',
      agent_ids: ['private', 'visible'],
    };
    await expect(
      resolveWorkAdmission({
        sources,
        requestedModel: 'auto',
        requestedAgentId: 'root',
        findAgent: async (id) => {
          if (id === 'root') return root;
          return {
            id,
            model: id === 'private' ? 'gpt-4o' : 'local-model',
            provider: id === 'private' ? 'openAI' : 'ollama',
          };
        },
        canViewAgent: async (agent) => agent.id !== 'private',
      }),
    ).resolves.toMatchObject({
      ok: true,
      context: {
        workModel: 'local-model',
        allowedModels: [{ id: 'local-model', provider: 'ollama' }],
      },
    });
  });

  it('uses the configured graph-size limit for selected agents', async () => {
    const root: WorkGraphAgent = {
      id: 'root',
      model: 'local-model',
      provider: 'ollama',
      agent_ids: ['child'],
    };
    await expect(
      resolveWorkAdmission({
        sources,
        requestedModel: 'auto',
        requestedAgentId: 'root',
        graphLimit: 1,
        findAgent: async (id) =>
          id === 'root' ? root : { id, model: 'local-model', provider: 'ollama' },
        canViewAgent: async () => true,
      }),
    ).resolves.toEqual({ ok: false, error: 'WORK_AGENT_GRAPH_TOO_LARGE' });
  });

  it('keeps the existing model selection error contract', () => {
    expect(resolveWorkContext(sources, 'gpt-4o', null)).toEqual({
      error: 'WORK_MODEL_NOT_ALLOWED',
    });
    expect(resolveWorkContext(sources, { id: 'local-model' }, 'local-model')).toEqual({
      error: 'WORK_MODEL_NOT_ALLOWED',
    });
  });
});
