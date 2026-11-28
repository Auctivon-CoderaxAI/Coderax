import { useQuery } from '@tanstack/react-query';
import type { ProviderCatalogResponse } from '../provider-status';
import * as dataService from '../data-service';
import { QueryKeys } from '../keys';

/**
 * The catalog changes only when a provider changes, so one cached read per
 * session is enough; a manual refresh invalidates this key.
 */
export const useGetProviderCatalogQuery = (options: { enabled?: boolean } = {}) =>
  useQuery<ProviderCatalogResponse>({
    queryKey: [QueryKeys.providerCatalog],
    queryFn: () => dataService.getProviderCatalog(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: options.enabled ?? true,
  });
