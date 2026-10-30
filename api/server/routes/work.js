const express = require('express');
const { logger } = require('@coderax/data-schemas');
const { createWorkRouter, GenerationJobManager } = require('@coderax/api');
const db = require('~/models');
const { loadModels } = require('~/server/controllers/ModelController');

const {
  flattenModelConfig,
  toWorkConversation,
  rowsFromCursor,
  onlyWorkRows,
} = require('./workModels');
const { getWorkChatRouter } = require('./workChat');

/**
 * A Work request carries its own authenticated context: model discovery is
 * per-user, reads are owner-scoped, and abort re-checks the native job owner.
 */
function depsFor(req) {
  return {
    listModels: async () => flattenModelConfig(await loadModels(req)),
    listConversations: async ({ userId, limit }) => {
      const result = await db.getConvosByCursor(userId, {
        limit,
        isArchived: false,
        sortBy: 'updatedAt',
        sortDirection: 'desc',
      });
      return onlyWorkRows(rowsFromCursor(result).map(toWorkConversation));
    },
    getConversation: async ({ userId, conversationId }) =>
      toWorkConversation(await db.getConvo(userId, conversationId)),
    cancelRun: async ({ userId, conversationId }) => {
      const job = await GenerationJobManager.getJob(conversationId);
      if (!job) {
        return false;
      }
      /**
       * The router already scoped the conversation to this user; this second
       * check uses the job's own owner so a stale or foreign job can never be
       * aborted through a Work request.
       */
      if (job.userId !== userId) {
        logger.warn(`[Work] Refusing to abort another user's generation: ${conversationId}`);
        return false;
      }
      const tenantId = req.user?.tenantId ?? req.tenantId;
      if (tenantId && job.tenantId && job.tenantId !== tenantId) {
        logger.warn(`[Work] Refusing to abort another tenant's generation: ${conversationId}`);
        return false;
      }
      const result = await GenerationJobManager.abortJob(conversationId, {
        expectedCreatedAt: job.createdAt,
      });
      return result?.success === true;
    },
  };
}

const router = express.Router();

/**
 * Work start is the native chat handler behind an alias: the alias attaches the
 * server-owned Work context, then delegates to the native admission chain and
 * the same SSE stream, tools and approval machinery as ordinary chat. Declared
 * before the read routes so it is never matched by the task router.
 */
router.use('/chat', getWorkChatRouter());

/**
 * The Work router is dependency-injected and request-scoped, so it is built per
 * request from the authenticated context rather than cached at module load.
 */
router.use((req, res, next) => createWorkRouter(depsFor(req))(req, res, next));

module.exports = router;
