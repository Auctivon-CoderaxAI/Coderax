import { CATALOG_PROVIDERS } from 'coderax-data-provider';
import type { CatalogSnapshot } from 'coderax-data-provider';

/**
 * Turn discovered, eligible models into ordinary custom endpoints.
 *
 * The model picker lists configured endpoints and the native runner executes
 * the endpoint named by a request, so both must read the same object. Building
 * the endpoints from the catalog snapshot keeps selection and execution in
 * agreement, and the credential stays a server-side environment reference.
 */

export type CatalogCustomEndpoint = {
  name: string;
  baseURL: string;
  apiKey: string;
  modelDisplayLabel: string;
  models: { default: string[] };
  titleConvo: false;
};

/**
 * Only models that are both eligible (`available`) and usable in Chat become
 * endpoint entries. A billable or unverified-price model never reaches the
 * runner, so selecting it cannot produce a request to a provider.
 */
export function buildCatalogCustomEndpoints(
  snapshot: CatalogSnapshot | null,
): CatalogCustomEndpoint[] {
  if (!snapshot) {
    return [];
  }

  return CATALOG_PROVIDERS.flatMap((provider) => {
    const models = snapshot.models.filter(
      (model) => model.provider === provider.id && model.available && model.chat,
    );
    if (models.length === 0) {
      return [];
    }
    return [
      {
        name: provider.label,
        baseURL: provider.baseURL,
        apiKey: '${' + provider.apiKeyEnv + '}',
        modelDisplayLabel: provider.label,
        models: { default: models.map((model) => model.id) },
        titleConvo: false,
      },
    ];
  });
}

/**
 * Merge the discovered endpoints into a deployment config. An endpoint the
 * operator already configured wins, so this never relabels or replaces one.
 */
export function mergeCatalogCustomEndpoints<T extends { endpoints?: Record<string, unknown> | null }>(
  config: T,
  snapshot: CatalogSnapshot | null,
): T {
  const additions = buildCatalogCustomEndpoints(snapshot);
  if (additions.length === 0) {
    return config;
  }
  const endpoints = (config.endpoints ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(endpoints.custom)
    ? (endpoints.custom as Array<{ name?: string }>)
    : [];
  const existingNames = new Set(existing.map((entry) => entry.name));
  const merged = [...existing, ...additions.filter((entry) => !existingNames.has(entry.name))];
  if (merged.length === existing.length) {
    return config;
  }
  return { ...config, endpoints: { ...endpoints, custom: merged } } as T;
}
