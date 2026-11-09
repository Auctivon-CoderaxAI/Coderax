/**
 * Application-level request and token budgets for zero-cost inference.
 *
 * The ledger is the hard stop between a retry storm and a provider's free
 * quota: a request is reserved before it is attempted, and the measured token
 * usage is settled afterwards. Nothing here reads configuration or a clock
 * globally, so a test can drive a day boundary directly.
 */

export type QuotaLimits = {
  requestsPerDay: number;
  tokensPerDay: number;
};

export type QuotaReservation =
  | { ok: true }
  | { ok: false; reason: 'request_budget' | 'token_budget'; resetAt: number };

export type QuotaSnapshotEntry = {
  requestsUsed: number;
  requestsLimit: number;
  tokensUsed: number;
  tokensLimit: number;
  /** Epoch milliseconds when the daily window rolls over. */
  resetAt: number;
};

type QuotaEntry = {
  requests: number;
  tokens: number;
  resetAt: number;
};

export type QuotaLedger = {
  reserve: (id: string, options?: { tokens?: number }) => QuotaReservation;
  settle: (id: string, actualTokens: number, reservedTokens?: number) => void;
  /** Non-consuming read used by routing decisions and the status endpoint. */
  snapshot: (id: string) => QuotaSnapshotEntry;
  snapshotAll: () => Record<string, QuotaSnapshotEntry>;
};

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function createQuotaLedger({
  limits,
  now = Date.now,
}: {
  limits: QuotaLimits;
  now?: () => number;
}): QuotaLedger {
  const entries = new Map<string, QuotaEntry>();

  function ensure(id: string): QuotaEntry {
    const at = now();
    const existing = entries.get(id);
    if (existing && at < existing.resetAt) {
      return existing;
    }
    const fresh: QuotaEntry = { requests: 0, tokens: 0, resetAt: nextUtcMidnight(at) };
    entries.set(id, fresh);
    return fresh;
  }

  function toSnapshot(entry: QuotaEntry): QuotaSnapshotEntry {
    return {
      requestsUsed: entry.requests,
      requestsLimit: limits.requestsPerDay,
      tokensUsed: entry.tokens,
      tokensLimit: limits.tokensPerDay,
      resetAt: entry.resetAt,
    };
  }

  return {
    reserve(id, options = {}) {
      const entry = ensure(id);
      if (entry.requests + 1 > limits.requestsPerDay) {
        return { ok: false, reason: 'request_budget', resetAt: entry.resetAt };
      }
      const requested = options.tokens ?? 0;
      if (!Number.isSafeInteger(requested) || requested < 0) {
        return { ok: false, reason: 'token_budget', resetAt: entry.resetAt };
      }
      if (entry.tokens + requested > limits.tokensPerDay) {
        return { ok: false, reason: 'token_budget', resetAt: entry.resetAt };
      }
      entry.requests += 1;
      entry.tokens += requested;
      return { ok: true };
    },
    settle(id, actualTokens, reservedTokens = 0) {
      const entry = ensure(id);
      if (
        !Number.isSafeInteger(actualTokens) ||
        actualTokens < 0 ||
        !Number.isSafeInteger(reservedTokens) ||
        reservedTokens < 0
      ) {
        throw new RangeError('quota settlement requires non-negative safe integer tokens');
      }
      // A reservation is already counted. Reconcile it with measured usage
      // rather than charging the same tokens twice. An actual overrun stays
      // visible so subsequent requests fail closed.
      entry.tokens = Math.max(0, entry.tokens + actualTokens - reservedTokens);
    },
    snapshot(id) {
      return toSnapshot(ensure(id));
    },
    snapshotAll() {
      return [...entries.keys()].reduce<Record<string, QuotaSnapshotEntry>>((acc, id) => {
        acc[id] = toSnapshot(ensure(id));
        return acc;
      }, {});
    },
  };
}
