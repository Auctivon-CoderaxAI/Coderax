const { randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { logger } = require('@coderax/data-schemas');
const { isEnabled, sanitizeUserForAuthResponse } = require('@coderax/api');
const { SystemRoles } = require('coderax-data-provider');
const { createUser, deleteUserById } = require('~/models');
const { setAuthTokens } = require('~/server/services/AuthService');
const { getAppConfig } = require('~/server/services/Config');
const { isPasswordLoginEnabled } = require('~/server/services/Config/passwordLogin');

/**
 * Opt-in passwordless guest sessions. A separate expiring USER account is
 * created for each visitor; no existing or administrator account is reused.
 * Guest entry is disabled when password-only owner login is enabled.
 */
const guestController = async (req, res) => {
  if (
    isPasswordLoginEnabled() ||
    !isEnabled(process.env.ENABLE_GUEST_ACCESS) ||
    isEnabled(process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION)
  ) {
    return res.sendStatus(404);
  }

  const nonce = randomBytes(16).toString('hex');
  let user;

  try {
    const password = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const appConfig = await getAppConfig({ baseOnly: true });
    user = await createUser(
      {
        name: 'Guest',
        username: 'guest_' + nonce,
        email: 'guest-' + nonce + '@guests.invalid',
        emailVerified: true,
        provider: 'guest',
        role: SystemRoles.USER,
        password,
      },
      appConfig?.balance,
      false, // Expire abandoned guest records after one week.
      true,
    );

    const token = await setAuthTokens(user._id, res, null, req);
    return res.status(200).send({ token, user: sanitizeUserForAuthResponse(user) });
  } catch (error) {
    if (user?._id) {
      try {
        await deleteUserById(user._id);
      } catch (cleanupError) {
        logger.error('[guestController] Could not clean up incomplete guest account', cleanupError);
      }
    }
    logger.error('[guestController] Could not establish guest session', error);
    return res.status(503).json({
      code: 'GUEST_SESSION_UNAVAILABLE',
      message: 'Guest access is temporarily unavailable.',
    });
  }
};

module.exports = { guestController };
