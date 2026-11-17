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
    const models = buildWorkModelOptions(
      [{ id: 'llama3:latest', local: true }, { id: 'openai:gpt-4o', provider: 'gateway' }],
      'openai:gpt-4o',
    );
    expect(models.map((model) => model.id)).toEqual([WORK_AUTO_MODEL_ID, 'llama3:latest']);
    for (const selected of [WORK_AUTO_MODEL_ID, null, undefined, '']) {
      expect(resolveWorkSelection(models, selected, 'openai:gpt-4o')).toMatchObject({
        ok: true, auto: true, model: { id: 'llama3:latest' },
      });
    }
    expect(resolveWorkSelection(models, 'openai:gpt-4o')).toEqual({
      ok: false, reason: 'model_unavailable',
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
      [{ id: 'llama3:latest', label: 'Llama 3', local: true },
       { id: 'deepseek-flash', provider: 'deepseek' }],
      'deepseek-flash',
    );
    expect(options.map((option) => option.id)).toEqual([WORK_AUTO_MODEL_ID, 'llama3:latest']);
    expect(options[0].target).toEqual({ id: 'llama3:latest', label: 'Llama 3' });
  });

  it('keeps an eligible provider when the configured default shares its id', () => {
    const options = buildWorkModelOptions(
      [{ id: 'shared', provider: 'ollama', local: true },
       { id: 'shared', provider: 'gateway' }],
      { id: 'shared', provider: 'gateway' },
    );
    expect(options.filter((model) => model.id === 'shared').map((model) => model.provider))
      .toEqual(['ollama']);
    expect(options[0].target).toEqual({ id: 'shared', label: 'shared', provider: 'ollama' });
    expect(resolveWorkAgentModel(options, { id: 'agent', model: 'shared', provider: 'gateway' }))
      .toBeNull();
  });

  it('does not invent a configured pair the catalog does not advertise', () => {
    const options = buildWorkModelOptions(
      [
        { id: 'shared', provider: 'other' },
        { id: 'local', provider: 'ollama', local: true },
      ],
      { id: 'shared', provider: 'gateway' },
    );
    expect(options.map((model) => model.id)).toEqual([WORK_AUTO_MODEL_ID, 'local']);
    expect(options[0].target).toEqual({ id: 'local', label: 'local', provider: 'ollama' });
  });

  it('resolves the configured default on its own endpoint when the id is shared', () => {
    const options = buildWorkModelOptions(
      [{ id: 'gpt-4o', provider: 'openAI' },
       { id: 'gpt-4o', provider: 'gateway' },
       { id: 'llama3:latest', provider: 'ollama', local: true }],
      { id: 'gpt-4o', provider: 'gateway' },
    );
    expect(options[0].target).toEqual({
      id: 'llama3:latest', label: 'llama3:latest', provider: 'ollama',
    });
    expect(resolveWorkSelection(options, WORK_AUTO_MODEL_ID,
      { id: 'gpt-4o', provider: 'gateway' })).toMatchObject({
      ok: true, model: { id: 'llama3:latest', provider: 'ollama' },
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
