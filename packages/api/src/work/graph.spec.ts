import { resolveWorkAgentGraph, workAgentReferences } from './graph';
import { toWorkGraphAgent } from './deps';
import { buildWorkModelOptions } from './models';

const models = buildWorkModelOptions([
  { id: 'qwen3.5:4b', provider: 'ollama', local: true },
]);

const root = {
  id: 'local-root',
  model: 'qwen3.5:4b',
  provider: 'ollama',
  subagents: {
    enabled: false,
    agent_ids: ['paid-child'],
    graphs: [{ agent_ids: ['paid-graph-child'] }],
  },
};

describe('native Work graph admission', () => {
  it('ignores saved subagent references when delegation is disabled', async () => {
    expect(workAgentReferences(root)).toEqual([]);
    let loaded = 0;
    const graph = await resolveWorkAgentGraph(root, models, async () => {
      loaded += 1;
      return { id: 'paid-child', model: 'gpt-4o', provider: 'openAI' };
    });
    expect(graph).toMatchObject({ ok: true, members: [] });
    expect(loaded).toBe(0);
  });

  it('preserves the enabled flag through the ACL-scoped catalog projection', async () => {
    const projected = toWorkGraphAgent(root);
    expect(projected?.subagents?.enabled).toBe(false);
    if (!projected) {
      throw new Error('Expected a projected Work agent');
    }
    let loaded = 0;
    const graph = await resolveWorkAgentGraph(projected, models, async () => {
      loaded += 1;
      return { id: 'paid-child', model: 'gpt-4o', provider: 'openAI' };
    });
    expect(graph).toMatchObject({ ok: true, members: [] });
    expect(loaded).toBe(0);

    const enabled = toWorkGraphAgent({
      ...root,
      subagents: { ...root.subagents, enabled: true },
    });
    expect(enabled?.subagents?.enabled).toBe(true);
    expect(enabled && workAgentReferences(enabled)).toEqual(['paid-child', 'paid-graph-child']);
  });

  it('does not traverse subagents without an explicit enabled flag', () => {
    expect(
      workAgentReferences({
        ...root,
        subagents: { agent_ids: ['paid-child'], graphs: [{ agent_ids: ['paid-graph-child'] }] },
      }),
    ).toEqual([]);
  });

  it('rejects a reachable paid child when delegation is enabled', async () => {
    const enabled = { ...root, subagents: { ...root.subagents, enabled: true } };
    expect(workAgentReferences(enabled)).toEqual(['paid-child', 'paid-graph-child']);
    const graph = await resolveWorkAgentGraph(enabled, models, async (id) => ({
      id,
      model: 'gpt-4o',
      provider: 'openAI',
    }));
    expect(graph).toMatchObject({
      ok: false,
      reason: 'member_model_not_allowed',
      agentId: 'paid-child',
    });
  });
});
