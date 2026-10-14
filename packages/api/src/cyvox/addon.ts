import express from 'express';
import { SystemRoles } from 'coderax-data-provider';
import type { Request, Response, Router } from 'express';

const resources = {
  readiness: '/api/readiness',
  deployments: '/api/deployment-platform/status',
  deploymentList: '/api/deployment-platform/deployments',
  robot: '/api/robot/status',
  robotDiagnostics: '/api/robot/diagnostics',
  activity: '/api/audit?limit=100',
} as const;

type Resource = keyof typeof resources;

/** Read-only CyVox adapter. Mutating Robot and deployment requests stay in CyVox. */
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
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) return null;
      return url;
    } catch {
      return null;
    }
  })();

  router.get('/:resource', async (req: Request, res: Response) => {
    const resource = req.params.resource as Resource;
    if (!(resource in resources)) {
      res.status(404).json({ code: 'CYVOX_RESOURCE_NOT_FOUND' });
      return;
    }
    if (!target) {
      res.status(503).json({ code: 'CYVOX_NOT_CONFIGURED' });
      return;
    }
    if (
      target.protocol === 'https:' &&
      (!req.user || !('role' in req.user) || req.user.role !== SystemRoles.ADMIN)
    ) {
      res.status(403).json({ code: 'CYVOX_FORBIDDEN' });
      return;
    }
    try {
      const response = await fetch(new URL(resources[resource], target), {
        signal: AbortSignal.timeout(7000),
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });
      if (!response.ok) {
        res.status(502).json({ code: 'CYVOX_UPSTREAM_ERROR' });
        return;
      }
      const body = await response.text();
      if (body.length > 1024 * 1024) {
        res.status(502).json({ code: 'CYVOX_RESPONSE_TOO_LARGE' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.type('json').send(body);
    } catch {
      res.status(503).json({ code: 'CYVOX_UNAVAILABLE' });
    }
  });

  return router;
}
