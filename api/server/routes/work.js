const { logger } = require('@coderax/data-schemas');
const {
  createWorkRouter,
  GenerationJobManager,
  persistTerminalWorkState,
  workStateForJobStatus,
} = require('@coderax/api');
const db = require('~/models');
const { loadModels } = require('~/server/controllers/ModelController');
const { createWorkDepsFactory } = require('./workDeps');
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
const depsFor = createWorkDepsFactory({
  db,
  jobs: GenerationJobManager,
  loadModels,
  workStateForJobStatus,
  logger,
});

module.exports = createWorkApiRouter({
  chatRouter: getWorkChatRouter({
    findAgent: (agentId) => db.getAgentWithVersionCount({ id: agentId }),
  }),
  createReadRouterForRequest: (req) => createWorkRouter(depsFor(req)),
});
