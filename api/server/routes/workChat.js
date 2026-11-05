const express = require('express');
const { logger } = require('@coderax/data-schemas');
const {
  Constants,
  EModelEndpoint,
  PermissionBits,
  ResourceType,
} = require('coderax-data-provider');
const {
  createConfiguredDefaultResolver,
  hasMalformedWorkAgentId,
  resolveWorkAdmission,
  resolveWorkContext,
  selectedWorkAgentId,
  WORK_AUTO_MODEL_ID,
} = require('@coderax/api');
const { flattenModelConfig } = require('./workModels');

/**
 * The deployment's default model, read from the app config Coderax already
 * loads. `req.config` is the app config, and its default-selection data is
 * `modelSpecs.list`: a spec marked `default` is the hard default, and one marked
 * `softDefault` is the fallback. The concrete model id lives on the spec's
 * `preset`, so a spec that only names an agent yields no model id.
 *
 * Returning null is deliberate: it lets the resolver fail with an actionable
 * message instead of guessing.
 */
function resolveConfiguredDefaultModel(config) {
  const specs = config?.modelSpecs?.list;
  if (!Array.isArray(specs)) {
    return null;
  }
  const chosen =
    specs.find((spec) => spec?.default === true) ??
    specs.find((spec) => spec?.softDefault === true);
  const model = chosen?.preset?.model;
  return typeof model === 'string' && model.trim() !== '' ? model.trim() : null;
}

const configuredDefaultFromRequest = createConfiguredDefaultResolver(async (req) => {
  const { getAppConfigOptionsFromUser } = require('@coderax/api');
  const { getAppConfig } = require('~/server/services/Config');
  return getAppConfig(getAppConfigOptionsFromUser(req?.user));
}, resolveConfiguredDefaultModel);

function defaultFindAgent(agentId) {
  return require('~/models').getAgentWithVersionCount({ id: agentId });
}

/** The same VIEW check the native runtime applies before a run reaches another agent. */
function defaultCanViewAgent(req, agent) {
  const { checkPermission } = require('~/server/services/PermissionService');
  if (!req?.user?.id || !agent?._id) {
    return Promise.resolve(false);
  }
  return checkPermission({
    userId: req.user.id,
    role: req.user.role,
    resourceType: ResourceType.AGENT,
    resourceId: agent._id,
    requiredPermission: PermissionBits.VIEW,
  });
}

function defaultAuthorizeAgent(req, res, next) {
  const { canAccessAgentFromBody } = require('~/server/middleware');
  return canAccessAgentFromBody({ requiredPermission: PermissionBits.VIEW })(req, res, next);
}

function selectedAgentAuthorizationMiddleware(authorizeAgent = defaultAuthorizeAgent) {
  return (req, res, next) => {
    if (hasMalformedWorkAgentId(req.body, Constants.EPHEMERAL_AGENT_ID)) {
      return fail(
        res,
        400,
        'WORK_AGENT_ID_INVALID',
        'The selected Work agent identifier is invalid.',
      );
    }
    if (!selectedWorkAgentId(req.body, Constants.EPHEMERAL_AGENT_ID)) {
      return next();
    }
    req.body.endpoint = EModelEndpoint.agents;
    return authorizeAgent(req, res, next);
  };
}

/**
 * A client may ask to start Work, but it may not assert the persisted marker or
 * the model. Those are server-owned, so any claim is dropped before the native
 * handler sees the body.
 */
function stripClientWorkFields(body) {
  if (!body || typeof body !== 'object') {
    return body;
  }
  /** A model spec can replace the model or attach subagents of its own, so Work
   *  never takes one from the client: the server-resolved selection is the run. */
  const {
    isWork: _isWork,
    workModel: _workModel,
    workContext: _workContext,
    spec: _spec,
    ...rest
  } = body;
  return rest;
}

/**
 * Create the Work conversation's row, with its marker, before the native handler
 * runs. The failed-turn save path writes through `~/models` and never sees
 * `req.workContext`, so a first turn that fails before seeding would otherwise
 * persist an ordinary chat row and vanish from Work history. Seeding here makes
 * the marker durable regardless of how the turn ends.
 *
 * Ownership and tenant scope come from the authenticated request, never the
 * body. `saveConvo` scopes its write to `{conversationId, user: userId}`;
 * the tenant marker must be stamped on insert so Work history can find it.
 * Existing rows are never re-stamped, and cross-tenant follow-ups fail closed.
 */
async function seedWorkConversation(req, context, db) {
  const userId = req?.user?.id;
  const conversationId = req?.body?.conversationId;
  if (
    !userId ||
    typeof conversationId !== 'string' ||
    conversationId === '' ||
    conversationId === 'new'
  ) {
    return { seeded: false, reason: 'no_target' };
  }
  /** Resolve the store only when there is a row to verify, so a request with no
   *  target never depends on the app's `~` module aliases. */
  const store = db ?? require('~/models');
  const tenantId = req?.user?.tenantId ?? req?.tenantId ?? null;
  const existing = await store.getConvo(userId, conversationId);
  if (existing && (existing.tenantId ?? null) !== tenantId) {
    return { seeded: false, reason: 'tenant_mismatch' };
  }
  if (existing && existing.isWork !== true) {
    return { seeded: false, reason: 'not_work' };
  }
  if (existing) {
    return { seeded: false, reason: 'exists' };
  }
  const saved = await store.saveConvo(
    { userId, isTemporary: req.body?.isTemporary },
    {
      conversationId,
      isWork: true,
      workModel: context.workModel,
      ...(tenantId === null ? {} : { tenantId }),
    },
    { context: 'api/server/routes/workChat.js - seed Work conversation' },
  );
  /** saveConvo catches storage exceptions and can return { message } or null.
   *  A successful await alone does not establish a persisted, tenant-safe Work row.
   *  Also reject a mismatched row returned after a concurrent conversation write. */
  if (
    !saved ||
    saved.conversationId !== conversationId ||
    saved.isWork !== true ||
    (saved.tenantId ?? null) !== tenantId
  ) {
    throw new Error('Work conversation seed was not verified');
  }
  return { seeded: true };
}

const MESSAGES = {
  WORK_AGENT_ID_INVALID: 'The selected Work agent identifier is invalid.',
  WORK_AGENT_NOT_FOUND: 'The selected Work agent is no longer available. Choose another agent.',
  WORK_AGENT_UNAVAILABLE:
    'Work could not verify the selected agent. Try again, or choose another agent.',
  WORK_MODEL_NOT_ALLOWED:
    'That model is not available for Work. Choose a free or locally served model.',
  WORK_AUTO_UNRESOLVED:
    'Work has no default free or locally served model. Choose a model explicitly, or configure a default that is free or local.',
  WORK_NO_FREE_MODEL:
    'Work needs a free or locally served model. Configure a local model, then try again.',
  WORK_AGENT_GRAPH_NOT_ALLOWED:
    'This agent can hand work to an agent that does not run on a free or locally served model. Choose another agent.',
  WORK_AGENT_GRAPH_TOO_LARGE:
    'This agent coordinates more agents than Work can check. Choose another agent.',
  WORK_ADDED_CONVERSATION_UNSUPPORTED:
    'Work runs one task at a time. Remove the added conversation and try again.',
};

const fail = (res, status, error, message) => res.status(status).json({ error, message });

/**
 * Sets `req.workContext` for the Work alias and nothing else. Exported so the
 * contract can be tested without a live model controller or Mongo.
 */
function workContextMiddleware(
  loadModelsForRequest,
  configuredDefaultModel = configuredDefaultFromRequest,
  seedConversation = seedWorkConversation,
  findAgent = defaultFindAgent,
  canViewAgent = defaultCanViewAgent,
) {
  return async (req, res, next) => {
    try {
      if (hasMalformedWorkAgentId(req.body, Constants.EPHEMERAL_AGENT_ID)) {
        return fail(res, 400, 'WORK_AGENT_ID_INVALID', MESSAGES.WORK_AGENT_ID_INVALID);
      }
      /** A second conversation would run beside the task on a model Work never admitted. */
      if (req.body?.addedConvo != null) {
        return fail(
          res,
          400,
          'WORK_ADDED_CONVERSATION_UNSUPPORTED',
          MESSAGES.WORK_ADDED_CONVERSATION_UNSUPPORTED,
        );
      }
      const config = await loadModelsForRequest(req);
      /** The source may be sync or async; awaiting covers both. A failure to read it
       *  leaves no default, which the resolver reports instead of guessing. */
      let configuredDefault = null;
      try {
        configuredDefault = await configuredDefaultModel(req);
      } catch {
        configuredDefault = null;
      }
      const sources = flattenModelConfig(config);
      const requestedAgentId = selectedWorkAgentId(req.body, Constants.EPHEMERAL_AGENT_ID);
      const admission = await resolveWorkAdmission({
        sources,
        requestedModel: req.body?.model,
        configuredDefaultModel: typeof configuredDefault === 'string' ? configuredDefault : null,
        requestedAgentId,
        findAgent,
        canViewAgent: (agent) => canViewAgent(req, agent),
        graphLimit: req.config?.work?.agentGraphLimit,
        graphConcurrency: req.config?.work?.agentGraphConcurrency,
      });
      if (!admission.ok) {
        if (admission.error === 'WORK_AGENT_UNAVAILABLE') {
          logger.warn('[Work] Failed to read the selected agent graph.');
        }
        const status =
          {
            WORK_AGENT_ID_INVALID: 400,
            WORK_AGENT_NOT_FOUND: 404,
            WORK_AGENT_UNAVAILABLE: 503,
          }[admission.error] ?? 409;
        return fail(res, status, admission.error, MESSAGES[admission.error]);
      }
      const context = admission.context;
      req.workContext = context;
      req.body = stripClientWorkFields(req.body);
      /** A seed/read failure must fail closed. Without the persisted-row read we cannot
       *  verify tenant ownership before the native agent handler runs. */
      try {
        const seedResult = await seedConversation(req, context);
        if (seedResult?.reason === 'tenant_mismatch') {
          return fail(
            res,
            404,
            'WORK_TASK_NOT_FOUND',
            'The requested Work conversation was not found.',
          );
        }
        if (seedResult?.reason === 'not_work') {
          return fail(
            res,
            409,
            'WORK_CONVERSATION_REQUIRED',
            'This conversation belongs to Chat. Start a new Work conversation or open it in Chat.',
          );
        }
      } catch {
        logger.warn('[Work] Could not verify or seed the Work conversation.');
        return fail(
          res,
          503,
          'WORK_CONVERSATION_UNAVAILABLE',
          'Work could not verify the conversation. Try again when storage is available.',
        );
      }
      /**
       * `auto` is a UI choice, never a provider id: the native runner receives
       * the concrete model the server resolved, so the sentinel can never reach
       * a provider or be persisted as a model name.
       */
      if (req.body && typeof req.body === 'object') {
        req.body.model = context.workModel;
        if (requestedAgentId) {
          req.body.endpoint = EModelEndpoint.agents;
          req.body.agent_id = requestedAgentId;
        }
        if (!requestedAgentId && context.workProvider) {
          req.body.endpoint = context.workProvider;
        }
      }
      return next();
    } catch {
      logger.warn('[Work] Model discovery failed for Work alias.');
      return fail(
        res,
        503,
        'WORK_MODELS_UNAVAILABLE',
        'Work could not read the model configuration. Try again, or check the server logs.',
      );
    }
  };
}

/**
 * Send the request into the *mounted* agents router under its `/chat` path.
 *
 * Delegating to the outer router rather than the inner chat handler is what
 * keeps Work on the native admission chain: `checkBan`, `uaParser`,
 * `chatConfigMiddleware` (tenant config), the generation-retry probe and
 * limiters, the configured IP/user limiters, the private-text ingress, PII
 * filtering, moderation and `buildEndpointOption` all run exactly as they do
 * for `/api/agents/chat`, and the same controller, SSE stream, tool
 * permissions and HITL approvals follow.
 *
 * Only the path is rewritten, and it is restored afterwards so downstream
 * logging and error handling see the original request.
 */
function delegateToAgents(agentsRouter) {
  return (req, res, next) => {
    const originalUrl = req.url;
    req.url = '/chat' + (originalUrl === '/' ? '' : originalUrl);
    agentsRouter(req, res, (error) => {
      req.url = originalUrl;
      next(error);
    });
  };
}

/**
 * The Work start path is the existing native chat path, reached through an alias
 * so the server can attach Work context. No second runner, no duplicated stream,
 * and no reimplemented middleware chain.
 */
function createWorkChatRouter({
  loadModelsForRequest,
  configuredDefaultModel,
  seedConversation,
  agentsRouter,
  findAgent,
  authorizeAgent,
  canViewAgent,
} = {}) {
  const router = express.Router();
  router.use(selectedAgentAuthorizationMiddleware(authorizeAgent));
  router.use(
    '/chat',
    workContextMiddleware(
      loadModelsForRequest ??
        ((req) => require('~/server/controllers/ModelController').loadModels(req)),
      configuredDefaultModel,
      seedConversation,
      findAgent,
      canViewAgent,
    ),
  );
  router.use('/chat', delegateToAgents(agentsRouter ?? require('./agents')));
  return router;
}

module.exports = {
  configuredDefaultFromRequest,
  createWorkChatRouter,
  delegateToAgents,
  resolveWorkContext,
  resolveConfiguredDefaultModel,
  stripClientWorkFields,
  workContextMiddleware,
  seedWorkConversation,
  WORK_AUTO_MODEL_ID,
};

/** Lazily built so requiring this module never builds the chat router twice. */
let cached;
module.exports.getWorkChatRouter = (deps = {}) => {
  cached ??= createWorkChatRouter(deps);
  return cached;
};
