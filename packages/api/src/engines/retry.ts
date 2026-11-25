import type { EngineFailure } from './types';

/**
 * Bounded, same-engine retry for a run that failed before any side effect.
 *
 * A failure code alone does not prove replay is safe: an OpenCode prompt can
 * fail with `server_unavailable` after the server accepted the task. The
 * adapter that owns the transport is therefore the only party that can say a
 * start never dispatched, and it says so with `error.retryable`. This module
 * requires that explicit flag and rejects a failure that still carries
 * `cleanup`, because cleanup means something reached the engine and must
 * settle first. Deterministic and owner-driven failures are excluded too:
 * retrying a disabled engine, a denied workspace, a busy task or a
 * cancellation would either fail again or override the owner's decision.
 *
 * A retry never changes the engine. Falling back to another engine is an
 * explicit owner choice, never a recovery path.
 */

export type EngineRetryPolicy = {
  /** Total attempts, including the first. 1 disables retries, preserving the pre-retry behavior. */
  maxAttempts: number;
  /** Wait before each retry; unused while maxAttempts is 1. */
  delayMs: number;
};

export const DEFAULT_ENGINE_MAX_ATTEMPTS = 1;
export const DEFAULT_ENGINE_RETRY_DELAY_MS = 250;
/** Bounded so the whole sequence settles well inside one lease TTL. */
export const MAX_ENGINE_MAX_ATTEMPTS = 5;
export const MAX_ENGINE_RETRY_DELAY_MS = 1_000;

export const DEFAULT_ENGINE_RETRY_POLICY: EngineRetryPolicy = {
  maxAttempts: DEFAULT_ENGINE_MAX_ATTEMPTS,
  delayMs: DEFAULT_ENGINE_RETRY_DELAY_MS,
};

/**
 * Transient transport states. Neither describes a decision about the task;
 * the adapter still has to mark the failure as pre-dispatch before it is
 * replayed.
 */
const RETRYABLE_START_CODES = new Set(['server_unavailable', 'provider_error']);

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  const resolved =
    typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, resolved));
}

/** Clamps a configured or caller-supplied policy; an absent policy keeps today's behavior. */
export function normalizeEngineRetryPolicy(
  policy?: Partial<EngineRetryPolicy> | null,
): EngineRetryPolicy {
  return {
    maxAttempts: bounded(
      policy?.maxAttempts,
      DEFAULT_ENGINE_MAX_ATTEMPTS,
      1,
      MAX_ENGINE_MAX_ATTEMPTS,
    ),
    delayMs: bounded(policy?.delayMs, DEFAULT_ENGINE_RETRY_DELAY_MS, 0, MAX_ENGINE_RETRY_DELAY_MS),
  };
}

/**
 * True only for a transient failure an adapter explicitly reported as safe to
 * replay before dispatch, and that left nothing to clean up.
 */
export function isRetryableStartFailure(failure: EngineFailure): boolean {
  return (
    failure.cleanup == null &&
    failure.error.retryable === true &&
    RETRYABLE_START_CODES.has(failure.error.code)
  );
}

/**
 * A retry is only attempted while the claimed lease is comfortably still ours.
 * Another replica may claim a task whose lease expired, so a retry that could
 * outlive the lease would risk two engines running one task.
 */
export function canRetryWithin(claimedAt: number, delayMs: number, leaseTtlMs: number): boolean {
  return Date.now() + delayMs <= claimedAt + Math.floor(leaseTtlMs / 2);
}

export function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
