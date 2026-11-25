import { dataService, QueryKeys } from 'coderax-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TCreateResearchProjectRequest,
  TResearchDossier,
  TSaveResearchProjectRequest,
} from 'coderax-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';

export const useCreateResearchProjectMutation = (): UseMutationResult<
  TResearchDossier,
  unknown,
  TCreateResearchProjectRequest,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TCreateResearchProjectRequest) => dataService.createResearchProject(payload),
    {
      onSuccess: (project) => {
        queryClient.setQueryData([QueryKeys.researchProject, project._id], project);
        queryClient.invalidateQueries([QueryKeys.researchProjects]);
      },
    },
  );
};

/** A stale revision is rejected by the server; refetching shows the newer ledger. */
export const useSaveResearchProjectMutation = (): UseMutationResult<
  TResearchDossier,
  unknown,
  TSaveResearchProjectRequest,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TSaveResearchProjectRequest) => dataService.saveResearchProject(payload),
    {
      onSuccess: (project) => {
        queryClient.setQueryData([QueryKeys.researchProject, project._id], project);
        queryClient.invalidateQueries([QueryKeys.researchProjects]);
      },
      onError: (_error, payload) => {
        queryClient.invalidateQueries([QueryKeys.researchProject, payload.researchId]);
      },
    },
  );
};

export const useDeleteResearchProjectMutation = (): UseMutationResult<
  { deleted: boolean },
  unknown,
  string,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation((researchId: string) => dataService.deleteResearchProject(researchId), {
    onSuccess: (_result, researchId) => {
      queryClient.removeQueries([QueryKeys.researchProject, researchId]);
      queryClient.invalidateQueries([QueryKeys.researchProjects]);
    },
  });
};
