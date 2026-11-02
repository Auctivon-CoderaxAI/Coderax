const express = require('express');

/**
 * Compose the Work chat alias with its request-scoped read API.
 *
 * The chat router owns the /chat path. Mount it at the Work API root so its
 * endpoint is /api/work/chat, then pass unmatched requests to the read routes.
 */
function createWorkApiRouter({ chatRouter, createReadRouterForRequest }) {
  if (typeof chatRouter !== 'function') {
    throw new TypeError('createWorkApiRouter requires a chat router');
  }
  if (typeof createReadRouterForRequest !== 'function') {
    throw new TypeError('createWorkApiRouter requires a read-router factory');
  }

  const router = express.Router();
  router.use(chatRouter);
  router.use((req, res, next) => createReadRouterForRequest(req)(req, res, next));
  return router;
}

module.exports = { createWorkApiRouter };
