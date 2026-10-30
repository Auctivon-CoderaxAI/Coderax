const express = require('express');
const { logger } = require('@coderax/data-schemas');
const {
  buildWorkModelOptions,
  resolveWorkSelection,
  WORK_AUTO_MODEL_ID,
} = require('@coderax/api');
const { flattenModelConfig } = require('./workModels');

/** The app config field that carries the deployment's default model, if any. */
const configuredDefaultFromRequest = (req) => req?.config?.defaultModel ?? null;

/**
 * Resolve the concrete model a Work turn stores and runs on.
 *
 * `auto` is a sentinel, never a model: it resolves through the configured
 * default and only when that exact model is in the offered free/local set.
 * Picking "the first local model" would silently substitute a choice the user
 * did not make, so an absent or paid default fails with an actionable error
 * instead.
 *
 * @returns {{isWork: true, workModel: string} | {error: string}}
 */
function resolveWorkContext(sources, requested, configuredDefault) {
  const options = buildWorkModelOptions(sources);
  const explicit = requested != null && requested !== WORK_AUTO_MODEL_ID;
  const selection = resolveWorkSelection(
    options,
    requested ?? WORK_AUTO_MODEL_ID,
    configuredDefault,
  );
  if (selection.ok) {
    return { isWork: true, workModel: selection.model.id };
  }
  /** An explicit pick is answered specifically, even when nothing is offered. */
  if (explicit) {
    return { error: 'WORK_MODEL_NOT_ALLOWED' };
  }
  if (options.length === 0) {
    return { error: 'WORK_NO_FREE_MODEL' };
  }
  return { error: 'WORK_AUTO_UNRESOLVED' };
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

const MESSAGES = {
  WORK_MODEL_NOT_ALLOWED:
    'That model is not available for Work. Choose a free or locally served model.',
  WORK_AUTO_UNRESOLVED:
    'Work has no default free or locally served model. Choose a model explicitly, or configure a default that is free or local.',
  WORK_NO_FREE_MODEL:
    'Work needs a free or locally served model. Configure a local model, then try again.',
};

const fail = (res, status, error, message) => res.status(status).json({ error, message });

/**
 * Sets `req.workContext` for the Work alias and nothing else. Exported so the
 * contract can be tested without a live model controller or Mongo.
 */
function workContextMiddleware(
  loadModelsForRequest,
  configuredDefaultModel = configuredDefaultFromRequest,
) {
  return async (req, res, next) => {
    try {
      const config = await loadModelsForRequest(req);
      /** The source may be sync or async; awaiting covers both. A failure to read it
       *  leaves no default, which the resolver reports instead of guessing. */
      let configuredDefault = null;
      try {
        configuredDefault = await configuredDefaultModel(req);
      } catch {
        configuredDefault = null;
      }
      const context = resolveWorkContext(
        flattenModelConfig(config),
        req.body?.model,
        typeof configuredDefault === 'string' ? configuredDefault : null,
      );
      if (context.error) {
        return fail(res, 409, context.error, MESSAGES[context.error]);
      }
      req.workContext = context;
      req.body = stripClientWorkFields(req.body);
      /**
       * `auto` is a UI choice, never a provider id: the native runner receives
       * the concrete model the server resolved, so the sentinel can never reach
       * a provider or be persisted as a model name.
       */
      if (req.body && typeof req.body === 'object') {
        req.body.model = context.workModel;
      }
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
function createWorkChatRouter({ loadModelsForRequest, configuredDefaultModel } = {}) {
  const router = express.Router();
  router.use(
    workContextMiddleware(
      loadModelsForRequest ??
        ((req) => require('~/server/controllers/ModelController').loadModels(req)),
      configuredDefaultModel,
    ),
  );
  router.use(require('./agents/chat'));
  return router;
}

module.exports = {
  resolveWorkContext,
  stripClientWorkFields,
  workContextMiddleware,
  WORK_AUTO_MODEL_ID,
};

/** Lazily built so requiring this module never builds the chat router twice. */
let cached;
module.exports.getWorkChatRouter = () => {
  cached ??= createWorkChatRouter();
  return cached;
};
