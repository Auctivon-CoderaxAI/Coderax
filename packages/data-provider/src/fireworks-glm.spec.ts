import {
  buildFireworksGlmEndpoint,
  FIREWORKS_API_KEY_ENV,
  FIREWORKS_INFERENCE_BASE_URL,
  GLM_5P3_FLASH_MODEL_PATH,
  isFireworksGlmEnabled,
  isFireworksGlmModelPath,
  resolveFireworksApiKey,
  toFireworksModelPath,
} from './fireworks-glm';

describe('fireworks glm 5.3 flash preset', () => {
  it('is disabled when no key is configured', () => {
    expect(buildFireworksGlmEndpoint({})).toBeNull();
    expect(isFireworksGlmEnabled({})).toBe(false);
  });

  it('treats a blank key as absent', () => {
    expect(resolveFireworksApiKey({ [FIREWORKS_API_KEY_ENV]: '   ' })).toBeNull();
    expect(buildFireworksGlmEndpoint({ [FIREWORKS_API_KEY_ENV]: '' })).toBeNull();
  });

  it('is disabled in a default environment without the key', () => {
    const env = { ...process.env };
    delete env[FIREWORKS_API_KEY_ENV];
    expect(buildFireworksGlmEndpoint(env)).toBeNull();
  });

  it('builds an opt-in BYOK endpoint once a key is supplied', () => {
    const endpoint = buildFireworksGlmEndpoint({ [FIREWORKS_API_KEY_ENV]: 'fw-test-key' });

    expect(endpoint).not.toBeNull();
    expect(endpoint?.enablement).toBe('opt-in');
    expect(endpoint?.requiresApiKey).toBe(true);
    expect(endpoint?.provider).toBe('fireworks');
    expect(endpoint?.baseURL).toBe(FIREWORKS_INFERENCE_BASE_URL);
    expect(endpoint?.apiKey).toBe('fw-test-key');
  });

  it('never carries a key the caller did not supply', () => {
    const endpoint = buildFireworksGlmEndpoint({ [FIREWORKS_API_KEY_ENV]: 'fw-test-key' });
    const serialized = JSON.stringify(endpoint);
    expect(serialized).not.toContain('sk-');
    expect(endpoint?.apiKey).not.toMatch(/^Bearer /);
  });

  it('uses the exact account model path', () => {
    const endpoint = buildFireworksGlmEndpoint({ [FIREWORKS_API_KEY_ENV]: 'fw-test-key' });
    const [model] = endpoint?.models ?? [];

    expect(model?.model).toBe('accounts/fireworks/models/glm-5p3-flash');
    expect(model?.model).toBe(GLM_5P3_FLASH_MODEL_PATH);
    expect(model?.capabilities.vision).toBe(true);
    expect(model?.capabilities.toolCalls).toBe(true);
  });

  it('encodes dotted slugs because Fireworks slugs cannot contain dots', () => {
    expect(toFireworksModelPath('glm-5.3-flash')).toBe(GLM_5P3_FLASH_MODEL_PATH);
    expect(toFireworksModelPath('glm-5p3-flash')).toBe(GLM_5P3_FLASH_MODEL_PATH);
    expect(toFireworksModelPath(GLM_5P3_FLASH_MODEL_PATH)).toBe(GLM_5P3_FLASH_MODEL_PATH);
  });

  it('rejects an empty slug instead of producing a malformed path', () => {
    expect(() => toFireworksModelPath('   ')).toThrow();
  });

  it('accepts only the exact account path', () => {
    expect(isFireworksGlmModelPath('accounts/fireworks/models/glm-5p3-flash')).toBe(true);
    expect(isFireworksGlmModelPath('glm-5p3-flash')).toBe(false);
    expect(isFireworksGlmModelPath('accounts/fireworks/models/glm-5.3-flash')).toBe(false);
  });
});
