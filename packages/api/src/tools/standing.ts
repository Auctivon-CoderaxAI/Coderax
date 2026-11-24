import { selectStandingAuthorization } from 'coderax-data-provider';
import type {
  ToolStandingAuthorizationDecision,
  ToolStandingAuthorizationRequest,
  ToolStandingAuthorizationScope,
  ToolStandingAuthorizationStorage,
} from 'coderax-data-provider';

/** Bounded like the approval-grant lookup; a slow store must not stall a run. */
export const DEFAULT_STANDING_AUTHORIZATION_LOOKUP_TIMEOUT_MS = 3000;

export interface StandingAuthorizationGate {
  storage?: Pick<ToolStandingAuthorizationStorage, 'listToolStandingAuthorizations'>;
  scope?: ToolStandingAuthorizationScope;
  timeoutMs?: number;
}

/**
 * The execution-time half of a standing authorization.
 *
 * The store is read on every invocation, never cached, so revocation and expiry
 * affect the next call and an approval captured earlier cannot revive a grant
 * revoked afterwards. Every failure path denies: missing storage, a slow read
 * and a rejected read all leave the call needing ordinary review.
 */
export async function authorizeStandingWork(
  request: ToolStandingAuthorizationRequest,
  gate: StandingAuthorizationGate,
): Promise<ToolStandingAuthorizationDecision> {
  if (!gate.storage || !gate.scope) return { allowed: false, reason: 'unavailable' };
  const timeoutMs = gate.timeoutMs ?? DEFAULT_STANDING_AUTHORIZATION_LOOKUP_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const authorizations = await Promise.race([
      gate.storage.listToolStandingAuthorizations(gate.scope).catch(() => null),
      timedOut,
    ]);
    if (authorizations == null) return { allowed: false, reason: 'unavailable' };
    return selectStandingAuthorization(authorizations, request);
  } finally {
    clearTimeout(timer);
  }
}
