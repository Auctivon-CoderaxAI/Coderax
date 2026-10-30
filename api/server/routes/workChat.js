const express = require('express');
const { logger } = require('@coderax/data-schemas');
const { flattenModelConfig } = require('./workModels');

const WORK_AUTO = 'auto';

/** Work may only ever run on a model that costs nothing per call. */
const isFreeOrLocal = (model) => model.local === true || model.free === true;

/**
 * Decide the concrete model a Work turn runs on, from the server's own model
 * configuration. `auto` is a UI choice only: it resolves here to a concrete
 * free/local model, never to a sentinel, never to a paid gateway model.
 *
 * @returns {{isWork: true, workModel: string} | {error: string}}
 */
function resolveWorkContext(models, requested) {
  const usable = (models ?? []).filter(isFreeOrLocal);
  /** An explicit pick is answered directly: "not allowed" is more actionable than
   * "none configured", and it never degrades into a silent substitution. */
  if (requested && requested !== WORK_AUTO) {
    const match = usable.find((model) => model.id === requested);
    return match ? { isWork: true, workModel: match.id } : { error: 'WORK_MODEL_NOT_ALLOWED' };
  }
  if (usable.length === 0) {
    return { error: 'WORK_NO_FREE_MODEL' };
  }
  const preferred = usable.find((model) => model.local === true) ?? usable[0];
  return { isWork: true, workModel: preferred.id };
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
  const { isWork, workModel, workContext, ...rest } = body;
  return rest;
}

const fail = (res, status, error, message) => res.status(status).json({ error, message });

/**
 * Sets `req.workContext` for the Work alias and nothing else. Exported so the
 * contract can be tested without a live model controller or Mongo.
 */
function workContextMiddleware(loadModelsForRequest) {
  return async (req, res, next) => {
    try {
      const config = await loadModelsForRequest(req);
      const context = resolveWorkContext(flattenModelConfig(config), req.body?.model);
      if (context.error) {
        const message =
          context.error === 'WORK_MODEL_NOT_ALLOWED'
            ? 'That model is not available for Work. Choose a free or locally served model.'
            : 'Work needs a free or locally served model. Configure a local model, then try again.';
        return fail(res, 409, context.error, message);
      }
      req.workContext = context;
      req.body = stripClientWorkFields(req.body);
      return next();
    } catch (error) {
      logger.warn(
        `[Work] Model discovery failed for Work alias: ${error?.message ?? 'unknown error'}`,
      );
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
 * The Work start path is the existing chat handler, reached through an alias so
 * the server can attach Work context. No second runner, no duplicated stream.
 */
function createWorkChatRouter({ loadModelsForRequest } = {}) {
  const router = express.Router();
  router.use(
    workContextMiddleware(
      loadModelsForRequest ??
        ((req) => require('~/server/controllers/ModelController').loadModels(req)),
    ),
  );
  router.use(require('./agents/chat'));
  return router;
}

module.exports = { resolveWorkContext, stripClientWorkFields, workContextMiddleware, WORK_AUTO };

/** Lazily built so requiring this module never builds the chat router twice. */
let cached;
module.exports.getWorkChatRouter = () => {
  cached ??= createWorkChatRouter();
  return cached;
};
