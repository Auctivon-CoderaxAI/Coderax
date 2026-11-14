import { isCyvoxFreeOrLocalModel } from './cyvox-model';

describe('isCyvoxFreeOrLocalModel', () => {
  it.each([
    'cyvox/auto',
    'openrouter/free',
    'openrouter/deepseek/deepseek-r1:free',
    'ollama:llama3',
    'ollama:llama3:latest',
    'ollama/qwen3:8b',
  ])('accepts free or local model %s', (model) => {
    expect(isCyvoxFreeOrLocalModel(model)).toBe(true);
  });

  it.each([
    'openai:gpt-4o',
    'anthropic:claude-3-7-sonnet',
    'google/gemini-2.5-pro',
    'deepseek-flash',
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp',
    'deepseek-v4-pro',
    'ollama:',
    'ollama/qwen3:8b;select-paid-model',
  ])('rejects billed or malformed model %s', (model) => {
    expect(isCyvoxFreeOrLocalModel(model)).toBe(false);
  });
});
