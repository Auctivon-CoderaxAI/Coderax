import { SystemRoles } from 'coderax-data-provider';
import type { Request } from 'express';

/**
 * Owner authentication is enforced here, on the server, for every gateway route.
 *
 * The browser never holds the engine credential and never addresses the engine
 * directly. A JWT-authenticated session is not enough by itself: Coderax is an
 * owner-controlled deployment, so the gateway additionally requires the owner
 * role. Identity is read from the authenticated request only; a body or query
 * `userId` is never consulted.
 */

export type OwnerIdentity = { userId: string; tenantId?: string };

export type OwnerGateResult =
  | { ok: true; value: OwnerIdentity }
  | {
      ok: false;
      status: 401 | 403;
      code: 'WORKFLOW_ENGINE_UNAUTHENTICATED' | 'WORKFLOW_ENGINE_FORBIDDEN';
    };

export function requireOwner(req: Pick<Request, 'user'>): OwnerGateResult {
  const user = req.user as { id?: unknown; role?: unknown; tenantId?: unknown } | undefined;
  if (user == null || typeof user.id !== 'string' || user.id.trim().length === 0) {
    return { ok: false, status: 401, code: 'WORKFLOW_ENGINE_UNAUTHENTICATED' };
  }
  if (user.role !== SystemRoles.ADMIN) {
    return { ok: false, status: 403, code: 'WORKFLOW_ENGINE_FORBIDDEN' };
  }
  return {
    ok: true,
    value: {
      userId: user.id,
      ...(typeof user.tenantId === 'string' ? { tenantId: user.tenantId } : {}),
    },
  };
}
