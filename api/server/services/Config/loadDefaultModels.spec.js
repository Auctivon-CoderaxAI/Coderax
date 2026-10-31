jest.mock('@coderax/api', () => ({
  ...jest.requireActual('@coderax/api'),
  getAnthropicModels: jest.fn(),
  getAppConfigOptionsFromUser: jest.fn(),
  getBedrockModels: jest.fn(),
  getGoogleModels: jest.fn(),
  getOpenAIModels: jest.fn(),
  mergeHeaders: jest.fn(),
}));
jest.mock('./app');
jest.mock('@coderax/data-schemas', () => ({
  ...jest.requireActual('@coderax/data-schemas'),
  logger: { error: jest.fn() },
}));

const { logger } = require('@coderax/data-schemas');
const { EModelEndpoint, Providers } = require('coderax-data-provider');
const {
  getAnthropicModels,
  getBedrockModels,
  getGoogleModels,
  getOpenAIModels,
} = require('@coderax/api');
const loadDefaultModels = require('./loadDefaultModels');

describe('loadDefaultModels', () => {
  const request = { config: {}, user: { id: 'user-1' } };

  beforeEach(() => {
    jest.clearAllMocks();
    getOpenAIModels.mockResolvedValue(['gpt-5']);
    getAnthropicModels.mockResolvedValue(['claude-sonnet']);
    getBedrockModels.mockReturnValue(['amazon.nova-pro-v1:0']);
    getGoogleModels.mockReturnValue(['gemini-3.7-flash']);
  });

  it('returns the Google catalog once under its configured endpoint', async () => {
    const models = await loadDefaultModels(request);

    expect(models).toEqual(
      expect.objectContaining({
        [EModelEndpoint.openAI]: ['gpt-5'],
        [EModelEndpoint.google]: ['gemini-3.7-flash'],
        [EModelEndpoint.anthropic]: ['claude-sonnet'],
        [EModelEndpoint.bedrock]: ['amazon.nova-pro-v1:0'],
      }),
    );
    expect(models[Providers.VERTEXAI]).toBeUndefined();
    expect(getGoogleModels).toHaveBeenCalledWith({
      configuredModels: undefined,
      headers: undefined,
      userObject: request.user,
    });
  });

  it('keeps the configured Google catalog empty when its model source fails', async () => {
    const error = new Error('Google models unavailable');
    getGoogleModels.mockReturnValue(Promise.reject(error));

    const models = await loadDefaultModels(request);

    expect(models[EModelEndpoint.google]).toEqual([]);
    expect(models[Providers.VERTEXAI]).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('Error getting Google models:', error);
  });
});
