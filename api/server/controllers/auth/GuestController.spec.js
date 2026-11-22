const mockCreateUser = jest.fn();
const mockDeleteUserById = jest.fn();
const mockSetAuthTokens = jest.fn();
const mockGetAppConfig = jest.fn();
const mockSanitizeUser = jest.fn((user) => ({
  _id: user._id,
  email: user.email,
  role: user.role,
  provider: user.provider,
}));
const mockLogger = { error: jest.fn() };

jest.mock('@coderax/data-schemas', () => ({ logger: mockLogger }));
jest.mock('@coderax/api', () => ({
  isEnabled: (value) => value === 'true',
  sanitizeUserForAuthResponse: (...args) => mockSanitizeUser(...args),
}));
jest.mock('~/models', () => ({
  createUser: (...args) => mockCreateUser(...args),
  deleteUserById: (...args) => mockDeleteUserById(...args),
}));
jest.mock('~/server/services/AuthService', () => ({
  setAuthTokens: (...args) => mockSetAuthTokens(...args),
}));
jest.mock('~/server/services/Config', () => ({
  getAppConfig: (...args) => mockGetAppConfig(...args),
}));

const { guestController } = require('./GuestController');

const response = () => ({
  status: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  sendStatus: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('guestController', () => {
  const originalGuest = process.env.ENABLE_GUEST_ACCESS;
  const originalPasswordLogin = process.env.PASSWORD_LOGIN_PASSWORD;
  const originalTwoFactor = process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ENABLE_GUEST_ACCESS;
    delete process.env.PASSWORD_LOGIN_PASSWORD;
    delete process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION;
    mockGetAppConfig.mockResolvedValue({ balance: { enabled: false } });
    mockCreateUser.mockImplementation(async (data) => ({ _id: 'isolated-guest-id', ...data }));
    mockSetAuthTokens.mockResolvedValue('issued-session-token');
    mockDeleteUserById.mockResolvedValue({});
  });

  afterAll(() => {
    if (originalGuest === undefined) delete process.env.ENABLE_GUEST_ACCESS;
    else process.env.ENABLE_GUEST_ACCESS = originalGuest;
    if (originalPasswordLogin === undefined) delete process.env.PASSWORD_LOGIN_PASSWORD;
    else process.env.PASSWORD_LOGIN_PASSWORD = originalPasswordLogin;
    if (originalTwoFactor === undefined) delete process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION;
    else process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION = originalTwoFactor;
  });

  it('is disabled by default and does not create a user', async () => {
    const res = response();
    await guestController({}, res);
    expect(res.sendStatus).toHaveBeenCalledWith(404);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('does not bypass mandatory two-factor authentication', async () => {
    process.env.ENABLE_GUEST_ACCESS = 'true';
    process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION = 'true';
    const res = response();
    await guestController({}, res);
    expect(res.sendStatus).toHaveBeenCalledWith(404);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('keeps guest access disabled when an owner password is configured', async () => {
    process.env.ENABLE_GUEST_ACCESS = 'true';
    process.env.PASSWORD_LOGIN_PASSWORD = 'test-owner-password-123!';
    const res = response();
    await guestController({}, res);
    expect(res.sendStatus).toHaveBeenCalledWith(404);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('creates only an expiring USER identity and issues normal tokens', async () => {
    process.env.ENABLE_GUEST_ACCESS = 'true';
    const req = { headers: {} };
    const res = response();
    await guestController(req, res);
    const [data, balance, disableTTL, returnUser] = mockCreateUser.mock.calls[0];
    expect(data).toEqual(
      expect.objectContaining({
        name: 'Guest',
        role: 'USER',
        provider: 'guest',
        emailVerified: true,
        email: expect.stringMatching(/^guest-[a-f0-9]{32}@guests[.]invalid$/),
        password: expect.any(String),
      }),
    );
    expect(data.password).not.toBe('issued-session-token');
    expect(balance).toEqual({ enabled: false });
    expect(disableTTL).toBe(false);
    expect(returnUser).toBe(true);
    expect(mockSetAuthTokens).toHaveBeenCalledWith('isolated-guest-id', res, null, req);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      token: 'issued-session-token',
      user: expect.objectContaining({ role: 'USER', provider: 'guest' }),
    });
    expect(res.send.mock.calls[0][0].user).not.toHaveProperty('password');
  });

  it('deletes an incomplete guest account if session issuance fails', async () => {
    process.env.ENABLE_GUEST_ACCESS = 'true';
    mockSetAuthTokens.mockRejectedValue(new Error('session storage unavailable'));
    const res = response();
    await guestController({}, res);
    expect(mockDeleteUserById).toHaveBeenCalledWith('isolated-guest-id');
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'GUEST_SESSION_UNAVAILABLE',
      }),
    );
  });
});
