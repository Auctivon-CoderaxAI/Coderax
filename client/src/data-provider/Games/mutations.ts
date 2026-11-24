import { dataService, QueryKeys } from 'coderax-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TCreateGameProjectRequest,
  TGameProject,
  TSaveGameSpecRequest,
  TUpdateGameProjectRequest,
} from 'coderax-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';

export const useCreateGameProjectMutation = (): UseMutationResult<
  TGameProject,
  unknown,
  TCreateGameProjectRequest,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TCreateGameProjectRequest) => dataService.createGameProject(payload),
    {
      onSuccess: (project) => {
        queryClient.setQueryData([QueryKeys.gameProject, project._id], project);
        queryClient.invalidateQueries([QueryKeys.gameProjects]);
      },
    },
  );
};

export const useUpdateGameProjectMutation = (): UseMutationResult<
  TGameProject,
  unknown,
  TUpdateGameProjectRequest,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TUpdateGameProjectRequest) => dataService.updateGameProject(payload),
    {
      onSuccess: (project) => {
        queryClient.setQueryData([QueryKeys.gameProject, project._id], project);
        queryClient.invalidateQueries([QueryKeys.gameProjects]);
      },
    },
  );
};

/** A stale revision is rejected by the server; refetching shows the newer spec. */
export const useSaveGameSpecMutation = (): UseMutationResult<
  TGameProject,
  unknown,
  TSaveGameSpecRequest,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation((payload: TSaveGameSpecRequest) => dataService.saveGameSpec(payload), {
    onSuccess: (project) => {
      queryClient.setQueryData([QueryKeys.gameProject, project._id], project);
      queryClient.invalidateQueries([QueryKeys.gameProjects]);
    },
    onError: (_error, payload) => {
      queryClient.invalidateQueries([QueryKeys.gameProject, payload.gameId]);
    },
  });
};

export const useDeleteGameProjectMutation = (): UseMutationResult<
  { deleted: boolean },
  unknown,
  string,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation((gameId: string) => dataService.deleteGameProject(gameId), {
    onSuccess: (_result, gameId) => {
      queryClient.removeQueries([QueryKeys.gameProject, gameId]);
      queryClient.invalidateQueries([QueryKeys.gameProjects]);
    },
  });
};
