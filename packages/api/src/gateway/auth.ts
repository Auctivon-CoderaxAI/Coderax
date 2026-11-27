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

export type OwnerIdentity = { userId: string };

export type OwnerPolicy = { ownerUserId?: string | null };

export type OwnerGateResult =
  | { ok: true; value: OwnerIdentity }
  | {
      ok: false;
      status: 401 | 403 | 503;
      code:
        | 'WORKFLOW_ENGINE_UNAUTHENTICATED'
        | 'WORKFLOW_ENGINE_FORBIDDEN'
        | 'WORKFLOW_ENGINE_OWNER_UNCONFIGURED';
    };

export function requireOwner(req: Pick<Request, 'user'>, policy?: OwnerPolicy): OwnerGateResult {
  const ownerUserId = typeof policy?.ownerUserId === 'string' ? policy.ownerUserId.trim() : '';
  if (!ownerUserId) {
    return { ok: false, status: 503, code: 'WORKFLOW_ENGINE_OWNER_UNCONFIGURED' };
  }
  const user = req.user as { id?: unknown; role?: unknown; tenantId?: unknown } | undefined;
  // The authenticated session is the only identity source. A caller-supplied
  // userId is not part of this input type and is never consulted.
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  if (userId.length === 0) {
    return { ok: false, status: 401, code: 'WORKFLOW_ENGINE_UNAUTHENTICATED' };
  }
  // A tenant administrator cannot use a deployment-wide engine credential.
  if (user?.role !== SystemRoles.ADMIN || user.tenantId != null || userId !== ownerUserId) {
    return { ok: false, status: 403, code: 'WORKFLOW_ENGINE_FORBIDDEN' };
  }
  return { ok: true, value: { userId } };
}
