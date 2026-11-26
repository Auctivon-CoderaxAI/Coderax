const express = require('express');
const { createWorkflowEngineGateway } = require('@coderax/api/gateway');
const { logger } = require('@coderax/data-schemas');
const configMiddleware = require('~/server/middleware/config/app');
const { requireJwtAuth } = require('~/server/middleware');
const { loadCustomConfig } = require('~/server/services/Config');

/**
 * Wiring only. The gateway behavior lives in `@coderax/api/gateway`: this file
 * authenticates the owner, resolves the deployment configuration and mounts the
 * router. It holds no engine credential and no proxying logic.
 */

const gateway = createWorkflowEngineGateway({
  // AppConfig keeps the YAML configuration under `config`; it does not project
  // individual sections onto the top level.
  resolveConfig: (req) => req.config?.config?.workflowEngine,
  env: process.env,
  logger,
});

const router = express.Router();
router.use(requireJwtAuth, configMiddleware);
router.use(gateway.router);

module.exports = router;
module.exports.gateway = gateway;

/**
 * The startup compatibility handshake runs without a request. It is deliberately
 * fire-and-forget and fail-closed: a failed check leaves every gateway route
 * answering 503, and it never blocks or rewrites an existing Coderax route.
 */
module.exports.prewarm = async () => {
  try {
    const config = await loadCustomConfig(false);
    if (config?.workflowEngine?.startupCheck === false) {
      return null;
    }
    return await gateway.prewarm(config?.workflowEngine);
  } catch (error) {
    logger.warn('[workflow-engine] startup check skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

if (process.env.NODE_ENV !== 'test') {
  void module.exports.prewarm();
}
