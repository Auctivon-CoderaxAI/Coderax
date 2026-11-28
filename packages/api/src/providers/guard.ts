import type { CatalogModel, CatalogSnapshot } from 'coderax-data-provider';

/**
 * Admission is checked when a route is chosen, and again before every request,
 * retry and fallback. Configuration-time filtering cannot carry that weight:
 * a price can appear after the config was built, and a cached snapshot can be
 * older than the provider's own catalogue.
 */

export type RouteBlockReason =
  | 'catalog_stale'
  | 'model_not_in_catalog'
  | 'nonzero_price'
  | 'pricing_unverified'
  | 'account_allowance_unverified'
  | 'model_inactive'
  | 'provider_unavailable'
  | 'model_unavailable';

export type RouteSelection = { provider: string; model: string };

export type RouteAdmission =
  | { allowed: true; model: CatalogModel }
  | { allowed: false; reason: RouteBlockReason; message: string };

/** A snapshot older than this cannot prove that a model is still free. */
export const DEFAULT_MAX_SNAPSHOT_AGE_MS: number = 15 * 60_000;

const REASON_MESSAGES: Record<RouteBlockReason, string> = {
  catalog_stale: 'Provider pricing has not been verified recently enough to prove a $0 route.',
  model_not_in_catalog: 'The selected model is not in the verified provider catalog.',
  nonzero_price: 'The selected model is priced above $0.',
  pricing_unverified: 'The provider publishes no price for this model, so $0 cannot be proven.',
  account_allowance_unverified: 'This model relies on an account allowance that may be metered.',
  model_inactive: 'The provider reports this model as inactive.',
  provider_unavailable: 'The provider for this model is not authenticated or reachable.',
  model_unavailable: 'This model is not available for inference.',
};

function blocked(reason: RouteBlockReason): RouteAdmission {
  return { allowed: false, reason, message: REASON_MESSAGES[reason] };
}

/** Map a catalog eligibility reason onto an admission reason. */
function admissionReasonFor(model: CatalogModel): RouteBlockReason {
  switch (model.reason) {
    case 'nonzero_price':
      return 'nonzero_price';
    case 'pricing_unverified':
      return 'pricing_unverified';
    case 'account_allowance_unverified':
      return 'account_allowance_unverified';
    case 'model_inactive':
      return 'model_inactive';
    case 'credential_missing':
    case 'credential_rejected':
    case 'provider_unreachable':
      return 'provider_unavailable';
    default:
      return 'model_unavailable';
  }
}

/**
 * Decide whether one route may be executed right now. Pure: the caller supplies
 * the snapshot and clock, so a request, a retry and a fallback candidate all get
 * the same answer for the same inputs.
 */
export function checkModelRoute(
  snapshot: CatalogSnapshot,
  selection: RouteSelection,
  options: { now?: number; maxAgeMs?: number } = {},
): RouteAdmission {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_SNAPSHOT_AGE_MS;
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt) || now - generatedAt > maxAgeMs) {
    return blocked('catalog_stale');
  }

  const model = snapshot.models.find(
    (candidate) => candidate.provider === selection.provider && candidate.id === selection.model,
  );
  if (!model) {
    return blocked('model_not_in_catalog');
  }
  if (!model.available) {
    return blocked(admissionReasonFor(model));
  }
  return { allowed: true, model };
}

/** Thrown when a route is refused; `reason` is stable and safe to surface. */
export class ModelRouteBlockedError extends Error {
  readonly reason: RouteBlockReason;

  constructor(reason: RouteBlockReason, message: string) {
    super(message);
    this.name = 'ModelRouteBlockedError';
    this.reason = reason;
  }
}

/**
 * Admission for callers that hold the catalog service rather than a snapshot.
 * Each call re-reads the snapshot, so a retry or a fallback candidate is never
 * admitted on an earlier request's evidence.
 */
export async function admitModelRoute(
  catalog: { snapshot(force?: boolean): Promise<CatalogSnapshot> },
  selection: RouteSelection,
  options: { now?: number; maxAgeMs?: number } = {},
): Promise<CatalogModel> {
  const admission = checkModelRoute(await catalog.snapshot(), selection, options);
  if (!admission.allowed) {
    throw new ModelRouteBlockedError(admission.reason, admission.message);
  }
  return admission.model;
}
