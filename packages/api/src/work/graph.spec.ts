import type { WorkGraphAgent, WorkRunConfig } from './graph';
import {
  collectWorkRunTargets,
  findWorkRunViolation,
  resolveWorkAgentGraph,
  workAgentReferences,
} from './graph';
import { buildWorkModelOptions } from './models';

const MODELS = buildWorkModelOptions([
  { id: 'llama3:latest', provider: 'ollama', local: true },
  { id: 'qwen:7b', provider: 'ollama', local: true },
  { id: 'gpt-4o', provider: 'openAI' },
]);

const agent = (
  id: string,
  model: string,
  provider: string,
  extra: Partial<WorkGraphAgent> = {},
) => ({
  id,
  name: id,
  model,
  provider,
  ...extra,
});

function loader(agents: WorkGraphAgent[]) {
  const byId = new Map(agents.map((entry) => [entry.id, entry]));
  return jest.fn(async (id: string) => byId.get(id));
}

describe('Work agent graph', () => {
  it('collects every route one agent can hand work to, without itself', () => {
    const root = agent('lead', 'llama3:latest', 'ollama', {
      edges: [
        { from: 'lead', to: 'writer', edgeType: 'handoff' },
        { from: ['lead', 'writer'], to: ['checker'], edgeType: 'handoff' },
      ],
      agent_ids: ['chain'],
      subagents: { agent_ids: ['sub', 'lead'], graphs: [{ agent_ids: ['member'] }, null] },
    });
    expect(workAgentReferences(root).sort()).toEqual([
      'chain',
      'checker',
      'member',
      'sub',
      'writer',
    ]);
  });

  it('admits a free/local agent and names the agents it coordinates', async () => {
    const writer = agent('writer', 'qwen:7b', 'ollama');
    const root = agent('lead', 'llama3:latest', 'ollama', {
      edges: [{ from: 'lead', to: 'writer', edgeType: 'handoff' }],
    });
    const graph = await resolveWorkAgentGraph(root, MODELS, loader([writer]));
    expect(graph).toEqual({
      ok: true,
      model: { id: 'llama3:latest', label: 'llama3:latest', provider: 'ollama' },
      members: [{ id: 'writer', name: 'writer', model: 'qwen:7b', provider: 'ollama' }],
    });
  });

  it('refuses a root agent on a paid model', async () => {
    const graph = await resolveWorkAgentGraph(
      agent('paid', 'gpt-4o', 'openAI'),
      MODELS,
      loader([]),
    );
    expect(graph).toEqual({ ok: false, reason: 'model_not_allowed', agentId: 'paid' });
  });

  it('refuses a graph that reaches a paid agent through any route, however deep', async () => {
    const paid = agent('paid', 'gpt-4o', 'openAI');
    const middle = agent('middle', 'qwen:7b', 'ollama', { subagents: { agent_ids: ['paid'] } });
    const root = agent('lead', 'llama3:latest', 'ollama', { agent_ids: ['middle'] });
    expect(await resolveWorkAgentGraph(root, MODELS, loader([middle, paid]))).toEqual({
      ok: false,
      reason: 'member_model_not_allowed',
      agentId: 'paid',
    });
  });

  it('treats a provider mismatch as a paid route even when the model id collides', async () => {
    const lookalike = agent('lookalike', 'llama3:latest', 'openAI');
    const root = agent('lead', 'llama3:latest', 'ollama', {
      edges: [{ from: 'lead', to: 'lookalike', edgeType: 'handoff' }],
    });
    expect(await resolveWorkAgentGraph(root, MODELS, loader([lookalike]))).toMatchObject({
      ok: false,
      reason: 'member_model_not_allowed',
    });
  });

  it('ignores references the caller cannot view, as the native runtime skips them', async () => {
    const root = agent('lead', 'llama3:latest', 'ollama', { agent_ids: ['hidden'] });
    expect(await resolveWorkAgentGraph(root, MODELS, loader([]))).toMatchObject({
      ok: true,
      members: [],
    });
  });

  it('visits each agent once in a cycle and bounds the graph size', async () => {
    const a = agent('a', 'qwen:7b', 'ollama', { agent_ids: ['b'] });
    const b = agent('b', 'qwen:7b', 'ollama', { agent_ids: ['a', 'lead'] });
    const root = agent('lead', 'llama3:latest', 'ollama', { agent_ids: ['a'] });
    const load = loader([a, b]);
    expect(await resolveWorkAgentGraph(root, MODELS, load)).toMatchObject({ ok: true });
    expect(load).toHaveBeenCalledTimes(2);

    const wide = agent('lead', 'llama3:latest', 'ollama', { agent_ids: ['x1', 'x2', 'x3'] });
    expect(await resolveWorkAgentGraph(wide, MODELS, loader([]), 2)).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });
});

describe('Work run guard', () => {
  const allowance = [
    { id: 'llama3:latest', provider: 'ollama' },
    { id: 'qwen:7b', provider: 'ollama' },
  ];

  it('collects nested subagents, lazy descriptors and graph members once each', () => {
    const shared: WorkRunConfig = { id: 'shared', model: 'qwen:7b', provider: 'ollama' };
    const primary: WorkRunConfig = {
      id: 'lead',
      model: 'llama3:latest',
      endpoint: 'ollama',
      provider: 'openAI',
      subagentAgentConfigs: [shared],
      lazySubagentConfigs: [
        { id: 'lazy', model: 'qwen:7b', provider: 'ollama', lazySubagentConfigs: [shared] },
      ],
      subagentGraphConfigs: [
        { memberConfigs: [{ id: 'member', model: 'qwen:7b', endpoint: 'ollama' }] },
      ],
      subagentGraphMemberMetadata: [{ id: 'meta', model: 'qwen:7b', provider: 'ollama' }],
    };
    const targets = collectWorkRunTargets([primary, null]);
    expect(targets.map((target) => target.id).sort()).toEqual([
      'lazy',
      'lead',
      'member',
      'meta',
      'shared',
    ]);
    /** A full config is judged by the provider it was saved with, not its client family. */
    expect(targets.find((target) => target.id === 'lead')?.provider).toBe('ollama');
  });

  it('allows a run whose every prepared agent is inside the allowance', () => {
    expect(
      findWorkRunViolation(allowance, [
        { id: 'lead', model: 'llama3:latest', endpoint: 'ollama' },
        { id: 'writer', model: 'qwen:7b', endpoint: 'ollama' },
      ]),
    ).toBeNull();
  });

  it('stops a run that prepared a paid handoff, added or nested agent', () => {
    expect(
      findWorkRunViolation(allowance, [
        { id: 'lead', model: 'llama3:latest', endpoint: 'ollama' },
        { id: 'added', model: 'gpt-4o', endpoint: 'openAI' },
      ]),
    ).toEqual({ id: 'added', model: 'gpt-4o', provider: 'openAI' });
    expect(
      findWorkRunViolation(allowance, [
        {
          id: 'lead',
          model: 'llama3:latest',
          endpoint: 'ollama',
          lazySubagentConfigs: [{ id: 'deep', model: 'gpt-4o', provider: 'openAI' }],
        },
      ]),
    ).toMatchObject({ id: 'deep' });
  });

  it('fails closed without an allowance or a model', () => {
    expect(
      findWorkRunViolation(undefined, [{ id: 'lead', model: 'llama3:latest', endpoint: 'ollama' }]),
    ).toMatchObject({
      id: 'lead',
    });
    expect(findWorkRunViolation(allowance, [{ id: 'lead', endpoint: 'ollama' }])).toMatchObject({
      id: 'lead',
    });
  });
});
