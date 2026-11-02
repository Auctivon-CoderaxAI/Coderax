import { EModelEndpoint, selectAutomaticChatModel } from 'coderax-data-provider';
import type { TEndpointsConfig, TModelsConfig, TTokenConfigMap } from 'coderax-data-provider';
import { buildChatModelSources, toChatModelPreset } from './chatModelRouting';

const ollama = 'ollama';

describe('Chat model catalog projection', () => {
  const endpoints = {
    [ollama]: { type: EModelEndpoint.custom },
    [EModelEndpoint.openAI]: { type: EModelEndpoint.openAI },
    [EModelEndpoint.agents]: { type: EModelEndpoint.agents },
    [EModelEndpoint.assistants]: { type: EModelEndpoint.assistants },
  } as unknown as TEndpointsConfig;
  const models = {
    [ollama]: ['llama3'],
    [EModelEndpoint.openAI]: ['gpt-4o'],
    [EModelEndpoint.agents]: ['gpt-4o'],
    [EModelEndpoint.assistants]: ['gpt-4o'],
    unconfigured: ['orphaned'],
  } as TModelsConfig;
  const tokenConfig = {
    [ollama]: { llama3: { context: 8192 } },
    [EModelEndpoint.openAI]: {
      'gpt-4o': { context: 128000, prompt: 2.5, completion: 10 },
    },
  } as TTokenConfigMap;

  it('uses only configured non-agent models and carries server context and price data', () => {
    expect(buildChatModelSources(models, endpoints, tokenConfig)).toEqual([
      expect.objectContaining({ id: 'llama3', provider: ollama, context: 8192 }),
      expect.objectContaining({
        id: 'gpt-4o',
        provider: EModelEndpoint.openAI,
        context: 128000,
        promptCost: 2.5,
        completionCost: 10,
      }),
    ]);
  });

  it('routes to the local model without exposing the paid model as automatic fallback', () => {
    const sources = buildChatModelSources(models, endpoints, tokenConfig);
    expect(selectAutomaticChatModel(sources)).toMatchObject({
      ok: true,
      model: { id: 'llama3', provider: ollama, local: true },
      alternatives: [],
    });
  });

  it('pins the chosen provider endpoint when building the initial conversation preset', () => {
    expect(toChatModelPreset({ id: 'llama3', provider: ollama }, endpoints)).toMatchObject({
      endpoint: ollama,
      endpointType: EModelEndpoint.custom,
      model: 'llama3',
    });
  });
});
