/** Client view of the provider catalog served by `GET /api/providers`. */

export type ProviderCatalogAuthentication =
  | 'authenticated'
  | 'rejected'
  | 'not_attempted'
  | 'unreachable';

export type ProviderCatalogStatus = {
  provider: string;
  label: string;
  credential: { configured: boolean; env: string | null; legacy: boolean };
  authentication: ProviderCatalogAuthentication;
  modelsDiscovered: number;
  modelsEligible: number;
  blockedReasons: Record<string, number>;
};

export type ProviderCatalogModel = {
  provider: string;
  providerLabel: string;
  id: string;
  label: string;
  contextTokens: number | null;
  pricing: {
    promptPerToken: number | null;
    completionPerToken: number | null;
    free: boolean | null;
    basis: 'per-model' | 'account-plan' | 'unknown';
  };
  capabilities: {
    streaming: boolean | null;
    reasoning: boolean | null;
    tools: boolean | null;
    structuredOutputs: boolean | null;
  };
  available: boolean;
  reason: string;
  chat: boolean;
  work: boolean;
};

export type ProviderCatalogResponse = {
  generatedAt: string;
  counts: {
    providers: number;
    discoveredProviders: number;
    models: number;
    availableModels: number;
    workModels: number;
  };
  providers: ProviderCatalogStatus[];
  models: ProviderCatalogModel[];
};

export type ProviderCatalogFilter = 'all' | 'free' | 'available' | 'reasoning' | 'tools' | 'work';

export const PROVIDER_CATALOG_FILTERS: readonly ProviderCatalogFilter[] = [
  'all',
  'free',
  'available',
  'reasoning',
  'tools',
  'work',
];

/** Apply one selector filter to a catalog model. */
export function matchesProviderFilter(
  model: ProviderCatalogModel,
  filter: ProviderCatalogFilter,
): boolean {
  switch (filter) {
    case 'free':
      return model.available && model.pricing.free === true;
    case 'available':
      return model.available;
    case 'reasoning':
      return model.capabilities.reasoning === true;
    case 'tools':
      return model.capabilities.tools === true;
    case 'work':
      return model.work;
    default:
      return true;
  }
}
