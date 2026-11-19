const mockLogger = { warn: jest.fn(), error: jest.fn() };
const mockFindUser = jest.fn();
const mockCreateUser = jest.fn();
const mockSetAuthTokens = jest.fn();
const mockGetAppConfig = jest.fn();
const mockSanitizeUser = jest.fn((user) => ({
  _id: user._id,
  email: user.email,
  role: user.role,
}));

jest.mock('@coderax/data-schemas', () => ({ logger: mockLogger }));
jest.mock('@coderax/api', () => ({
  isEnabled: (value) => value === 'true',
  sanitizeUserForAuthResponse: (...args) => mockSanitizeUser(...args),
}));
jest.mock('coderax-data-provider', () => ({
  SystemRoles: { ADMIN: 'ADMIN' },
}));
jest.mock('~/models', () => ({
  findUser: (...args) => mockFindUser(...args),
  createUser: (...args) => mockCreateUser(...args),
}));
jest.mock('~/server/services/AuthService', () => ({
  setAuthTokens: (...args) => mockSetAuthTokens(...args),
}));
jest.mock('~/server/services/Config', () => ({
  getAppConfig: (...args) => mockGetAppConfig(...args),
}));

const { passwordLoginController } = require('./PasswordLoginController');

const response = () => ({
  set: jest.fn().mockReturnThis(),
  status: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  sendStatus: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('passwordLoginController', () => {
  const originalPassword = process.env.PASSWORD_LOGIN_PASSWORD;
  const originalTwoFactor = process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PASSWORD_LOGIN_PASSWORD;
    delete process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION;
    mockFindUser.mockResolvedValue(null);
    mockCreateUser.mockImplementation(async (data) => ({
      _id: 'owner-id',
      ...data,
      twoFactorEnabled: false,
    }));
    mockSetAuthTokens.mockResolvedValue('owner-token');
    mockGetAppConfig.mockResolvedValue({ balance: { enabled: false } });
  });

  afterAll(() => {
    if (originalPassword === undefined) delete process.env.PASSWORD_LOGIN_PASSWORD;
    else process.env.PASSWORD_LOGIN_PASSWORD = originalPassword;
    if (originalTwoFactor === undefined) delete process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION;
    else process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION = originalTwoFactor;
  });

  it('is disabled when no server password is configured', async () => {
    const res = response();
    await passwordLoginController({ body: { password: 'test-owner-password-123!' } }, res);

    expect(res.sendStatus).toHaveBeenCalledWith(404);
    expect(mockFindUser).not.toHaveBeenCalled();
    expect(mockSetAuthTokens).not.toHaveBeenCalled();
  });

  it('rejects an incorrect password without creating a session', async () => {
    process.env.PASSWORD_LOGIN_PASSWORD = 'test-owner-password-123!';
    const res = response();
    await passwordLoginController({ body: { password: 'wrong-password' }, ip: '127.0.0.1' }, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_FAILED' }));
    expect(mockFindUser).not.toHaveBeenCalled();
    expect(mockSetAuthTokens).not.toHaveBeenCalled();
  });

  it('issues a normal owner session for the configured password', async () => {
    process.env.PASSWORD_LOGIN_PASSWORD = 'test-owner-password-123!';
    mockFindUser.mockResolvedValue({
      _id: 'owner-id',
      email: 'owner@example.com',
      role: 'ADMIN',
      twoFactorEnabled: false,
    });
    const req = { body: { password: 'test-owner-password-123!' }, ip: '127.0.0.1' };
    const res = response();

    await passwordLoginController(req, res);

    expect(mockFindUser).toHaveBeenCalledWith(
      { role: 'ADMIN' },
      '_id email role provider twoFactorEnabled',
    );
    expect(mockSetAuthTokens).toHaveBeenCalledWith('owner-id', res, null, req);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      token: 'owner-token',
      user: { _id: 'owner-id', email: 'owner@example.com', role: 'ADMIN' },
    });
    expect(res.send.mock.calls[0][0].user).not.toHaveProperty('password');
  });

  it('bootstraps an owner when no admin account exists', async () => {
    process.env.PASSWORD_LOGIN_PASSWORD = 'test-owner-password-123!';
    const res = response();

    await passwordLoginController({ body: { password: 'test-owner-password-123!' }, ip: '127.0.0.1' }, res);

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Owner',
        email: 'password-login@local.invalid',
        emailVerified: true,
        provider: 'local',
        role: 'ADMIN',
        password: expect.any(String),
      }),
      { enabled: false },
      true,
      true,
    );
    expect(mockSetAuthTokens).toHaveBeenCalledWith('owner-id', res, null, expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not bypass account-level two-factor authentication', async () => {
    process.env.PASSWORD_LOGIN_PASSWORD = 'test-owner-password-123!';
    mockFindUser.mockResolvedValue({
      _id: 'owner-id',
      email: 'owner@example.com',
      role: 'ADMIN',
      twoFactorEnabled: true,
    });
    const res = response();

    await passwordLoginController({ body: { password: 'test-owner-password-123!' }, ip: '127.0.0.1' }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PASSWORD_LOGIN_2FA_REQUIRED' }),
    );
    expect(mockSetAuthTokens).not.toHaveBeenCalled();
  });
});
