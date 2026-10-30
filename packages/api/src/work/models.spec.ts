import {
  WORK_AUTO_MODEL_ID,
  buildWorkModelOptions,
  buildWorkModels,
  isWorkSupportedModel,
  resolveWorkModel,
} from './models';

describe('native work model discovery', () => {
  it('offers free and local models without any CyVox input', () => {
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

  it('never silently substitutes a different model', () => {
    const models = buildWorkModels([{ id: 'llama3:latest', local: true }]);
    expect(resolveWorkModel(models, 'llama3:latest')?.id).toBe('llama3:latest');
    expect(resolveWorkModel(models, 'gone')).toBeNull();
    expect(resolveWorkModel(models, null)).toBeNull();
  });

  it('resolves the automatic option only while a concrete model exists', () => {
    expect(
      resolveWorkModel(buildWorkModelOptions([{ id: 'ollama/qwen' }]), WORK_AUTO_MODEL_ID),
    ).toMatchObject({ id: WORK_AUTO_MODEL_ID, auto: true });
    expect(resolveWorkModel(buildWorkModels([]), WORK_AUTO_MODEL_ID)).toBeNull();
  });
});
