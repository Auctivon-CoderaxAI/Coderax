const { logger } = require('@coderax/data-schemas');
const {
  createWorkRouter,
  GenerationJobManager,
  persistTerminalWorkState,
  workStateForJobStatus,
} = require('@coderax/api');
const db = require('~/models');
const { loadModels } = require('~/server/controllers/ModelController');
const {
  flattenModelConfig,
  toWorkConversation,
  rowsFromCursor,
  onlyWorkRows,
} = require('./workModels');
const { getWorkChatRouter } = require('./workChat');
const { createWorkApiRouter } = require('./workApi');

/** The native generation record is transient; persist its terminal outcome on
 * the existing owner-scoped Work conversation before the manager deletes it. */
GenerationJobManager.onGenerationSettled((event) => {
  void persistTerminalWorkState(event, db).catch(() => {
    logger.warn('[Work] Could not persist terminal task state.');
  });
});

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
    getRunState: async ({ conversationId }) =>
      workStateForJobStatus(await GenerationJobManager.getJobStatus(conversationId)),
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

module.exports = createWorkApiRouter({
  chatRouter: getWorkChatRouter(),
  createReadRouterForRequest: (req) => createWorkRouter(depsFor(req)),
});
