const {
  flattenModelConfig,
  toWorkConversation,
  rowsFromCursor,
  onlyWorkRows,
} = require('./workModels');

/**
 * Request-scoped dependencies for the native Work read/cancel router.
 *
 * Kept free of `~/` aliases, Mongo, and the generation runtime so the owner and
 * tenant checks on cancellation can be tested directly. The route module wires
 * the real store, model loader, and job manager.
 */
function createWorkDepsFactory({
  db,
  jobs,
  loadModels,
  workStateForJobStatus,
  logger,
} = {}) {
  if (
    !db ||
    !jobs ||
    typeof loadModels !== 'function' ||
    typeof workStateForJobStatus !== 'function'
  ) {
    throw new TypeError(
      'createWorkDepsFactory requires db, jobs, loadModels and workStateForJobStatus',
    );
  }

  return function depsFor(req) {
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
        workStateForJobStatus(await jobs.getJobStatus(conversationId)),
      cancelRun: async ({ userId, conversationId }) => {
        const job = await jobs.getJob(conversationId);
        if (!job) {
          return false;
        }
        /**
         * The router already scoped the conversation to this user; this second
         * check uses the job's own owner so a stale or foreign job can never be
         * aborted through a Work request.
         */
        if (job.userId !== userId) {
          logger?.warn?.(`[Work] Refusing to abort another user's generation: ${conversationId}`);
          return false;
        }
        const tenantId = req.user?.tenantId ?? req.tenantId;
        if (tenantId && job.tenantId && job.tenantId !== tenantId) {
          logger?.warn?.(`[Work] Refusing to abort another tenant's generation: ${conversationId}`);
          return false;
        }
        const result = await jobs.abortJob(conversationId, {
          expectedCreatedAt: job.createdAt,
        });
        return result?.success === true;
      },
    };
  };
}

module.exports = { createWorkDepsFactory };
