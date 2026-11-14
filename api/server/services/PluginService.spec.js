const mockLoggerError = jest.fn();
const mockFindOnePluginAuth = jest.fn();

jest.mock('@coderax/data-schemas', () => ({
  logger: { error: mockLoggerError },
}));

jest.mock('@coderax/api', () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn(),
}));

jest.mock('~/models', () => ({
  findOnePluginAuth: (...args) => mockFindOnePluginAuth(...args),
  updatePluginAuth: jest.fn(),
  deletePluginAuth: jest.fn(),
}));

const { getUserPluginAuthValue } = require('./PluginService');

describe('getUserPluginAuthValue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not log an expected missing auth value', async () => {
    mockFindOnePluginAuth.mockResolvedValue(null);

    await expect(
      getUserPluginAuthValue('user-id', 'WEB_SEARCH_SELECTED_PROVIDER'),
    ).rejects.toMatchObject({ code: 'PLUGIN_AUTH_NOT_FOUND' });

    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('still logs credential-store failures', async () => {
    const error = new Error('database unavailable');
    mockFindOnePluginAuth.mockRejectedValue(error);

    await expect(getUserPluginAuthValue('user-id', 'WEB_SEARCH_SELECTED_PROVIDER')).rejects.toBe(
      error,
    );

    expect(mockLoggerError).toHaveBeenCalledWith('[getUserPluginAuthValue]', error);
  });
});
