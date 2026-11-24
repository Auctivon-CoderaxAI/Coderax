import { matchesToolPattern } from './approval';

/** A standing authorization never covers spend; anything above zero denies. */
export const STANDING_AUTHORIZATION_MAX_COST_USD = 0;

/** Longest accepted label, so the owner list stays readable. */
export const STANDING_AUTHORIZATION_MAX_LABEL_LENGTH = 200;

/** Most tool patterns one authorization may carry. */
export const STANDING_AUTHORIZATION_MAX_TOOLS = 64;

/**
 * Owner-declared, pre-reviewed consent for a class of tool calls, so an action
 * the owner already authorized does not need a fresh prompt per step.
 *
 * Every field narrows the grant. A missing scope field means "unscoped for that
 * dimension", and a request that cannot prove it belongs to a scoped grant is
 * denied rather than approved by default.
 */
export interface ToolStandingAuthorization {
  id: string;
  label: string;
  /** Glob patterns matched case-sensitively against the tool name; `*` spans any run. */
  tools: readonly string[];
  /** MCP server or integration destinations; unset authorizes any destination. */
  destinations?: readonly string[];
  /** Project scope; unset authorizes any project. */
  projectId?: string;
  createdAt: number;
  /** Epoch ms after which the grant stops applying. Unset never expires. */
  expiresAt?: number;
  /** Epoch ms at which the owner revoked it. Revocation binds the next call. */
  revokedAt?: number;
  /** Always zero: standing consent cannot authorize a charge. */
  maxCostUsd: number;
}

/** The facts an execution point knows about the call it is about to make. */
export interface ToolStandingAuthorizationRequest {
  toolName: string;
  destination?: string;
  projectId?: string;
  /** Expected spend for the call. Unset means "no charge known". */
  costUsd?: number;
  /** Injectable clock, so expiry is testable and deterministic. */
  now?: number;
}

export type ToolStandingAuthorizationDenialReason =
  | 'revoked'
  | 'expired'
  | 'cost'
  | 'project'
  | 'destination'
  | 'tool';

export type ToolStandingAuthorizationDecision =
  | { allowed: true; authorizationId: string }
  | {
      allowed: false;
      /** `no-match` is an ordinary miss; `unavailable` means the check could not run. */
      reason: ToolStandingAuthorizationDenialReason | 'no-match' | 'unavailable';
    };

export interface ToolStandingAuthorizationScope {
  userId: string;
  tenantId?: string;
}

/** What the owner submits; the store normalizes it and forces the zero ceiling. */
export interface ToolStandingAuthorizationInput {
  label: string;
  tools: readonly string[];
  destinations?: readonly string[];
  projectId?: string;
  expiresAt?: number;
  maxCostUsd?: number;
}

/** Normalized, storage-ready form. */
export interface ToolStandingAuthorizationWrite {
  label: string;
  tools: string[];
  destinations?: string[];
  projectId?: string;
  expiresAt?: number;
  maxCostUsd: number;
}

export type ToolStandingAuthorizationValidation =
  | { ok: true; value: ToolStandingAuthorizationWrite }
  | {
      ok: false;
      error: { code: 'label' | 'tools' | 'destination' | 'cost' | 'expiry'; message: string };
    };

function normalizeList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return Array.from(seen);
}

/**
 * Rejects grants the system cannot enforce. The cost ceiling is not a default:
 * any non-zero ceiling is refused, because the owner's zero-spend rule is a
 * property of the runtime rather than a preference a grant may widen.
 */
export function validateToolStandingAuthorization(
  input: ToolStandingAuthorizationInput,
  now: number = Date.now(),
): ToolStandingAuthorizationValidation {
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (label.length === 0) {
    return {
      ok: false,
      error: { code: 'label', message: 'A standing authorization needs a label.' },
    };
  }
  if (label.length > STANDING_AUTHORIZATION_MAX_LABEL_LENGTH) {
    return {
      ok: false,
      error: { code: 'label', message: 'The label is too long.' },
    };
  }

  const tools = normalizeList(input.tools);
  if (tools.length === 0) {
    return {
      ok: false,
      error: { code: 'tools', message: 'At least one tool pattern is required.' },
    };
  }
  if (tools.length > STANDING_AUTHORIZATION_MAX_TOOLS) {
    return {
      ok: false,
      error: { code: 'tools', message: 'Too many tool patterns in one authorization.' },
    };
  }

  const destinations = normalizeList(input.destinations);
  if ((input.destinations?.length ?? 0) > 0 && destinations.length === 0) {
    return {
      ok: false,
      error: { code: 'destination', message: 'Destinations must be non-empty names.' },
    };
  }

  if (input.maxCostUsd != null && input.maxCostUsd !== STANDING_AUTHORIZATION_MAX_COST_USD) {
    return {
      ok: false,
      error: {
        code: 'cost',
        message: 'A standing authorization cannot cover spending; the ceiling must be zero.',
      },
    };
  }

  if (input.expiresAt != null) {
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= now) {
      return {
        ok: false,
        error: { code: 'expiry', message: 'Expiry must be a future timestamp.' },
      };
    }
  }

  const projectId = input.projectId?.trim();
  return {
    ok: true,
    value: {
      label,
      tools,
      ...(destinations.length > 0 ? { destinations } : {}),
      ...(projectId ? { projectId } : {}),
      ...(input.expiresAt != null ? { expiresAt: input.expiresAt } : {}),
      maxCostUsd: STANDING_AUTHORIZATION_MAX_COST_USD,
    },
  };
}

/**
 * Evaluates one grant against one call. Denials are ordered so the most
 * fundamental reason wins: a revoked or expired grant is never described as a
 * mere scope miss, and spend is refused before any pattern is consulted.
 */
export function evaluateStandingAuthorization(
  authorization: ToolStandingAuthorization,
  request: ToolStandingAuthorizationRequest,
): ToolStandingAuthorizationDecision {
  const now = request.now ?? Date.now();
  if (authorization.revokedAt != null) return { allowed: false, reason: 'revoked' };
  if (authorization.expiresAt != null && now >= authorization.expiresAt) {
    return { allowed: false, reason: 'expired' };
  }
  if (authorization.maxCostUsd !== STANDING_AUTHORIZATION_MAX_COST_USD) {
    return { allowed: false, reason: 'cost' };
  }
  if ((request.costUsd ?? 0) > STANDING_AUTHORIZATION_MAX_COST_USD) {
    return { allowed: false, reason: 'cost' };
  }
  if (authorization.projectId != null && authorization.projectId !== request.projectId) {
    return { allowed: false, reason: 'project' };
  }
  if (
    (authorization.destinations?.length ?? 0) > 0 &&
    (request.destination == null || !authorization.destinations?.includes(request.destination))
  ) {
    return { allowed: false, reason: 'destination' };
  }
  if (!authorization.tools.some((pattern) => matchesToolPattern(pattern, request.toolName))) {
    return { allowed: false, reason: 'tool' };
  }
  return { allowed: true, authorizationId: authorization.id };
}

/** First granting authorization wins; when none grants, report the first denial. */
export function selectStandingAuthorization(
  authorizations: readonly ToolStandingAuthorization[],
  request: ToolStandingAuthorizationRequest,
): ToolStandingAuthorizationDecision {
  let firstDenial: ToolStandingAuthorizationDecision | undefined;
  for (const authorization of authorizations) {
    const decision = evaluateStandingAuthorization(authorization, request);
    if (decision.allowed) return decision;
    firstDenial ??= decision;
  }
  return firstDenial ?? { allowed: false, reason: 'no-match' };
}

/** Storage contract, implemented in `packages/data-schemas` and injected by the caller. */
export interface ToolStandingAuthorizationStorage {
  listToolStandingAuthorizations: (
    scope: ToolStandingAuthorizationScope,
    options?: { includeRevoked?: boolean },
  ) => Promise<ToolStandingAuthorization[]>;
  createToolStandingAuthorization: (
    scope: ToolStandingAuthorizationScope,
    input: ToolStandingAuthorizationInput,
  ) => Promise<
    | { ok: true; value: ToolStandingAuthorization }
    | { ok: false; error: { code: string; message: string } }
  >;
  revokeToolStandingAuthorization: (
    scope: ToolStandingAuthorizationScope,
    id: string,
  ) => Promise<boolean>;
}
