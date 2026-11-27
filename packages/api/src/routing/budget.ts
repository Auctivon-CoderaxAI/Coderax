import { FREE_ENDPOINTS } from 'coderax-data-provider';
import type { QuotaLedger, QuotaSnapshotEntry } from './quota';
import type { FreeInferenceConfigLike } from './limits';
import { getSharedQuotaLedger, resolveFreeRoutingLimits } from './limits';

/**
 * Daily budget for hosted free inference, enforced at the transport.
 *
 * The routing planner already owns a ledger, but native Work sends its turns
 * through the OpenAI-compatible transport, not through that planner. Without
 * this adapter `freeInference.maxRequestsPerDay` and `maxTokensPerDay` would be
 * configured and displayed while real requests were never debited. The budget
 * debits the same shared ledger the status endpoint reads, so a request that
 * would exceed the day's allowance fails before any provider call.
 */

export type FreeInferenceBudgetDenial = 'request_budget' | 'token_budget';

export type FreeInferenceAdmission =
  | { ok: true; reservedTokens: number; resetAt: number }
  | { ok: false; reason: FreeInferenceBudgetDenial; resetAt: number };

export type FreeInferenceBudget = {
  modelId: string;
  /** Reserve one request and the prompt's estimated tokens before a provider call. */
  admit: (estimatedTokens: number) => FreeInferenceAdmission;
  /** Reconcile the reservation with measured usage; unknown usage keeps it reserved. */
  settle: (actualTokens: number, reservedTokens: number, resetAt: number) => void;
  snapshot: () => QuotaSnapshotEntry;
};

export class FreeInferenceBudgetExceededError extends Error {
  constructor(readonly reason: FreeInferenceBudgetDenial) {
    super('The free inference daily budget is exhausted; no paid provider was used.');
    this.name = 'FreeInferenceBudgetExceededError';
  }
}

/**
 * All free models on one provider account share its quota group, so a model
 * alias cannot be used to spend a separate allowance.
 */
export function freeInferenceQuotaKey(modelId: string): string {
  const endpoint = FREE_ENDPOINTS.find((entry) => entry.modelId === modelId);
  return endpoint?.quotaGroup ?? endpoint?.id ?? 'free-inference';
}

function normalizeTokens(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function createFreeInferenceBudget({
  config,
  modelId,
  ledger,
  now,
}: {
  config: FreeInferenceConfigLike;
  modelId: string;
  /** Test/explicit ledger; production defaults to the shared deployment ledger. */
  ledger?: QuotaLedger;
  now?: () => number;
}): FreeInferenceBudget | undefined {
  const id = modelId.trim();
  if (!id) {
    return undefined;
  }
  const limits = resolveFreeRoutingLimits(config);
  const quota = ledger ?? getSharedQuotaLedger(limits, now);
  const key = freeInferenceQuotaKey(id);

  return {
    modelId: id,
    admit(estimatedTokens) {
      const tokens = normalizeTokens(estimatedTokens);
      const reservation = quota.reserve(key, { tokens });
      if (!reservation.ok) {
        return { ok: false, reason: reservation.reason, resetAt: reservation.resetAt };
      }
      return { ok: true, reservedTokens: tokens, resetAt: reservation.resetAt };
    },
    settle(actualTokens, reservedTokens, resetAt) {
      quota.settle(key, normalizeTokens(actualTokens), reservedTokens, resetAt);
    },
    snapshot: () => quota.snapshot(key),
  };
}
