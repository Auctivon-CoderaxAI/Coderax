import { dataService, QueryKeys, MutationKeys } from 'coderax-data-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TCyVoxConnectionStatus,
  TCyVoxConnectionTestRequest,
  TCyVoxConnectionTestResponse,
  TUpdateCyVoxConnectionRequest,
} from 'coderax-data-provider';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';

export const useGetCyVoxConnectionQuery = (
  enabled = true,
): UseQueryResult<TCyVoxConnectionStatus> =>
  useQuery<TCyVoxConnectionStatus>(
    [QueryKeys.cyvoxConnection],
    () => dataService.getCyVoxConnection(),
    { enabled, refetchOnWindowFocus: false },
  );

export const useUpdateCyVoxConnectionMutation = (): UseMutationResult<
  TCyVoxConnectionStatus,
  unknown,
  TUpdateCyVoxConnectionRequest
> => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: TUpdateCyVoxConnectionRequest) => dataService.updateCyVoxConnection(payload),
    {
      mutationKey: [MutationKeys.updateCyVoxConnection],
      onSuccess: (data) => {
        queryClient.setQueryData([QueryKeys.cyvoxConnection], data);
        void queryClient.invalidateQueries([QueryKeys.cyvoxAddon]);
      },
    },
  );
};

export const useTestCyVoxConnectionMutation = (): UseMutationResult<
  TCyVoxConnectionTestResponse,
  unknown,
  TCyVoxConnectionTestRequest
> =>
  useMutation((payload: TCyVoxConnectionTestRequest) => dataService.testCyVoxConnection(payload), {
    mutationKey: [MutationKeys.testCyVoxConnection],
  });
