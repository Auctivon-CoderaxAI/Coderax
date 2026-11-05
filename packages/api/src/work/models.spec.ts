import {
  WORK_AUTO_MODEL_ID,
  buildWorkModelOptions,
  buildWorkModels,
  isWorkSupportedModel,
  resolveWorkAgentModel,
  resolveWorkModel,
  resolveWorkSelection,
} from './models';

const withPaid = () =>
  buildWorkModelOptions([
    { id: 'llama3:latest', local: true },
    { id: 'openai:gpt-4o', provider: 'gateway' },
  ]);

describe('native work model discovery', () => {
  it('offers free and local models from Coderax configuration', () => {
    const models = buildWorkModels([
      { id: 'llama3:latest', label: 'Llama 3', local: true },
      { id: 'ollama/qwen', local: true },
      { id: 'free/alpha', free: true },
      { id: 'openai:gpt-4o', provider: 'gateway' },
      { id: '' },
    ]);
    expect(models.map((model) => model.id)).toEqual(['free/alpha', 'llama3:latest', 'ollama/qwen']);
  });

  it('excludes paid gateway models from the picker', () => {
    expect(isWorkSupportedModel({ id: 'openai:gpt-4o' })).toBe(false);
    expect(isWorkSupportedModel({ id: 'anthropic:claude' })).toBe(false);
    expect(isWorkSupportedModel({ id: 'ollama/llama3' })).toBe(true);
    expect(isWorkSupportedModel({ id: '' })).toBe(false);
    expect(isWorkSupportedModel({ id: WORK_AUTO_MODEL_ID })).toBe(false);
  });

  it('deduplicates by id and keeps the first label', () => {
    const models = buildWorkModels([
      { id: 'llama3:latest', label: 'First', local: true },
      { id: 'llama3:latest', label: 'Second', local: true },
    ]);
    expect(models).toEqual([{ id: 'llama3:latest', label: 'First' }]);
  });

  it('puts the automatic option first when models are available', () => {
    const options = buildWorkModelOptions([{ id: 'llama3:latest', local: true }]);
    expect(options.map((option) => option.id)).toEqual([WORK_AUTO_MODEL_ID, 'llama3:latest']);
    expect(options[0]).toMatchObject({ auto: true, label: 'Automatic' });
  });

  it('does not offer automatic against an empty model list', () => {
    expect(buildWorkModelOptions([{ id: 'openai:gpt-4o', provider: 'gateway' }])).toEqual([]);
    expect(buildWorkModelOptions([])).toEqual([]);
  });

  it('never returns the automatic sentinel as a model', () => {
    expect(resolveWorkModel(withPaid(), WORK_AUTO_MODEL_ID)).toBeNull();
    expect(
      resolveWorkModel(buildWorkModels([{ id: 'llama3:latest', local: true }]), 'gone'),
    ).toBeNull();
    expect(resolveWorkModel(withPaid(), 'llama3:latest')?.id).toBe('llama3:latest');
  });

  it('resolves automatic to the configured default only when it is free or local', () => {
    expect(resolveWorkSelection(withPaid(), WORK_AUTO_MODEL_ID, 'llama3:latest')).toMatchObject({
      ok: true,
      auto: true,
      model: { id: 'llama3:latest' },
    });
  });

  it('cannot select a paid gateway model through automatic or by omission', () => {
    /** A paid default cannot enter the offered catalog; automatic stays free/local. */
    for (const selected of [WORK_AUTO_MODEL_ID, null, undefined, '']) {
      expect(resolveWorkSelection(withPaid(), selected, 'openai:gpt-4o')).toMatchObject({
        ok: true,
        auto: true,
        model: { id: 'llama3:latest' },
      });
    }
    /** Even a paid id the caller names explicitly is refused. */
    expect(resolveWorkSelection(withPaid(), 'openai:gpt-4o', 'llama3:latest')).toEqual({
      ok: false,
      reason: 'model_unavailable',
    });
  });

  it('ranks only free/local candidates when no default is configured', () => {
    expect(resolveWorkSelection(withPaid(), WORK_AUTO_MODEL_ID, null)).toMatchObject({
      ok: true,
      auto: true,
      model: { id: 'llama3:latest' },
    });
    expect(resolveWorkSelection(withPaid(), WORK_AUTO_MODEL_ID, '  ')).toMatchObject({
      ok: true,
      auto: true,
      model: { id: 'llama3:latest' },
    });
  });

  it('authorizes an agent by its own provider and model, never the submitted model', () => {
    const models = buildWorkModelOptions([
      { id: 'llama3:latest', provider: 'ollama', local: true },
      { id: 'free/alpha', provider: 'custom', free: true },
      { id: 'gpt-4o', provider: 'openAI' },
    ]);

    expect(
      resolveWorkAgentModel(models, {
        id: 'agent-local',
        model: 'llama3:latest',
        provider: 'ollama',
      }),
    ).toMatchObject({ id: 'llama3:latest', provider: 'ollama' });
    expect(
      resolveWorkAgentModel(models, { id: 'agent-paid', model: 'gpt-4o', provider: 'openAI' }),
    ).toBeNull();
    /** The same model id on a paid provider is not the local model. */
    expect(
      resolveWorkAgentModel(models, {
        id: 'agent-spoofed-provider',
        model: 'llama3:latest',
        provider: 'openAI',
      }),
    ).toBeNull();
    expect(resolveWorkAgentModel(models, null)).toBeNull();
    expect(
      resolveWorkAgentModel(models, { id: 'agent-empty', model: '', provider: 'ollama' }),
    ).toBeNull();
    expect(
      resolveWorkAgentModel(models, { id: '', model: 'llama3:latest', provider: 'ollama' }),
    ).toBeNull();
  });

  it('honours an explicit free or local selection', () => {
    expect(resolveWorkSelection(withPaid(), 'llama3:latest')).toMatchObject({
      ok: true,
      auto: false,
      model: { id: 'llama3:latest' },
    });
  });
});
