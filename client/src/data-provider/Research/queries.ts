import { dataService, QueryKeys } from 'coderax-data-provider';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  TResearchCapabilities,
  TResearchDossier,
  TResearchProjectListParams,
  TResearchProjectListResponse,
} from 'coderax-data-provider';
import type {
  QueryObserverResult,
  UseInfiniteQueryOptions,
  UseQueryOptions,
} from '@tanstack/react-query';

export const useResearchProjectsInfiniteQuery = (
  params: TResearchProjectListParams = {},
  config?: UseInfiniteQueryOptions<TResearchProjectListResponse, unknown>,
) => {
  const { search, limit } = params;

  return useInfiniteQuery<TResearchProjectListResponse>(
    [QueryKeys.researchProjects, { search, limit }],
    ({ pageParam }) =>
      dataService.listResearchProjects({
        search,
        limit,
        cursor: pageParam?.toString(),
      }),
    {
      getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
      keepPreviousData: true,
      refetchOnWindowFocus: false,
      ...config,
    },
  );
};

export const useResearchProjectQuery = (
  researchId?: string | null,
  config?: UseQueryOptions<TResearchDossier>,
): QueryObserverResult<TResearchDossier, unknown> => {
  return useQuery<TResearchDossier>(
    [QueryKeys.researchProject, researchId],
    () => dataService.getResearchProjectById(researchId ?? ''),
    {
      enabled: Boolean(researchId),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

export const useResearchCapabilitiesQuery = (
  config?: UseQueryOptions<TResearchCapabilities>,
): QueryObserverResult<TResearchCapabilities, unknown> => {
  return useQuery<TResearchCapabilities>(
    [QueryKeys.researchCapabilities],
    () => dataService.getResearchCapabilities(),
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      ...config,
    },
  );
};
