const mockLoadDefaultModels = jest.fn();
const mockLoadConfigModels = jest.fn();

jest.mock('@coderax/data-schemas', () => ({
  logger: {
    error: jest.fn(),
  },
}));

jest.mock('~/server/services/Config', () => ({
  loadDefaultModels: (...args) => mockLoadDefaultModels(...args),
  loadConfigModels: (...args) => mockLoadConfigModels(...args),
}));

const { modelController, loadModels } = require('./ModelController');
const { logger } = require('@coderax/data-schemas');

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('loadModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads default and configured models concurrently while preserving custom precedence', async () => {
    const defaultModels = deferred();
    const configuredModels = deferred();
    const req = { user: { id: 'user-1' } };
    mockLoadDefaultModels.mockReturnValue(defaultModels.promise);
    mockLoadConfigModels.mockReturnValue(configuredModels.promise);

    const resultPromise = loadModels(req);

    expect(mockLoadDefaultModels).toHaveBeenCalledWith(req);
    expect(mockLoadConfigModels).toHaveBeenCalledWith(req);

    configuredModels.resolve({
      openAI: ['configured-model'],
      custom: ['custom-model'],
    });
    defaultModels.resolve({
      openAI: ['default-model'],
      anthropic: ['default-anthropic'],
    });

    await expect(resultPromise).resolves.toEqual({
      openAI: ['configured-model'],
      anthropic: ['default-anthropic'],
      custom: ['custom-model'],
    });
  });
});

describe('modelController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a safe catalog error without echoing provider details', async () => {
    const privateProviderMessage = 'provider rejected key private-provider-detail';
    mockLoadDefaultModels.mockRejectedValue(new Error(privateProviderMessage));
    const res = {
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await modelController({ user: { id: 'user-1' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith({ error: 'Failed to load model catalog' });
    expect(JSON.stringify(res.send.mock.calls)).not.toContain(privateProviderMessage);
    expect(logger.error).toHaveBeenCalledWith('Error fetching models', { errorName: 'Error' });
  });
});
