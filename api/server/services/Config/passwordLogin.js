const { isEnabled } = require('@coderax/api');

/**
 * Password-only owner login is opt-in: it needs a server-only password and must
 * never bypass mandatory two-factor authentication.
 */
const isPasswordLoginEnabled = () =>
  Boolean(process.env.PASSWORD_LOGIN_PASSWORD) &&
  !isEnabled(process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION);

module.exports = { isPasswordLoginEnabled };
