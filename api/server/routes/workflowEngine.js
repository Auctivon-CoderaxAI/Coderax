const express = require('express');
const mongoose = require('mongoose');
const { createWorkflowEngineGateway } = require('@coderax/api/gateway');
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
 * The startup compatibility handshake runs without a request. It is deliberately
 * fire-and-forget and fail-closed: a failed check leaves every gateway route
 * answering 503, and it never blocks or rewrites an existing Coderax route.
 */
module.exports.prewarm = async () => {
  try {
    const config = await resolveConfig();
    if (config?.startupCheck === false) {
      return null;
    }
    return await gateway.prewarm(config);
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
