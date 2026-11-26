const express = require('express');
const { createGatewayHandlers, isOwnerUser } = require('@coderax/api');
const { logger } = require('@coderax/data-schemas');
const { requireJwtAuth, configMiddleware } = require('~/server/middleware');

/**
 * Authenticated server-side gateway to Coderax-WorkflowEngine.
 *
 * This file is wiring only: authentication, mounting and route registration.
 * Every decision (owner check, transport authority, capability negotiation,
 * validation, streaming, error mapping) lives in `@coderax/api` gateway handlers.
 * The engine credential is read from the server environment by that module and
 * never reaches a client, this file or a log.
 */
const router = express.Router();

router.use(requireJwtAuth);
router.use(configMiddleware);

const handlers = createGatewayHandlers({
  env: process.env,
  isOwner: isOwnerUser,
  logger,
});

router.use(handlers.requireOwner);

const handle = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

router.get('/meta', handle(handlers.meta));

router.get('/v1/health', handle(handlers.health));
router.get('/v1/ready', handle(handlers.readiness));
router.get('/v1/agents', handle(handlers.agents));
router.get('/v1/models', handle(handlers.models));

router.post('/v1/chat', handle(handlers.chat));

router.post('/v1/work', handle(handlers.submitWork));
router.get('/v1/work/:taskId', handle(handlers.getTask));
router.get('/v1/work/:taskId/artifacts', handle(handlers.artifacts));
router.get('/v1/work/:taskId/events', handle(handlers.events));
router.post('/v1/work/:taskId/cancel', handle(handlers.cancel));
router.post('/v1/work/:taskId/resume', handle(handlers.resume));
router.post('/v1/work/:taskId/retry', handle(handlers.retry));
router.get('/v1/work/:taskId/permissions', handle(handlers.permissions));
router.post('/v1/work/:taskId/permissions', handle(handlers.decidePermission));

router.get('/v1/conversations', handle(handlers.conversations));
router.get('/v1/conversations/:conversationId', handle(handlers.conversation));
router.get('/v1/memory', handle(handlers.memory));
router.get('/v1/notifications', handle(handlers.notifications));

/** The WorkflowEngine contract publishes no scheduling operation: fail closed. */
router.get('/v1/schedules', handle(handlers.scheduling));

module.exports = router;
