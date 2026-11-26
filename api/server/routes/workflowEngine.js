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

/**
 * Effective owner configuration: the YAML value plus the owner's stored
 * root-level `workflowEngine` override. The credential itself comes from the
 * server environment, so no configuration layer can supply or read it.
 */
const resolveConfig = async (req) =>
  resolveGatewayOptions(req.config ?? (await getAppConfig({ baseOnly: true })));

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
