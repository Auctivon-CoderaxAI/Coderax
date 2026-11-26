import { SystemRoles } from 'coderax-data-provider';
import type { Request } from 'express';

/**
 * Owner authentication is enforced here, on the server, for every gateway route.
 *
 * The browser never holds the engine credential and never addresses the engine
 * directly. A JWT-authenticated session is not enough by itself, and neither is
 * administrative role membership: `SystemRoles.ADMIN` is a grantable role, so an
 * administrator added for a different purpose must not inherit access to the
 * owner's personal AI system. The deployment designates one owner user id, and
 * only that identity — holding a valid session and the owner role — is admitted.
 *
 * Identity is read from the authenticated request only; a body or query
 * `userId` is never consulted.
 */

export type OwnerIdentity = { userId: string; tenantId?: string };

export type OwnerPolicy = {
  /** The deployment's designated owner. Absent or blank fails closed. */
  ownerUserId?: string | null;
};

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

function designatedOwner(policy: OwnerPolicy | undefined): string | null {
  const value = policy?.ownerUserId;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function requireOwner(req: Pick<Request, 'user'>, policy?: OwnerPolicy): OwnerGateResult {
  const ownerUserId = designatedOwner(policy);
  if (ownerUserId == null) {
    return { ok: false, status: 503, code: 'WORKFLOW_ENGINE_OWNER_UNCONFIGURED' };
  }
  const user = req.user as { id?: unknown; role?: unknown; tenantId?: unknown } | undefined;
  if (user == null || typeof user.id !== 'string' || user.id.trim().length === 0) {
    return { ok: false, status: 401, code: 'WORKFLOW_ENGINE_UNAUTHENTICATED' };
  }
  if (user.id.trim() !== ownerUserId) {
    return { ok: false, status: 403, code: 'WORKFLOW_ENGINE_FORBIDDEN' };
  }
  if (user.role !== SystemRoles.ADMIN) {
    return { ok: false, status: 403, code: 'WORKFLOW_ENGINE_FORBIDDEN' };
  }
  return {
    ok: true,
    value: {
      userId: user.id.trim(),
      ...(typeof user.tenantId === 'string' ? { tenantId: user.tenantId } : {}),
    },
  };
}
