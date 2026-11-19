const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { logger } = require('@coderax/data-schemas');
const { sanitizeUserForAuthResponse } = require('@coderax/api');
const { SystemRoles } = require('coderax-data-provider');
const { createUser, findUser } = require('~/models');
const { setAuthTokens } = require('~/server/services/AuthService');
const { getAppConfig } = require('~/server/services/Config');
const { isPasswordLoginEnabled } = require('~/server/services/Config/passwordLogin');

const OWNER_EMAIL = 'password-login@local.invalid';
const OWNER_FIELDS = '_id email role provider twoFactorEnabled';

function matchesPassword(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string' || !expected) {
    return false;
  }

  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function findOwner() {
  return findUser({ role: SystemRoles.ADMIN }, OWNER_FIELDS);
}

async function createOwner() {
  const appConfig = await getAppConfig({ baseOnly: true });
  const password = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

  try {
    return await createUser(
      {
        name: 'Owner',
        username: `owner_${randomBytes(4).toString('hex')}`,
        email: OWNER_EMAIL,
        emailVerified: true,
        provider: 'local',
        role: SystemRoles.ADMIN,
        password,
      },
      appConfig?.balance,
      true,
      true,
    );
  } catch (error) {
    /** Two first-time requests can race to create the owner; reuse the winner. */
    const existing = await findUser({ email: OWNER_EMAIL }, OWNER_FIELDS);
    if (existing) {
      return existing;
    }
    throw error;
  }
}

/**
 * Sign in with one server-configured password, without an email address.
 * The password is never returned to the client or written to logs.
 */
const passwordLoginController = async (req, res) => {
  res.set?.('Cache-Control', 'no-store');

  if (!isPasswordLoginEnabled()) {
    return res.sendStatus(404);
  }

  const expected = process.env.PASSWORD_LOGIN_PASSWORD;
  const candidate = req.body?.password;

  if (candidate?.length > 512 || !matchesPassword(candidate, expected)) {
    logger.warn(`[passwordLogin] Failed attempt [IP: ${req.ip ?? 'unknown'}]`);
    return res.status(401).json({ code: 'AUTH_FAILED', message: 'Incorrect password.' });
  }

  try {
    let user = await findOwner();
    if (!user) {
      user = await createOwner();
    }

    if (user?.twoFactorEnabled) {
      return res.status(403).json({
        code: 'PASSWORD_LOGIN_2FA_REQUIRED',
        message: 'Password-only sign-in is unavailable while two-factor authentication is enabled.',
      });
    }

    const token = await setAuthTokens(user._id, res, null, req);
    return res.status(200).send({ token, user: sanitizeUserForAuthResponse(user) });
  } catch (error) {
    logger.error('[passwordLogin] Could not establish owner session', error);
    return res.status(503).json({
      code: 'PASSWORD_LOGIN_UNAVAILABLE',
      message: 'Sign-in is temporarily unavailable.',
    });
  }
};

module.exports = { passwordLoginController, matchesPassword };
