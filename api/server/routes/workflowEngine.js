const express = require('express');
const mongoose = require('mongoose');
const {
  createWorkflowEngineGateway,
  prewarmWorkflowEngine,
  startWorkflowEnginePrewarm,
} = require('@coderax/api/gateway');
const { createConversationAuthorityMethods, logger } = require('@coderax/data-schemas');
const { requireJwtAuth } = require('~/server/middleware');
const { getAppConfig } = require('~/server/services/Config');

/**
 * Wiring only. The gateway behavior lives in `@coderax/api/gateway`: this file
 * authenticates the owner, resolves the deployment configuration and mounts the
 * router. It holds no engine credential and no proxying logic.
 */

// Use deployment config before the principal override and augmentation stages:
// a request must not be able to redirect the server-held engine credential.
const resolveConfig = async () => (await getAppConfig({ baseOnly: true })).config?.workflowEngine;

const authority = createConversationAuthorityMethods(mongoose);

const gateway = createWorkflowEngineGateway({
  resolveConfig,
  env: process.env,
  logger,
  // Durable and shared by every replica: `workflowEngine.conversations` only
  // bootstraps a mapping; the stored record is authoritative afterwards.
  authorityStore: {
    read: authority.readConversationAuthority,
    create: authority.createConversationAuthority,
    advance: authority.advanceConversationAuthority,
  },
});

const router = express.Router();
router.use(requireJwtAuth);
router.use(gateway.router);

module.exports = router;
module.exports.gateway = gateway;

/**
 * Startup orchestration lives in `@coderax/api/gateway`; this file only hands it
 * the deployment config and the mounted gateway. Kept as an export so an
 * operator or test harness can run the check on demand.
 */
const startup = { resolveConfig, gateway, logger, env: process.env };
module.exports.prewarm = () => prewarmWorkflowEngine(startup);
startWorkflowEnginePrewarm(startup);
