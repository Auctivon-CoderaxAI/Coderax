const bcrypt = require('bcryptjs');
const { logger } = require('@coderax/data-schemas');
const { createGuestSessionHandler } = require('@coderax/api');
const { createUser, deleteUserById } = require('~/models');
const { setAuthTokens } = require('~/server/services/AuthService');
const { getAppConfig } = require('~/server/services/Config');
const { isPasswordLoginEnabled } = require('~/server/services/Config/passwordLogin');

const guestController = createGuestSessionHandler({
  createUser,
  hashPassword: bcrypt.hash,
  deleteUserById,
  getAppConfig,
  setAuthTokens,
  error: (message, metadata) => logger.error(message, metadata),
  getAccessConfig: () => ({
    passwordLoginEnabled: isPasswordLoginEnabled(),
    guestAccess: process.env.ENABLE_GUEST_ACCESS,
    enforceTwoFactor: process.env.ENFORCE_TWO_FACTOR_AUTHENTICATION,
  }),
});

module.exports = { guestController };
