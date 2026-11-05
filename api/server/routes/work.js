const { logger } = require('@coderax/data-schemas');
const { PermissionBits } = require('coderax-data-provider');
const {
  createWorkDepsFactory,
  createWorkRouter,
  getAgentListAccess,
  createWorkAgentPageLoader,
  GenerationJobManager,
  persistTerminalWorkState,
  workStateForJobStatus,
} = require('@coderax/api');
const db = require('~/models');
const { loadModels } = require('~/server/controllers/ModelController');
const { findAccessibleResources } = require('~/server/services/PermissionService');
const { hasCapability } = require('~/server/middleware/roles/capabilities');
const {
  flattenModelConfig,
  toWorkConversation,
  rowsFromCursor,
  onlyWorkRows,
} = require('./workModels');
const { getWorkChatRouter, configuredDefaultFromRequest } = require('./workChat');
const { createWorkApiRouter } = require('./workApi');

const listAgentPages = createWorkAgentPageLoader((input) => db.getListAgentsByAccess(input));

/** The native generation record is transient; persist its terminal outcome on
 * the existing owner-scoped Work conversation before the manager deletes it. */
GenerationJobManager.onGenerationSettled((event) => {
  void persistTerminalWorkState(event, db).catch(() => {
    logger.warn('[Work] Could not persist terminal task state.');
  });
});

/** The agent list's own ACL and tenant scope, with the fields Work gates runs by. */
async function listViewableAgents(req) {
  const { accessibleIds } = await getAgentListAccess(req.user, PermissionBits.VIEW, {
    hasCapability,
    findAccessibleResources,
  });

  return listAgentPages({
    accessibleIds,
    tenantId: req.user?.tenantId ?? null,
    limit: 1000,
    includeExecutionConfig: true,
    includeModelConfig: true,
  });
}

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
  projections: { flattenModelConfig, toWorkConversation, rowsFromCursor, onlyWorkRows },
  listAgents: listViewableAgents,
  configuredDefaultModel: configuredDefaultFromRequest,
});

module.exports = createWorkApiRouter({
  chatRouter: getWorkChatRouter({
    findAgent: (agentId) => db.getAgentWithVersionCount({ id: agentId }),
  }),
  createReadRouterForRequest: (req) => createWorkRouter(depsFor(req)),
});
