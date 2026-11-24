const express = require('express');
const { createGameHandlers } = require('@coderax/api');
const { configMiddleware, requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();
const handlers = createGameHandlers({
  listGameProjects: db.listGameProjects,
  createGameProject: db.createGameProject,
  getGameProject: db.getGameProject,
  updateGameProject: db.updateGameProject,
  saveGameSpec: db.saveGameSpec,
  deleteGameProject: db.deleteGameProject,
});

router.use(requireJwtAuth);
/* Every route needs the resolved config: it carries the owner gate, the
 * disabled switch and the per-owner limits. The owner check itself lives in
 * the handlers, where it is covered by tests. */
router.use(configMiddleware);
router.get('/capabilities', handlers.getCapabilities);
router.get('/projects', handlers.listProjects);
router.post('/projects', handlers.createProject);
router.get('/projects/:gameId', handlers.getProject);
router.patch('/projects/:gameId', handlers.updateProject);
router.delete('/projects/:gameId', handlers.deleteProject);
router.put('/projects/:gameId/spec', handlers.saveSpec);

module.exports = router;
