const express = require('express');
const {
  createWorkflowEngineGateway,
  resolveGatewayOptions,
  startWorkflowEngineGateway,
} = require('@coderax/api/gateway');
const { logger } = require('@coderax/data-schemas');
const { configMiddleware, requireJwtAuth } = require('~/server/middleware');
const { getAppConfig } = require('~/server/services/Config');

/**
 * Wiring only. Behavior lives in `@coderax/api/gateway`: this file
 * authenticates the owner, loads deployment configuration and mounts the
 * router. It holds no engine credential and no proxying logic.
 */

/** YAML-only, for the startup check before a request principal exists. */
const resolveDeploymentConfig = async () =>
  resolveGatewayOptions(await getAppConfig({ baseOnly: true }));

/** Read the deployment base without principal overrides. */
const resolveConfig = async (req) =>
  resolveGatewayOptions(await getAppConfig({ baseOnly: true }), req.config?.workflowEngine);

const gateway = createWorkflowEngineGateway({
  resolveConfig,
  env: process.env,
  logger,
});

const router = express.Router();
router.use(requireJwtAuth);
router.use(configMiddleware);
router.use(gateway.router);

module.exports = router;
module.exports.gateway = gateway;

startWorkflowEngineGateway({
  gateway,
  resolveConfig: resolveDeploymentConfig,
  logger,
  env: process.env,
});
