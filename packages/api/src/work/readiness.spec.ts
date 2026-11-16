import type { FreeInferenceCatalogState } from 'coderax-data-provider';
import type { WorkAgentOption } from './agents';
import type { WorkModel } from './models';
import { describeWorkReadiness } from './readiness';

const localModel: WorkModel = { id: 'qwen3.5:4b', label: 'Qwen 3.5', provider: 'Ollama' };
const hostedModel: WorkModel = {
  id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  label: 'Nemotron (free)',
  provider: 'FreeOpenRouter',
};
const agent = (model: WorkModel): WorkAgentOption => ({
  id: 'agent-1',
  name: 'Reviewer',
  model: model.id,
  provider: model.provider ?? '',
  members: [],
});

const catalog = (
  overrides: Partial<FreeInferenceCatalogState> = {},
): FreeInferenceCatalogState => ({
  enabled: true,
  endpoints: [
    {
      id: 'openrouter-nemotron-ultra-free',
      provider: 'openrouter',
      modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      label: 'Nemotron (free)',
      credentialEnv: 'OPENROUTER_API_KEY',
      credentialPresent: true,
      tools: true,
      executable: true,
      blocked: null,
    },
  ],
  executableProviders: [
    {
      provider: 'openrouter',
      name: 'FreeOpenRouter',
      models: ['nvidia/nemotron-3-ultra-550b-a55b:free'],
    },
  ],
  ...overrides,
});

describe('Work readiness', () => {
  it('is not ready when no model is offered', () => {
    const readiness = describeWorkReadiness({
      catalog: catalog({ enabled: false, endpoints: [], executableProviders: [] }),
      models: [],
      agents: [],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((check) => check.id === 'eligible_model')?.ok).toBe(false);
    expect(readiness.nextAction).toMatch(/local endpoint|freeInference/);
  });

  it('names the missing credential instead of the generic model error', () => {
    const readiness = describeWorkReadiness({
      catalog: catalog({
        endpoints: [
          {
            id: 'openrouter-nemotron-ultra-free',
            provider: 'openrouter',
            modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
            label: 'Nemotron (free)',
            credentialEnv: 'OPENROUTER_API_KEY',
            credentialPresent: false,
            tools: true,
            executable: false,
            blocked: 'missing_credential',
          },
        ],
        executableProviders: [],
      }),
      models: [],
      agents: [],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((check) => check.id === 'provider_credential')?.detail).toContain(
      'OPENROUTER_API_KEY',
    );
    expect(readiness.nextAction).toContain('OPENROUTER_API_KEY');
  });

  it('is ready on a local model without hosted free inference', () => {
    const readiness = describeWorkReadiness({
      catalog: catalog({ enabled: false, endpoints: [], executableProviders: [] }),
      models: [localModel],
      agents: [agent(localModel)],
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.nextAction).toBeNull();
    expect(readiness.checks.find((check) => check.id === 'free_inference_enabled')?.ok).toBe(false);
  });

  it('reports the exact provider and model to pin an agent to', () => {
    const readiness = describeWorkReadiness({
      catalog: catalog(),
      models: [hostedModel],
      agents: [],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.nextAction).toBe(
      'Create an agent with provider "FreeOpenRouter" and model "nvidia/nemotron-3-ultra-550b-a55b:free".',
    );
  });
});
