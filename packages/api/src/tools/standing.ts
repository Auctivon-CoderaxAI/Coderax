import { selectStandingAuthorization } from 'coderax-data-provider';
import type {
  ToolStandingAuthorization,
  ToolStandingAuthorizationDecision,
  ToolStandingAuthorizationRequest,
  ToolStandingAuthorizationScope,
  ToolStandingAuthorizationStorage,
} from 'coderax-data-provider';

/** Bounded like the approval-grant lookup; a slow store must not stall a run. */
const DEFAULT_STANDING_AUTHORIZATION_LOOKUP_TIMEOUT_MS = 3000;

export interface StandingAuthorizationGate {
  /** Optional because older wiring passes only the approval-grant methods. */
  storage?: {
    listToolStandingAuthorizations?: ToolStandingAuthorizationStorage['listToolStandingAuthorizations'];
  };
  scope?: ToolStandingAuthorizationScope;
  timeoutMs?: number;
}

/**
 * Reads the owner's authorizations for this call, bounded and never cached.
 *
 * `null` means the check could not run — missing storage, no scope, a read
 * error or a timeout. Callers must treat that as "no authorization", never as
 * "no restrictions".
 */
export async function loadStandingAuthorizations(
  gate: StandingAuthorizationGate,
): Promise<ToolStandingAuthorization[] | null> {
  const list = gate.storage?.listToolStandingAuthorizations;
  const scope = gate.scope;
  if (typeof list !== 'function' || scope == null) return null;
  const timeoutMs = gate.timeoutMs ?? DEFAULT_STANDING_AUTHORIZATION_LOOKUP_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => list(scope))
        .catch(() => null),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The execution-time half of a standing authorization.
 *
 * The store is read on every invocation, never cached, so revocation and expiry
 * affect the next call and an approval captured earlier cannot revive a grant
 * revoked afterwards. Every failure path denies.
 */
export async function authorizeStandingWork(
  request: ToolStandingAuthorizationRequest,
  gate: StandingAuthorizationGate,
): Promise<ToolStandingAuthorizationDecision> {
  const authorizations = await loadStandingAuthorizations(gate);
  if (authorizations == null) return { allowed: false, reason: 'unavailable' };
  return selectStandingAuthorization(authorizations, request);
}
