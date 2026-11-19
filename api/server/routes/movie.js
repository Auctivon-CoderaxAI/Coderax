const express = require('express');
const {
  createMovieHandlers,
  createNeonFrameClient,
  neonFrameConfigFromEnv,
} = require('@coderax/api');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();
const handlers = createMovieHandlers({
  ...db,
  createClient: () => createNeonFrameClient(neonFrameConfigFromEnv()),
});

router.use(requireJwtAuth);

router.get('/status', handlers.serviceStatus);
router.post('/seed', handlers.seedProject);
router.get('/:projectId/status', handlers.productionStatus);
router.post('/:projectId/scenes/:sceneId/plan', handlers.planScene);
router.post('/:projectId/scenes/:sceneId/audio-plan', handlers.audioPlan);
router.post('/:projectId/scenes/:sceneId/shots/:shotId/generate', handlers.generateShot);
router.post('/:projectId/scenes/:sceneId/shots/:shotId/review', handlers.reviewShot);
router.post('/:projectId/assembly-plan', handlers.assemblyPlan);
router.get('/:projectId', handlers.getProject);
router.patch('/:projectId', handlers.updateProject);
router.delete('/:projectId', handlers.deleteProject);
router.get('/', handlers.listProjects);
router.post('/', handlers.createProject);

module.exports = router;
