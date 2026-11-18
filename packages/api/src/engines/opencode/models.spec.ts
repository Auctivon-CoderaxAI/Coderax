import { isModelAllowedForMode, isZeroCostModel, parseEngineModel } from './models';

describe('OpenCode zero-cost model guard', () => {
  it('parses provider/model without splitting a model tag that contains a slash', () => {
    expect(parseEngineModel('opencode/deepseek-v4.1-flash-free')).toEqual({
      providerId: 'opencode',
      modelId: 'deepseek-v4.1-flash-free',
    });
    expect(parseEngineModel('ollama/hf.co/team/model:Q4')).toEqual({
      providerId: 'ollama',
      modelId: 'hf.co/team/model:Q4',
    });
    expect(parseEngineModel('deepseek-v4.1-flash-free')).toBeNull();
    expect(parseEngineModel('opencode/')).toBeNull();
    expect(parseEngineModel('')).toBeNull();
  });

  it('accepts catalogued free models and local providers only', () => {
    expect(isZeroCostModel({ providerId: 'opencode', modelId: 'deepseek-v4.1-flash-free' })).toBe(
      true,
    );
    expect(isZeroCostModel({ providerId: 'opencode', modelId: 'big-pickle' })).toBe(true);
    expect(isZeroCostModel({ providerId: 'opencode', modelId: 'claude-sonnet-4.5' })).toBe(false);
    expect(isZeroCostModel({ providerId: 'anthropic', modelId: 'claude-sonnet-4.5' })).toBe(false);
    expect(isZeroCostModel({ providerId: 'ollama', modelId: 'qwen2.5-coder:7b' })).toBe(true);
  });

  it('keeps a hosted model out of private mode and admits it in cloud mode', () => {
    const hosted = { providerId: 'opencode', modelId: 'big-pickle' };
    const local = { providerId: 'ollama', modelId: 'qwen2.5-coder:7b' };
    expect(isModelAllowedForMode(hosted, 'private')).toBe(false);
    expect(isModelAllowedForMode(hosted, 'cloud')).toBe(true);
    expect(isModelAllowedForMode(local, 'private')).toBe(true);
    expect(isModelAllowedForMode(local, 'cloud')).toBe(true);
    expect(isModelAllowedForMode(null, 'cloud')).toBe(false);
  });
});
