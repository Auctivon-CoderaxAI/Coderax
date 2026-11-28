import { matchesProviderFilter } from 'coderax-data-provider';
import type { ProviderCatalogModel } from 'coderax-data-provider';
import { workCatalogModelKey } from '../workSelection';

const model = (overrides: Partial<ProviderCatalogModel> = {}): ProviderCatalogModel =>
  ({
    provider: 'openrouter',
    providerLabel: 'OpenRouter',
    id: 'deepseek/deepseek-r1:free',
    label: 'DeepSeek R1 (free)',
    contextTokens: 163840,
    pricing: { promptPerToken: 0, completionPerToken: 0, free: true, basis: 'per-model' },
    capabilities: { streaming: true, reasoning: true, tools: true, structuredOutputs: false },
    available: true,
    reason: 'available',
    chat: true,
    work: true,
    ...overrides,
  }) as ProviderCatalogModel;

describe('workCatalogModelKey', () => {
  it('uses the provider id and model id, matching the Work model key format', () => {
    expect(workCatalogModelKey(model())).toBe(JSON.stringify(['openrouter', 'deepseek/deepseek-r1:free']));
  });

  it('does not use the provider label', () => {
    expect(workCatalogModelKey(model())).not.toContain('OpenRouter');
  });
});

describe('Work catalog filter', () => {
  it('offers only work-capable models under the work filter', () => {
    expect(matchesProviderFilter(model({ work: true }), 'work')).toBe(true);
    expect(matchesProviderFilter(model({ work: false }), 'work')).toBe(false);
  });
});
