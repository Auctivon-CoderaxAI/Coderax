const express = require('express');
const { logger } = require('@coderax/data-schemas');
const { createWorkRouter, GenerationJobManager } = require('@coderax/api');
const db = require('~/models');
const { loadModels } = require('~/server/controllers/ModelController');

/** Endpoints whose models run locally and therefore cost nothing per call. */
const LOCAL_ENDPOINTS = new Set(['ollama', 'lmstudio', 'local', 'llamacpp']);

const isLocalEndpoint = (endpoint) => LOCAL_ENDPOINTS.has(String(endpoint).toLowerCase());

/**
 * `loadModels` returns a per-endpoint config object. Work needs a flat list, and
 * local endpoints must carry `local` so the free/local filter keeps them.
 */
function flattenModelConfig(config) {
  const models = [];
  const push = (entry, endpoint) => {
    if (!entry) {
      return;
    }
    if (typeof entry === 'string') {
      models.push({
        id: entry,
        label: entry,
        provider: endpoint,
        ...(isLocalEndpoint(endpoint) ? { local: true } : {}),
      });
      return;
    }
    const id = entry.id ?? entry.model ?? entry.name;
    if (!id) {
      return;
    }
    models.push({
      id: String(id),
      label: String(entry.label ?? entry.name ?? id),
      provider: endpoint,
      ...(isLocalEndpoint(endpoint) ? { local: true } : {}),
      ...(entry.free === true ? { free: true } : {}),
    });
  };

  for (const [endpoint, value] of Object.entries(config ?? {})) {
    if (Array.isArray(value)) {
      value.forEach((entry) => push(entry, endpoint));
    } else {
      push(value, endpoint);
    }
  }
  return models;
}

/** Only persisted Work fields are read; nothing is inferred. */
function toWorkConversation(conversation) {
  if (!conversation) {
    return null;
  }
  return {
    conversationId: String(conversation.conversationId),
    title: conversation.title,
    isWork: conversation.isWork === true,
    workModel: conversation.workModel,
    workState: conversation.workState,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function rowsFromCursor(result) {
  if (Array.isArray(result)) {
    return result;
  }
  return result?.conversations ?? result?.data ?? [];
}

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
      return rowsFromCursor(result).map(toWorkConversation).filter(Boolean);
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
 * The Work router is dependency-injected and request-scoped, so it is built per
 * request from the authenticated context rather than cached at module load.
 */
router.use((req, res, next) => createWorkRouter(depsFor(req))(req, res, next));

module.exports = router;
