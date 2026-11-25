const express = require('express');
const { createResearchHandlers } = require('@coderax/api');
const { configMiddleware, requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();
const handlers = createResearchHandlers({
  listResearchProjects: db.listResearchProjects,
  createResearchProject: db.createResearchProject,
  getResearchProject: db.getResearchProject,
  saveResearchProject: db.saveResearchProject,
  deleteResearchProject: db.deleteResearchProject,
});

router.use(requireJwtAuth);
/* The resolved config carries the owner gate, the disabled switch and the
 * evidence limits; the owner check itself lives in the handlers. */
router.use(configMiddleware);
router.get('/capabilities', handlers.getCapabilities);
router.get('/projects', handlers.listProjects);
router.post('/projects', handlers.createProject);
router.get('/projects/:researchId', handlers.getProject);
router.put('/projects/:researchId', handlers.saveProject);
router.delete('/projects/:researchId', handlers.deleteProject);

module.exports = router;
