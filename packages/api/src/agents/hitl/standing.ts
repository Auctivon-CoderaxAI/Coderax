import {
  isStandingAuthorizationActive,
  matchesToolPattern,
  selectStandingAuthorization,
} from 'coderax-data-provider';
import type {
  TToolApprovalPolicy,
  ToolStandingAuthorization,
  ToolStandingAuthorizationScope,
} from 'coderax-data-provider';
import type { StandingAuthorizationGate } from '~/tools/standing';
import { loadStandingAuthorizations } from '~/tools/standing';

/** Bounds how much of the approval policy a large set of grants can inflate. */
export const MAX_STANDING_AUTHORIZATION_PATTERNS = 256;

/**
 * Tool patterns this run may treat as already approved.
 *
 * Only grants whose whole scope a run can prove up front qualify. A project- or
 * destination-scoped grant is skipped rather than folded in with its scope
 * dropped: `policy.allow` has no way to express "only in this project", so
 * folding it would auto-approve the same tool elsewhere. Those grants keep
 * prompting until the run can prove scope at the pause site.
 */
export function selectStandingAuthorizationPatterns(
  authorizations: readonly ToolStandingAuthorization[],
  now: number = Date.now(),
): string[] {
  const patterns = new Set<string>();
  for (const authorization of authorizations) {
    if (patterns.size >= MAX_STANDING_AUTHORIZATION_PATTERNS) break;
    if (!isStandingAuthorizationActive(authorization, now)) continue;
    if (authorization.projectId != null || (authorization.destinations?.length ?? 0) > 0) continue;
    for (const pattern of authorization.tools) {
      if (patterns.size >= MAX_STANDING_AUTHORIZATION_PATTERNS) break;
      patterns.add(pattern);
    }
  }
  return Array.from(patterns);
}

/**
 * Folds standing patterns into the policy as `allow` entries, the same seam the
 * conversation's "Always allow" list uses.
 *
 * This is the only way to stop a pause: programmatic hooks fold `deny > ask >
 * allow`, so a hook that answered `allow` could never override the baseline
 * `ask`. The SDK checks `deny` and `ask` before `allow`, so an added pattern
 * still loses to every administrator rule and to any asking hook.
 */
export function applyStandingToolAllows(
  policy: TToolApprovalPolicy | undefined,
  patterns: readonly string[],
): TToolApprovalPolicy | undefined {
  if (policy == null || policy.enabled !== true || policy.mode === 'dontAsk') return policy;
  if (patterns.length === 0) return policy;
  const existing = new Set(policy.allow ?? []);
  const additions = patterns.filter((pattern) => !existing.has(pattern));
  if (additions.length === 0) return policy;
  return { ...policy, allow: [...(policy.allow ?? []), ...additions] };
}

export interface StandingAuthorizationGuard {
  /** Whether this run folded a pattern covering the tool. */
  covers: (toolName: string) => boolean;
  /** Re-reads the owner's grants before the call; throws when none still allow it. */
  assert: (toolName: string) => Promise<void>;
}

export interface StandingAuthorizationRun {
  patterns: string[];
  guard: StandingAuthorizationGuard;
}

const unguarded: StandingAuthorizationGuard = {
  covers: () => false,
  assert: async () => undefined,
};

/**
 * Resolves the grants a run may honor before it starts, and builds the guard
 * that re-verifies them at each covered invocation.
 *
 * Loading once per run keeps the pause decision cheap; the guard's fresh read is
 * what makes revocation and expiry bind a call inside an already-running run.
 */
export async function resolveStandingAuthorizationRun(options: {
  policy?: TToolApprovalPolicy;
  storage?: StandingAuthorizationGate['storage'];
  scope?: ToolStandingAuthorizationScope;
  timeoutMs?: number;
  now?: number;
}): Promise<StandingAuthorizationRun> {
  const policy = options.policy;
  if (policy?.enabled !== true || policy.mode === 'dontAsk') {
    return { patterns: [], guard: unguarded };
  }
  const gate: StandingAuthorizationGate = {
    storage: options.storage,
    scope: options.scope,
    timeoutMs: options.timeoutMs,
  };
  const authorizations = await loadStandingAuthorizations(gate);
  if (authorizations == null) return { patterns: [], guard: unguarded };
  const patterns = selectStandingAuthorizationPatterns(authorizations, options.now);
  if (patterns.length === 0) return { patterns: [], guard: unguarded };
  const covers = (toolName: string): boolean =>
    patterns.some((pattern) => matchesToolPattern(pattern, toolName));
  return {
    patterns,
    guard: {
      covers,
      async assert(toolName) {
        if (!covers(toolName)) return;
        const current = await loadStandingAuthorizations(gate);
        if (current == null) {
          throw new Error(
            'The standing authorization could not be verified. Request approval again.',
          );
        }
        const decision = selectStandingAuthorization(current, { toolName, costUsd: 0 });
        if (!decision.allowed) {
          throw new Error(
            'The standing authorization expired or was revoked. Request approval again.',
          );
        }
      },
    },
  };
}
