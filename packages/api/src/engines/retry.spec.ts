import type { EngineFailure, EngineFailureCode } from './types';
import {
  DEFAULT_ENGINE_RETRY_POLICY,
  MAX_ENGINE_MAX_ATTEMPTS,
  MAX_ENGINE_RETRY_DELAY_MS,
  canRetryWithin,
  isRetryableStartFailure,
  normalizeEngineRetryPolicy,
} from './retry';

function failure(code: EngineFailureCode, cleanup?: Promise<void>): EngineFailure {
  return {
    ok: false,
    error: { code },
    ...(cleanup ? { cleanup } : {}),
  };
}

describe('normalizeEngineRetryPolicy', () => {
  it('keeps the single attempt that reproduces the previous behavior', () => {
    expect(normalizeEngineRetryPolicy()).toEqual(DEFAULT_ENGINE_RETRY_POLICY);
    expect(normalizeEngineRetryPolicy(null)).toEqual({ maxAttempts: 1, delayMs: 250 });
    expect(normalizeEngineRetryPolicy(undefined)).toEqual({ maxAttempts: 1, delayMs: 250 });
  });

  it('clamps a configured policy into the supported bounds', () => {
    expect(normalizeEngineRetryPolicy({ maxAttempts: 0, delayMs: -5 })).toEqual({
      maxAttempts: 1,
      delayMs: 0,
    });
    expect(normalizeEngineRetryPolicy({ maxAttempts: 99, delayMs: 999_999 })).toEqual({
      maxAttempts: MAX_ENGINE_MAX_ATTEMPTS,
      delayMs: MAX_ENGINE_RETRY_DELAY_MS,
    });
    expect(normalizeEngineRetryPolicy({ maxAttempts: 2.9 })).toEqual({
      maxAttempts: 2,
      delayMs: 250,
    });
  });

  it('ignores a value that is not a finite number', () => {
    expect(
      normalizeEngineRetryPolicy({ maxAttempts: Number.NaN, delayMs: Number.POSITIVE_INFINITY }),
    ).toEqual({
      maxAttempts: 1,
      delayMs: 250,
    });
  });
});

describe('isRetryableStartFailure', () => {
  it.each(['server_unavailable', 'provider_error'] as const)(
    'retries the transient %s failure',
    (code) => {
      expect(isRetryableStartFailure(failure(code))).toBe(true);
    },
  );

  it.each([
    'busy',
    'cancelled',
    'disabled',
    'not_configured',
    'sdk_unavailable',
    'workspace_denied',
    'protocol_error',
    'timeout',
  ] as const)('never retries the %s failure', (code) => {
    expect(isRetryableStartFailure(failure(code))).toBe(false);
  });

  it('does not retry a failure that reached an adapter with cleanup to settle', () => {
    expect(isRetryableStartFailure(failure('server_unavailable', Promise.resolve()))).toBe(false);
  });
});

describe('canRetryWithin', () => {
  it('allows a delay that still fits inside the half of the lease it owns', () => {
    const claimedAt = Date.now();
    expect(canRetryWithin(claimedAt, 0, 30_000)).toBe(true);
    expect(canRetryWithin(claimedAt, 1_000, 30_000)).toBe(true);
  });

  it('refuses a retry that could outlive the lease', () => {
    /** A 5s delay cannot settle inside half of an 8s lease. */
    expect(canRetryWithin(Date.now(), 5_000, 8_000)).toBe(false);
    expect(canRetryWithin(Date.now() - 60_000, 0, 30_000)).toBe(false);
  });
});
