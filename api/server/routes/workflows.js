const express = require('express');
const { createWorkflowHandlers } = require('@coderax/api');
const { requireJwtAuth } = require('~/server/middleware');
const { abortWorkflowTurn, wakeWorkflowEngine } = require('~/server/services/Workflows');
const { retireAgentTrigger } = require('~/server/services/Agents/triggers');
const { resolveAgentFireAccess } = require('~/server/services/Schedules/access');
const methods = require('~/models');

const router = express.Router();
router.use(requireJwtAuth);

const handlers = createWorkflowHandlers({
  methods,
  // The same full fire-equivalent check schedules use: role AGENTS:USE plus
  // resource VIEW, with manage:agents bypass. A workflow cannot dispatch a turn
  // the chat route would reject.
  canRunAgent: async (agentId, req) => (await resolveAgentFireAccess(agentId, req.user)) === 'ok',
  wake: wakeWorkflowEngine,
  abortActiveRun: abortWorkflowTurn,
  retireQueuedDelivery: (deliveryKey, workflowId) =>
    retireAgentTrigger(deliveryKey, workflowId, 'workflow_cancelled', {
      onlyIfUnclaimed: true,
      sourceType: 'workflow',
    }),
});

const handle = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

router.get('/', handle(handlers.listWorkflows));
router.post('/', handle(handlers.createWorkflow));
router.get('/templates', handle(handlers.listTemplates));

router.get('/runs/:runId', handle(handlers.getRun));
router.get('/runs/:runId/stream', handle(handlers.streamRun));
router.get('/runs/:runId/export', handle(handlers.exportRun));
router.post('/runs/:runId/approve', handle(handlers.approveStep));
router.post('/runs/:runId/pause', handle(handlers.pauseRun));
router.post('/runs/:runId/resume', handle(handlers.resumeRun));
router.post('/runs/:runId/cancel', handle(handlers.cancelRun));

router.get('/:id/runs', handle(handlers.listRuns));
router.post('/:id/runs', handle(handlers.startRun));

router.get('/:id', handle(handlers.getWorkflow));
router.patch('/:id', handle(handlers.updateWorkflow));
router.delete('/:id', handle(handlers.deleteWorkflow));

module.exports = router;
