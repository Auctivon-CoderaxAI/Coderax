import express from 'express';
import { SystemRoles } from 'coderax-data-provider';
import type { Request, Response, Router } from 'express';

const resources = {
  readiness: '/api/readiness',
  deployments: '/api/deployment-platform/status',
  deploymentList: '/api/deployment-platform/deployments',
  robot: '/api/robot/status',
  robotDiagnostics: '/api/robot/diagnostics',
  robotEvidence: '/api/robot/evidence',
  activity: '/api/audit?limit=100',
  models: '/api/models',
  tasks: '/api/tasks',
  computerTasks: '/api/computer-use/tasks',
  computerStatus: '/api/computer-use/status',
} as const;

type Resource = keyof typeof resources;

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

/**
 * Scoped CyVox bridge. The browser only receives bounded JSON; bearer tokens
 * remain server-side. Every remote request needs a Coderax ADMIN identity.
 * Write actions have an explicit allowlist and require a per-action confirmation.
 * CyVox still enforces its own tool, device and approval policies.
 */
export function createCyvoxAddonRouter(
  baseUrl: string | undefined,
  enabled: boolean,
  authToken?: string,
): Router {
  const router = express.Router();
  const target = (() => {
    if (!enabled || !baseUrl) return null;
    try {
      const url = new URL(baseUrl);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        (loopback ? url.protocol !== 'http:' : url.protocol !== 'https:' || !authToken) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash
      ) return null;
      return url;
    } catch {
      return null;
    }
  })();

  function allowed(req: Request, res: Response, write = false): boolean {
    if (!target) {
      res.status(503).json({ code: 'CYVOX_NOT_CONFIGURED' });
      return false;
    }
    if (
      (write || target.protocol === 'https:') &&
      (!req.user || !('role' in req.user) || req.user.role !== SystemRoles.ADMIN)
    ) {
      res.status(403).json({ code: 'CYVOX_FORBIDDEN' });
      return false;
    }
    if (write && req.header('X-CyVox-Confirm') !== 'yes') {
      res.status(428).json({ code: 'CYVOX_CONFIRMATION_REQUIRED' });
      return false;
    }
    return true;
  }

  async function forward(res: Response, path: string, method = 'GET', payload?: object): Promise<void> {
    try {
      const response = await fetch(new URL(path, target!), {
        method,
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (!response.ok) {
        res.status(502).json({ code: 'CYVOX_UPSTREAM_ERROR', status: response.status });
        return;
      }
      if (!(response.headers.get('Content-Type') ?? '').includes('application/json')) {
        res.status(502).json({ code: 'CYVOX_INVALID_RESPONSE' });
        return;
      }
      const body = await response.text();
      if (body.length > 1024 * 1024) {
        res.status(502).json({ code: 'CYVOX_RESPONSE_TOO_LARGE' });
        return;
      }
      JSON.parse(body); // Do not forward HTML/error pages as if they were JSON.
      res.setHeader('Cache-Control', 'no-store');
      res.type('json').send(body);
    } catch {
      res.status(503).json({ code: 'CYVOX_UNAVAILABLE' });
    }
  }

  router.get('/:resource', async (req: Request, res: Response) => {
    const resource = req.params.resource as Resource;
    if (!(resource in resources)) {
      res.status(404).json({ code: 'CYVOX_RESOURCE_NOT_FOUND' });
      return;
    }
    if (!allowed(req, res)) return;
    await forward(res, resources[resource]);
  });

  router.get('/tasks/:taskId/approvals', async (req: Request, res: Response) => {
    if (!allowed(req, res)) return;
    if (!isSafeId(req.params.taskId)) {
      res.status(400).json({ code: 'CYVOX_INVALID_ID' });
      return;
    }
    await forward(res, `/api/tasks/${req.params.taskId}/approvals`);
  });

  router.post('/actions/:action', async (req: Request, res: Response) => {
    if (!allowed(req, res, true)) return;
    const body = req.body ?? {};
    const action = req.params.action;
    if (action === 'robotStop') {
      await forward(res, '/api/robot/stop', 'POST');
    } else if (action === 'robotGiveBack') {
      await forward(res, '/api/robot/give-control-back', 'POST');
    } else if (action === 'startTask') {
      if (typeof body.task !== 'string' || !body.task.trim() || body.task.length > 4000) {
        res.status(400).json({ code: 'CYVOX_INVALID_TASK' });
        return;
      }
      const mode = body.mode === 'Coding Team' ? 'Coding Team' : 'Autonomous Run';
      await forward(res, '/api/tasks', 'POST', {
        task: body.task.trim(), mode, max_steps: 15, routing_mode: 'AUTO',
      });
    } else if (action === 'startComputerTask') {
      if (typeof body.goal !== 'string' || !body.goal.trim() || body.goal.length > 4000) {
        res.status(400).json({ code: 'CYVOX_INVALID_TASK' });
        return;
      }
      await forward(res, '/api/computer-use/tasks', 'POST', {
        goal: body.goal.trim(), max_steps: 15,
      });
    } else if (action === 'selectModel') {
      const model = body.model;
      // Free-provider and local models only. A billed remote SKU must not
      // become reachable just because someone can submit a forged POST.
      if (
        typeof model !== 'string' || model.length > 150 ||
        !(model === 'cyvox/auto' || model === 'openrouter/free' ||
          model.endsWith(':free') || /^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$/.test(model))
      ) {
        res.status(400).json({ code: 'CYVOX_NONFREE_MODEL_REJECTED' });
        return;
      }
      await forward(res, '/api/models/select', 'POST', { chat_model: model, agent_model: model });
    } else {
      res.status(404).json({ code: 'CYVOX_ACTION_NOT_FOUND' });
    }
  });

  router.post('/tasks/:taskId/approvals/:approvalId', async (req: Request, res: Response) => {
    if (!allowed(req, res, true)) return;
    const { taskId, approvalId } = req.params;
    if (!isSafeId(taskId) || !isSafeId(approvalId) ||
        !['approve_once', 'deny'].includes(req.body?.decision)) {
      res.status(400).json({ code: 'CYVOX_INVALID_APPROVAL' });
      return;
    }
    await forward(res, `/api/tasks/${taskId}/approvals/${approvalId}`, 'POST', {
      decision: req.body.decision,
    });
  });

  router.post('/tasks/:taskId/cancel', async (req: Request, res: Response) => {
    if (!allowed(req, res, true)) return;
    if (!isSafeId(req.params.taskId)) {
      res.status(400).json({ code: 'CYVOX_INVALID_ID' });
      return;
    }
    await forward(res, `/api/tasks/${req.params.taskId}/cancel`, 'POST');
  });

  router.post('/computerTasks/:taskId/:operation', async (req: Request, res: Response) => {
    if (!allowed(req, res, true)) return;
    const { taskId, operation } = req.params;
    if (!isSafeId(taskId) || !['pause', 'resume', 'stop'].includes(operation)) {
      res.status(400).json({ code: 'CYVOX_INVALID_ACTION' });
      return;
    }
    await forward(res, `/api/computer-use/tasks/${taskId}/${operation}`, 'POST');
  });
  return router;
}
