import { dataService, QueryKeys } from 'coderax-data-provider';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  GameProjectListParams,
  TGameCapabilities,
  TGameProject,
  TGameProjectListResponse,
} from 'coderax-data-provider';
import type {
  QueryObserverResult,
  UseInfiniteQueryOptions,
  UseQueryOptions,
} from '@tanstack/react-query';

export const useGameProjectsInfiniteQuery = (
  params: GameProjectListParams = {},
  config?: UseInfiniteQueryOptions<TGameProjectListResponse, unknown>,
) => {
  const { search, limit } = params;

  return useInfiniteQuery<TGameProjectListResponse>(
    [QueryKeys.gameProjects, { search, limit }],
    ({ pageParam }) =>
      dataService.listGameProjects({
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

export const useGameProjectQuery = (
  gameId?: string | null,
  config?: UseQueryOptions<TGameProject>,
): QueryObserverResult<TGameProject, unknown> => {
  return useQuery<TGameProject>(
    [QueryKeys.gameProject, gameId],
    () => dataService.getGameProjectById(gameId ?? ''),
    {
      enabled: Boolean(gameId),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

export const useGameCapabilitiesQuery = (
  config?: UseQueryOptions<TGameCapabilities>,
): QueryObserverResult<TGameCapabilities, unknown> => {
  return useQuery<TGameCapabilities>(
    [QueryKeys.gameCapabilities],
    () => dataService.getGameCapabilities(),
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      ...config,
    },
  );
};
