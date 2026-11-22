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
  createEngineWorkChatHandler,
  createEngineWorkChatPersistence,
  getEngineWorkChatRuntime,
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
const {
  getWorkChatRouter,
  configuredDefaultFromRequest,
  reserveWorkRun,
  releaseWorkRun,
} = require('./workChat');
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

const engineRuntimeFor = (req) => getEngineWorkChatRuntime(req.config?.config);

const depsFor = (req) => {
  const deps = baseDepsFor(req);
  const configuredListModels = deps.listModels;
  deps.listModels = async () => [...(await configuredListModels()), ...freeSourcesFor(req)];
  deps.freeInference = () => describeFreeInferenceCatalog(req.config?.config ?? null, process.env);
  /** An engine run is live state too; fall back to the native job registry. */
  const nativeGetRunState = deps.getRunState;
  deps.getRunState = async (input) =>
    engineRuntimeFor(req).state({
      userId: input.userId,
      tenantId: req.user?.tenantId ?? null,
      conversationId: input.conversationId,
    }) ?? (nativeGetRunState ? nativeGetRunState(input) : null);
  const nativeCancelRun = deps.cancelRun;
  deps.cancelRun = async (input) =>
    (await engineRuntimeFor(req).cancel({
      userId: input.userId,
      tenantId: req.user?.tenantId ?? null,
      conversationId: input.conversationId,
    })) || nativeCancelRun(input);
  return deps;
};

const engineChat = createEngineWorkChatHandler({
  runtimeFor: getEngineWorkChatRuntime,
  reserveRun: reserveWorkRun,
  releaseRun: releaseWorkRun,
  storeFor: (req, engine) =>
    createEngineWorkChatPersistence({
      db,
      userId: req.user?.id,
      tenantId: req.user?.tenantId ?? null,
      isTemporary: req.body?.isTemporary === true,
      interfaceConfig: req.config?.interfaceConfig,
      engine,
    }),
  logger,
});

const workChatRouter = getWorkChatRouter({
  findAgent: (agentId) => db.getAgentWithVersionCount({ id: agentId }),
  freeModelSources: freeSourcesFor,
  engineChat,
});
const chatRouter = express.Router();
chatRouter.use('/chat', strictConfigMiddleware);
chatRouter.use(workChatRouter);

module.exports = createWorkApiRouter({
  chatRouter,
  createReadRouterForRequest: () => {
    const readRouter = express.Router();
    // Task reads and cancellation need the same authenticated YAML/tenant
    // config as chat, so engine runtime lookup and cancellation target the
    // runtime that actually started the run.
    readRouter.use(strictConfigMiddleware);
    readRouter.use((req, res, next) => {
      // The router owns live cooldowns and quota, so it is shared per budget
      // instead of being rebuilt for each request.
      const deps = {
        ...depsFor(req),
        routing: () => getFreeRouterForConfig(req.config?.config).snapshot(),
        engines: () => engineRuntimeFor(req).snapshot(),
      };
      createWorkRouter(deps)(req, res, next);
    });
    return readRouter;
  },
});
