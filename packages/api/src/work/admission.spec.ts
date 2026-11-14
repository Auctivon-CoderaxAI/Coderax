import type { WorkGraphAgent } from './graph';
import { resolveWorkAdmission, resolveWorkContext, workAdmissionStatus } from './admission';

const sources = [{ id: 'local-model', provider: 'ollama', local: true }];

describe('Work admission', () => {
  it.each([
    ['WORK_AGENT_ID_INVALID', 400],
    ['WORK_AGENT_NOT_FOUND', 404],
    ['WORK_AGENT_UNAVAILABLE', 503],
    ['WORK_MODEL_NOT_ALLOWED', 409],
  ] as const)('maps %s to the existing HTTP status %s', (code, status) => {
    expect(workAdmissionStatus(code)).toBe(status);
  });
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

  it('passes the configured concurrency cap through selected-agent admission', async () => {
    const root: WorkGraphAgent = {
      id: 'root',
      model: 'local-model',
      provider: 'ollama',
      agent_ids: ['one', 'two', 'three'],
    };
    let active = 0;
    let maximumActive = 0;
    const result = await resolveWorkAdmission({
      sources,
      requestedModel: 'auto',
      requestedAgentId: 'root',
      graphConcurrency: 2,
      findAgent: async (id) => {
        if (id === 'root') return root;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return { id, model: 'local-model', provider: 'ollama' };
      },
      canViewAgent: async () => true,
    });
    expect(result.ok).toBe(true);
    expect(maximumActive).toBe(2);
    expect(active).toBe(0);
  });
});
