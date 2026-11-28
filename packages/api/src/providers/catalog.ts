import { ModelCatalog, filterModels, planModelFallback } from 'coderax-data-provider';
import type {
  CatalogFetch,
  CatalogFilter,
  CatalogModel,
  CatalogSnapshot,
} from 'coderax-data-provider';

/**
 * Runtime view of the provider catalog.
 *
 * Discovery is expensive and provider outages are routine, so the ecosystem is
 * read through one cached snapshot. Startup never waits for a provider: the
 * first request serves the cached catalog, a failed refresh keeps the last good
 * snapshot, and only a cold start with no snapshot can fail.
 */

export type ProviderAuthentication =
  | 'authenticated'
  | 'rejected'
  | 'not_attempted'
  | 'unreachable';

export type ProviderStatus = {
  provider: string;
  label: string;
  credential: { configured: boolean; env: string | null; legacy: boolean };
  authentication: ProviderAuthentication;
  modelsDiscovered: number;
  modelsEligible: number;
  /** How many discovered models are blocked, by exact reason. */
  blockedReasons: Record<string, number>;
};

export type CatalogReport = {
  generatedAt: string;
  counts: CatalogSnapshot['counts'];
  providers: ProviderStatus[];
  models: CatalogModel[];
};

function authenticationFor(status: CatalogSnapshot['providers'][number]['status']): ProviderAuthentication {
  switch (status) {
    case 'ok':
      return 'authenticated';
    case 'credential_rejected':
      return 'rejected';
    case 'credential_missing':
      return 'not_attempted';
    default:
      return 'unreachable';
  }
}

/** Project a snapshot into per-provider status without exposing any credential value. */
export function catalogReport(snapshot: CatalogSnapshot): CatalogReport {
  const providers = snapshot.providers.map((discovery): ProviderStatus => {
    const models = snapshot.models.filter((model) => model.provider === discovery.provider);
    const blockedReasons: Record<string, number> = {};
    for (const model of models) {
      if (!model.available) {
        blockedReasons[model.reason] = (blockedReasons[model.reason] ?? 0) + 1;
      }
    }
    return {
      provider: discovery.provider,
      label: discovery.label,
      credential: {
        configured: discovery.credential.status === 'present',
        env: discovery.credential.env,
        legacy: discovery.credential.legacy,
      },
      authentication: authenticationFor(discovery.status),
      modelsDiscovered: models.length,
      modelsEligible: models.filter((model) => model.available).length,
      blockedReasons,
    };
  });

  return {
    generatedAt: snapshot.generatedAt,
    counts: snapshot.counts,
    providers,
    models: snapshot.models,
  };
}

export type CreateProviderCatalogOptions = {
  env?: Record<string, string | undefined>;
  fetch?: CatalogFetch;
  now?: () => number;
  ttlMs?: number;
};

export type ProviderCatalogService = {
  snapshot(force?: boolean): Promise<CatalogSnapshot>;
  report(): Promise<CatalogReport>;
  refresh(): Promise<CatalogReport>;
  models(filter?: CatalogFilter): Promise<CatalogModel[]>;
  select(options: { mode: 'chat' | 'work'; preferredModelId?: string }): Promise<CatalogModel[]>;
};

/** One cached catalog per process; the service adds the report projection. */
export function createProviderCatalog(
  options: CreateProviderCatalogOptions = {},
): ProviderCatalogService {
  const catalog = new ModelCatalog({
    env: options.env,
    fetch: options.fetch,
    ttlMs: options.ttlMs,
    now: options.now,
  });

  return {
    async snapshot(force = false) {
      return force ? catalog.refresh() : catalog.ensureFresh();
    },
    async report() {
      return catalogReport(await catalog.ensureFresh());
    },
    async refresh() {
      return catalogReport(await catalog.refresh());
    },
    async models(filter = {}) {
      return filterModels((await catalog.ensureFresh()).models, filter);
    },
    async select({ mode, preferredModelId }) {
      return planModelFallback((await catalog.ensureFresh()).models, { mode, preferredModelId });
    },
  };
}
