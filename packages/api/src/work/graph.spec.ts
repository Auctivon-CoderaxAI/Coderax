import {
  enforceWorkRunAllowance,
  resolveWorkAgentGraph,
  workAgentReferences,
} from './graph';
import { buildWorkModelOptions } from './models';
import { toWorkGraphAgent } from './deps';

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
  it('does not apply prepared-run admission outside Work mode', () => {
    expect(() =>
      enforceWorkRunAllowance(
        { isWork: false },
        [{ id: 'paid', model: 'gpt-4o', provider: 'openAI' }],
        'WORK_MODEL_NOT_ALLOWED',
        jest.fn(),
      ),
    ).not.toThrow();
  });

  it('rejects prepared models outside the admitted Work allowance', () => {
    const reportViolation = jest.fn();
    expect(() =>
      enforceWorkRunAllowance(
        {
          isWork: true,
          allowedModels: [{ id: 'local', provider: 'ollama' }],
        },
        [{ id: 'paid', model: 'gpt-4o', provider: 'openAI' }],
        'WORK_MODEL_NOT_ALLOWED',
        reportViolation,
      ),
    ).toThrow('{ "type": "WORK_MODEL_NOT_ALLOWED" }');
    expect(reportViolation).toHaveBeenCalledWith({
      id: 'paid',
      model: 'gpt-4o',
      provider: 'openAI',
    });
  });

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

  it('loads independent siblings concurrently without exceeding the configured cap', async () => {
    let active = 0;
    let maximumActive = 0;
    const graph = await resolveWorkAgentGraph(
      { ...root, agent_ids: ['one', 'two', 'three', 'four', 'five'] },
      models,
      async (id) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return { id, model: 'qwen3.5:4b', provider: 'ollama' };
      },
      10,
      2,
    );
    expect(graph).toMatchObject({ ok: true });
    if (!graph.ok) {
      throw new Error('Expected an allowed graph');
    }
    expect(graph.members.map((member) => member.id)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ]);
    expect(maximumActive).toBe(2);
    expect(active).toBe(0);
  });

  it('fails closed on a paid sibling even when member reads run concurrently', async () => {
    const graph = await resolveWorkAgentGraph(
      { ...root, agent_ids: ['local-child', 'paid-child'] },
      models,
      async (id) => ({
        id,
        model: id === 'paid-child' ? 'gpt-4o' : 'qwen3.5:4b',
        provider: id === 'paid-child' ? 'openAI' : 'ollama',
      }),
      10,
      2,
    );
    expect(graph).toEqual({
      ok: false,
      reason: 'member_model_not_allowed',
      agentId: 'paid-child',
    });
  });

  it('rejects an oversized frontier before dispatching excess reads', async () => {
    let loads = 0;
    const graph = await resolveWorkAgentGraph(
      { ...root, agent_ids: ['one', 'two', 'three'] },
      models,
      async (id) => {
        loads += 1;
        return { id, model: 'qwen3.5:4b', provider: 'ollama' };
      },
      2,
      2,
    );
    expect(graph).toEqual({ ok: false, reason: 'too_large' });
    expect(loads).toBe(0);
  });
});
