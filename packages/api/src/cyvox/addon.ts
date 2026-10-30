import express from 'express';
import { isCyvoxFreeOrLocalModel, isCyvoxThinkingEffort, SystemRoles } from 'coderax-data-provider';
import type { NextFunction, Request, Response, Router } from 'express';
import type { CyvoxTarget } from './settings';
import { resolveCyvoxTarget } from './settings';
import { readBoundedBody } from './response';

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

/** Own-property check: `in` would accept inherited names such as `constructor`. */
function isResource(value: string): value is Resource {
  return Object.prototype.hasOwnProperty.call(resources, value);
}

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

/**
 * Scoped CyVox bridge. The browser only receives bounded JSON; bearer tokens
 * remain server-side. Every remote request needs a Coderax ADMIN identity.
 * Write actions have an explicit allowlist and require a per-action confirmation.
 * CyVox still enforces its own tool, device and approval policies.
 */
export type CyvoxSettingsResolver = () => Promise<CyvoxTarget | null>;

function getTarget(res: Response): CyvoxTarget | null {
  return (res.locals.cyvoxTarget as CyvoxTarget | null | undefined) ?? null;
}

export function createCyvoxAddonRouter(
  baseUrl: string | undefined,
  enabled: boolean,
  authToken?: string,
  resolveSettings?: CyvoxSettingsResolver,
): Router {
  const router = express.Router();
  const staticTarget = resolveCyvoxTarget({ environment: { enabled, baseUrl, authToken } });
  const resolveTarget = resolveSettings ?? (async () => staticTarget);

  /** Resolve once per request so a connection saved in Settings applies without a restart. */
  router.use(async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.cyvoxTarget = await resolveTarget();
    } catch {
      res.locals.cyvoxTarget = null;
    }
    next();
  });

  function allowed(req: Request, res: Response, write = false): boolean {
    const target = getTarget(res);
    if (!target) {
      res.status(503).json({ code: 'CYVOX_NOT_CONFIGURED' });
      return false;
    }
    // The ADMIN boundary is transport-independent: loopback deployments serve the
    // same audit, task and deployment data as remote ones.
    if (!req.user || !('role' in req.user) || req.user.role !== SystemRoles.ADMIN) {
      res.status(403).json({ code: 'CYVOX_FORBIDDEN' });
      return false;
    }
    if (write && req.header('X-CyVox-Confirm') !== 'yes') {
      res.status(428).json({ code: 'CYVOX_CONFIRMATION_REQUIRED' });
      return false;
    }
    return true;
  }

  async function forward(
    res: Response,
    path: string,
    method = 'GET',
    payload?: object,
  ): Promise<void> {
    const target = getTarget(res);
    if (!target) {
      res.status(503).json({ code: 'CYVOX_NOT_CONFIGURED' });
      return;
    }
    try {
      const response = await fetch(new URL(path, target.url), {
        method,
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          ...(target.authToken ? { Authorization: `Bearer ${target.authToken}` } : {}),
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
      const bounded = await readBoundedBody(response);
      if (!bounded.ok) {
        res.status(502).json({ code: 'CYVOX_RESPONSE_TOO_LARGE' });
        return;
      }
      JSON.parse(bounded.body); // Do not forward HTML/error pages as if they were JSON.
      res.setHeader('Cache-Control', 'no-store');
      res.type('json').send(bounded.body);
    } catch {
      res.status(503).json({ code: 'CYVOX_UNAVAILABLE' });
    }
  }

  router.get('/:resource', async (req: Request, res: Response) => {
    const resource = req.params.resource;
    if (!isResource(resource)) {
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
      // Per-task selection travels with the task. It must not call
      // /api/models/select: that writes deployment-global models.json and would
      // change the model for every other tenant sharing this CyVox deployment.
      const selection: { model?: string; thinking_effort?: string } = {};
      if (body.model !== undefined && body.model !== null && body.model !== '') {
        if (
          typeof body.model !== 'string' ||
          body.model.length > 150 ||
          !isCyvoxFreeOrLocalModel(body.model)
        ) {
          res.status(400).json({ code: 'CYVOX_NONFREE_MODEL_REJECTED' });
          return;
        }
        selection.model = body.model;
      }
      if (
        body.thinking_effort !== undefined &&
        body.thinking_effort !== null &&
        body.thinking_effort !== ''
      ) {
        if (
          typeof body.thinking_effort !== 'string' ||
          !isCyvoxThinkingEffort(body.thinking_effort)
        ) {
          res.status(400).json({ code: 'CYVOX_INVALID_THINKING_EFFORT' });
          return;
        }
        selection.thinking_effort = body.thinking_effort;
      }
      await forward(res, '/api/tasks', 'POST', {
        task: body.task.trim(),
        mode,
        max_steps: 15,
        routing_mode: 'FAST',
        ...selection,
      });
    } else if (action === 'startComputerTask') {
      if (typeof body.goal !== 'string' || !body.goal.trim() || body.goal.length > 4000) {
        res.status(400).json({ code: 'CYVOX_INVALID_TASK' });
        return;
      }
      await forward(res, '/api/computer-use/tasks', 'POST', {
        goal: body.goal.trim(),
        max_steps: 15,
      });
    } else if (action === 'selectModel') {
      const model = body.model;
      if (typeof model !== 'string' || model.length > 150 || !isCyvoxFreeOrLocalModel(model)) {
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
    if (
      !isSafeId(taskId) ||
      !isSafeId(approvalId) ||
      !['approve_once', 'deny'].includes(req.body?.decision)
    ) {
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
