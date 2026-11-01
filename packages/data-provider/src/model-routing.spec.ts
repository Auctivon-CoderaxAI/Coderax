import type { ModelRouteSource } from './model-routing';
import {
  isFreeOrLocalModel,
  isPaidModelTarget,
  rankFreeOrLocalModels,
  selectAutomaticChatModel,
} from './model-routing';

const catalog: ModelRouteSource[] = [
  { id: 'openai:gpt-4o', provider: 'openAI', capability: 0.99, speed: 0.99, reliability: 0.99 },
  { id: 'ollama/llama3', provider: 'ollama', capability: 0.6, speed: 0.7, reliability: 0.8 },
  {
    id: 'free/alpha:free',
    provider: 'openrouter',
    capability: 0.7,
    speed: 0.6,
    reliability: 0.8,
  },
  { id: 'lmstudio/qwen', provider: 'lmstudio', capability: 0.7, speed: 0.6, reliability: 0.9 },
];

describe('free and local model classification', () => {
  it('recognises explicit, local-endpoint, local-id, and free-tag signals', () => {
    expect(isFreeOrLocalModel({ id: 'anything', free: true })).toBe(true);
    expect(isFreeOrLocalModel({ id: 'anything', local: true })).toBe(true);
    expect(isFreeOrLocalModel({ id: 'llama3', provider: 'ollama' })).toBe(true);
    expect(isFreeOrLocalModel({ id: 'ollama/llama3' })).toBe(true);
    expect(isFreeOrLocalModel({ id: 'provider/model:free' })).toBe(true);
    expect(isFreeOrLocalModel({ id: 'zero-priced', promptCost: 0, completionCost: 0 })).toBe(true);
    expect(isFreeOrLocalModel({ id: 'gpt-4o', provider: 'openAI' })).toBe(false);
  });
});

describe('automatic Chat model routing', () => {
  it('never ranks a paid model, even when it has the best signals', () => {
    const ranked = rankFreeOrLocalModels(catalog);
    expect(ranked.map((model) => model.id)).toEqual([
      'lmstudio/qwen',
      'free/alpha:free',
      'ollama/llama3',
    ]);
  });

  it('orders free/local models by capability, then speed, then reliability', () => {
    const ranked = rankFreeOrLocalModels([
      { id: 'slow', local: true, capability: 0.9, speed: 0.2, reliability: 1 },
      { id: 'fast', local: true, capability: 0.9, speed: 0.8, reliability: 0.1 },
      { id: 'reliable', local: true, capability: 0.9, speed: 0.8, reliability: 0.9 },
      { id: 'weaker', local: true, capability: 0.5, speed: 1, reliability: 1 },
    ]);
    expect(ranked.map((model) => model.id)).toEqual(['reliable', 'fast', 'slow', 'weaker']);
  });

  it('selects the best free/local model and offers the rest as safe failover', () => {
    expect(selectAutomaticChatModel(catalog)).toMatchObject({
      ok: true,
      model: { id: 'lmstudio/qwen' },
      alternatives: [{ id: 'free/alpha:free' }, { id: 'ollama/llama3' }],
    });
  });

  it('reports a paid fallback without selecting it when no free/local model exists', () => {
    const selection = selectAutomaticChatModel([
      { id: 'gpt-4o', provider: 'openAI', capability: 0.9 },
      { id: 'claude', provider: 'anthropic', capability: 0.8 },
    ]);
    expect(selection).toMatchObject({
      ok: false,
      reason: 'no_free_local_model',
      paid: { id: 'gpt-4o' },
    });
    expect(selection).not.toHaveProperty('model');
  });

  it('honours the deployment default as the disclosed paid fallback', () => {
    expect(
      selectAutomaticChatModel(
        [
          { id: 'gpt-4o', provider: 'openAI', capability: 0.9 },
          { id: 'claude', provider: 'anthropic', capability: 0.8 },
        ],
        { preferredPaidModel: 'claude' },
      ),
    ).toMatchObject({ ok: false, paid: { id: 'claude' } });
  });

  it('uses known context and observed model metadata as capability and cost signals', () => {
    const selection = selectAutomaticChatModel([
      { id: 'paid-expensive', provider: 'openAI', promptCost: 10, completionCost: 20 },
      { id: 'paid-cheap', provider: 'anthropic', promptCost: 0.25, completionCost: 0.25 },
      { id: 'free-context', provider: 'gateway', promptCost: 0, completionCost: 0, context: 32000 },
    ]);

    expect(selection).toMatchObject({
      ok: true,
      model: { id: 'free-context', costPerMillion: 0, context: 32000 },
    });
  });

  it('chooses the least expensive paid option when explicit consent is still required', () => {
    expect(
      selectAutomaticChatModel([
        { id: 'expensive', provider: 'openAI', promptCost: 10, completionCost: 20 },
        { id: 'cheap', provider: 'anthropic', promptCost: 0.25, completionCost: 0.25 },
      ]),
    ).toMatchObject({ ok: false, paid: { id: 'cheap', costPerMillion: 0.5 } });
  });

  it('returns no paid fallback when the catalog is empty', () => {
    expect(selectAutomaticChatModel([])).toEqual({
      ok: false,
      reason: 'no_free_local_model',
      paid: null,
    });
  });
});

describe('paid model consent target', () => {
  it('requires consent for a concrete paid model on a model endpoint', () => {
    expect(isPaidModelTarget({ endpoint: 'openAI', model: 'gpt-4o' })).toBe(true);
  });

  it('does not require consent for free/local models or agent-owned models', () => {
    expect(isPaidModelTarget({ endpoint: 'ollama', model: 'llama3' })).toBe(false);
    expect(isPaidModelTarget({ endpoint: 'openAI', model: 'provider/model:free' })).toBe(false);
    expect(isPaidModelTarget({ endpoint: 'agents', model: 'paid-agent-model' })).toBe(false);
    expect(isPaidModelTarget({ endpoint: 'openAI', model: '' })).toBe(false);
  });
});
