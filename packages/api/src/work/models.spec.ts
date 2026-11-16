import {
  WORK_AUTO_MODEL_ID,
  buildWorkModelOptions,
  buildWorkModels,
  isWorkSupportedModel,
  resolveWorkAgentModel,
  resolveWorkModel,
  resolveWorkAutoModel,
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
    expect(isWorkSupportedModel({ id: 'ollama/llama3' })).toBe(false);
    expect(isWorkSupportedModel({ id: 'ollama/llama3', local: true })).toBe(true);
    expect(isWorkSupportedModel({ id: '' })).toBe(false);
    expect(isWorkSupportedModel({ id: WORK_AUTO_MODEL_ID })).toBe(false);
  });

  it('does not trust local-looking model names on an unmarked provider', () => {
    const sources = [
      { id: 'ollama/llama3', provider: 'gateway' },
      { id: 'local/model', provider: 'gateway' },
      { id: 'ollama/llama3', provider: 'ollama', local: true },
    ];
    expect(buildWorkModels(sources)).toEqual([
      { id: 'ollama/llama3', label: 'ollama/llama3', provider: 'ollama' },
    ]);
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

  it('offers a configured paid default in the catalog', () => {
    /** The default is an explicit deployment choice, so it enters the catalog. */
    const models = buildWorkModelOptions(
      [
        { id: 'llama3:latest', local: true },
        { id: 'openai:gpt-4o', provider: 'gateway' },
      ],
      'openai:gpt-4o',
    );
    for (const selected of [WORK_AUTO_MODEL_ID, null, undefined, '']) {
      expect(resolveWorkSelection(models, selected, 'openai:gpt-4o')).toEqual({
        ok: true,
        auto: true,
        model: { id: 'openai:gpt-4o', label: 'openai:gpt-4o', provider: 'gateway' },
      });
    }
    /** A paid id that is not the configured default is still refused. */
    expect(resolveWorkSelection(withPaid(), 'openai:gpt-4o', 'llama3:latest')).toEqual({
      ok: false,
      reason: 'model_unavailable',
    });
  });

  it('routes automatic by the free/local ranking when no default is configured', () => {
    for (const configuredDefault of [null, '  ']) {
      expect(resolveWorkSelection(withPaid(), WORK_AUTO_MODEL_ID, configuredDefault)).toMatchObject(
        {
          ok: true,
          auto: true,
          model: { id: 'llama3:latest' },
        },
      );
    }
  });

  it('prefers the configured default when it is offered', () => {
    const models = buildWorkModelOptions([
      { id: 'alpha:7b', provider: 'ollama', local: true },
      { id: 'beta:7b', provider: 'ollama', local: true },
    ]);
    expect(resolveWorkSelection(models, WORK_AUTO_MODEL_ID, 'beta:7b')).toMatchObject({
      ok: true,
      model: { id: 'beta:7b', provider: 'ollama' },
    });
    expect(resolveWorkAutoModel(models, null)).toMatchObject({ id: 'alpha:7b' });
  });

  it('offers the configured default alongside free and local models', () => {
    const options = buildWorkModelOptions(
      [
        { id: 'llama3:latest', label: 'Llama 3', local: true },
        { id: 'deepseek/deepseek-v4.1-flash-fast', provider: 'deepseek' },
      ],
      'deepseek/deepseek-v4.1-flash-fast',
    );
    expect(options.map((option) => option.id)).toEqual([
      WORK_AUTO_MODEL_ID,
      'deepseek/deepseek-v4.1-flash-fast',
      'llama3:latest',
    ]);
    expect(options[0].target).toEqual({
      id: 'deepseek/deepseek-v4.1-flash-fast',
      label: 'deepseek/deepseek-v4.1-flash-fast',
      provider: 'deepseek',
    });
  });

  it('refuses automatic only when nothing free or local is offered', () => {
    const paidOnly = buildWorkModelOptions([{ id: 'gpt-4o', provider: 'openAI' }]);
    expect(paidOnly).toEqual([]);
    expect(resolveWorkSelection(paidOnly, WORK_AUTO_MODEL_ID, 'gpt-4o')).toEqual({
      ok: false,
      reason: 'auto_unresolved',
    });
  });

  it('names the model the automatic option resolves to', () => {
    const options = buildWorkModelOptions(
      [
        { id: 'alpha:7b', label: 'Alpha', provider: 'ollama', local: true },
        { id: 'beta:7b', label: 'Beta', provider: 'ollama', local: true },
        { id: 'gpt-4o', provider: 'openAI' },
      ],
      'beta:7b',
    );
    expect(options[0]).toEqual({
      id: WORK_AUTO_MODEL_ID,
      label: 'Automatic',
      auto: true,
      target: { id: 'beta:7b', label: 'Beta', provider: 'ollama' },
    });
    expect(options.map((option) => option.id)).toEqual([WORK_AUTO_MODEL_ID, 'alpha:7b', 'beta:7b']);
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
