const express = require('express');
const { runtimeProviderCatalog } = require('@coderax/api');
const { requireJwtAuth } = require('~/server/middleware/');
const { logger } = require('@coderax/data-schemas');

const router = express.Router();

const fail = (res, error, action) => {
  logger.error(`Provider catalog ${action} failed`, {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  res.status(503).json({ error: 'Provider catalog is unavailable', providers: [] });
};

/** Every registered provider, its credential state and every discovered model. */
router.get('/', requireJwtAuth, async (req, res) => {
  try {
    res.json(await runtimeProviderCatalog.report());
  } catch (error) {
    fail(res, error, 'read');
  }
});

/** Explicit refresh, for the status panel's manual refresh action. */
router.post('/refresh', requireJwtAuth, async (req, res) => {
  try {
    res.json(await runtimeProviderCatalog.refresh());
  } catch (error) {
    fail(res, error, 'refresh');
  }
});

module.exports = router;
