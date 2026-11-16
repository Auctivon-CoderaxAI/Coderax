const express = require('express');
const { logger } = require('@coderax/data-schemas');
const { strictConfigMiddleware } = require('~/server/middleware/config/app');
const {
  PermissionBits,
  buildFreeInferenceWorkSources,
  describeFreeInferenceCatalog,
} = require('coderax-data-provider');
const {
  createWorkDepsFactory,
  createWorkRouter,
  getAgentListAccess,
  createWorkAgentPageLoader,
  GenerationJobManager,
  persistTerminalWorkState,
  workStateForJobStatus,
  getFreeRouterForConfig,
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
const baseDepsFor = createWorkDepsFactory({
  db,
  jobs: GenerationJobManager,
  loadModels,
  workStateForJobStatus,
  logger,
  projections: { flattenModelConfig, toWorkConversation, rowsFromCursor, onlyWorkRows },
  listAgents: listViewableAgents,
  configuredDefaultModel: configuredDefaultFromRequest,
});

/** Verified free endpoints join the same catalog Work admits runs from, so a
 *  model the picker offers is one the server will actually execute. */
const freeSourcesFor = (req) =>
  buildFreeInferenceWorkSources(req.config?.config ?? null, process.env);

const depsFor = (req) => {
  const deps = baseDepsFor(req);
  const configuredListModels = deps.listModels;
  deps.listModels = async () => [...(await configuredListModels()), ...freeSourcesFor(req)];
  deps.freeInference = () => describeFreeInferenceCatalog(req.config?.config ?? null, process.env);
  return deps;
};

module.exports = createWorkApiRouter({
  chatRouter: getWorkChatRouter({
    findAgent: (agentId) => db.getAgentWithVersionCount({ id: agentId }),
    freeModelSources: freeSourcesFor,
  }),
  createReadRouterForRequest: () => {
    const readRouter = express.Router();
    // Catalog admission needs the authenticated YAML/tenant configuration before
    // depsFor captures graph limits; routing needs it to resolve its budgets.
    // Unrelated task reads/cancellation do not.
    readRouter.use('/agents', strictConfigMiddleware);
    readRouter.use('/routing', strictConfigMiddleware);
    readRouter.use((req, res, next) => {
      // The router owns live cooldowns and quota, so it is shared per budget
      // instead of being rebuilt for each request.
      const deps = {
        ...depsFor(req),
        routing: () => getFreeRouterForConfig(req.config?.config).snapshot(),
      };
      createWorkRouter(deps)(req, res, next);
    });
    return readRouter;
  },
});
