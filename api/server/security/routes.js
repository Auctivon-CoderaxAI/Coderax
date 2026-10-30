import express from 'express';

/**
 * Security Lab routes.
 *
 * Mounted from the existing API server, behind the existing authentication
 * middleware. All dependencies are injected so the router has no hidden
 * coupling to Mongo, Redis or a container runtime.
 *
 *   app.use('/api/security', createSecurityRouter({ service, requireAuth }));
 */
export function createSecurityRouter({ service, requireAuth } = {}) {
  if (!service) throw new Error('createSecurityRouter requires a service');
  const router = express.Router();
  const auth = requireAuth ?? ((req, _res, next) => next());

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const userIdOf = (req) => req.user?.id ?? req.user?._id ?? null;

  router.get('/tools', auth, wrap(async (_req, res) => {
    res.json({ tools: service.listTools() });
  }));

  router.get('/engagements', auth, wrap(async (req, res) => {
    const engagements = await service.repo.listEngagements(userIdOf(req));
    res.json({ engagements });
  }));

  router.post('/engagements', auth, wrap(async (req, res) => {
    const { name, targets, depth, kind } = req.body ?? {};
    if (!['passive', 'active_readonly', 'intrusive'].includes(depth)) {
      return res.status(400).json({ error: 'depth must be passive, active_readonly or intrusive' });
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'targets must be a non-empty array' });
    }
    if (req.body?.authorized !== true) {
      return res.status(400).json({ error: 'authorization acknowledgement is required' });
    }
    const engagement = await service.createEngagement({
      userId: userIdOf(req), name, targets, depth, kind,
    });
    res.status(201).json({ engagement });
  }));

  router.get('/engagements/:id', auth, wrap(async (req, res) => {
    const engagement = await service.requireEngagement(req.params.id, userIdOf(req));
    const [findings, jobs] = await Promise.all([
      service.findings(req.params.id),
      Promise.resolve(service.jobs.list({ engagementId: req.params.id })),
    ]);
    res.json({ engagement, findings, jobs });
  }));

  router.post('/engagements/:id/runs', auth, wrap(async (req, res) => {
    const { toolId, target, approvalId } = req.body ?? {};
    const job = await service.run({
      userId: userIdOf(req), engagementId: req.params.id, toolId, target, approvalId,
    });
    res.status(202).json({ job });
  }));

  router.post('/engagements/:id/approvals', auth, wrap(async (req, res) => {
    const { toolId, target } = req.body ?? {};
    const approval = await service.requestApproval({
      userId: userIdOf(req), engagementId: req.params.id, toolId, target,
    });
    res.status(201).json({ approval });
  }));

  router.post('/engagements/:id/runs/:jobId/cancel', auth, wrap(async (req, res) => {
    const job = await service.cancel({
      userId: userIdOf(req), engagementId: req.params.id, jobId: req.params.jobId,
    });
    res.json({ job });
  }));

  router.get('/engagements/:id/report.:format', auth, wrap(async (req, res) => {
    const format = req.params.format === 'json' ? 'json' : 'md';
    const report = await service.report({
      userId: userIdOf(req), engagementId: req.params.id, format,
    });
    if (format === 'json') return res.json(report);
    res.type('text/markdown').send(report);
  }));

  router.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    res.status(status).json({
      error: status === 500 ? 'Internal error' : err.message,
      code: err.code ?? null,
      requiresApproval: err.requiresApproval ?? false,
    });
  });

  return router;
}

export default createSecurityRouter;
