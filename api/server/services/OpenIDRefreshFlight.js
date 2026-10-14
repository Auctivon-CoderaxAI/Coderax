const { createOpenIDRefreshFlightService } = require('@coderax/api');
const { logger, encryptV2, decryptV2 } = require('@coderax/data-schemas');
const db = require('~/models');

module.exports = createOpenIDRefreshFlightService({
  db,
  logger,
  encrypt: encryptV2,
  decrypt: decryptV2,
});
