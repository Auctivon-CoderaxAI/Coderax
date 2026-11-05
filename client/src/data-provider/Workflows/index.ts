import { useEffect } from 'react';
import { SSE } from 'sse.js';
import { QueryKeys, dataService } from 'coderax-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateWorkflowRequest,
  StartWorkflowRunRequest,
  StartWorkflowRunResponse,
  UpdateWorkflowRequest,
  WorkflowListResponse,
  WorkflowRunListResponse,
  WorkflowRunView,
  WorkflowTemplatesResponse,
} from 'coderax-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import { useAuthContext } from '~/hooks/AuthContext';

export const useWorkflowsQuery = (
  config?: UseQueryOptions<WorkflowListResponse>,
): QueryObserverResult<WorkflowListResponse> =>
  useQuery<WorkflowListResponse>([QueryKeys.workflows], () => dataService.listWorkflows(), {
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    ...config,
  });

export const useWorkflowTemplatesQuery = (
  config?: UseQueryOptions<WorkflowTemplatesResponse>,
): QueryObserverResult<WorkflowTemplatesResponse> =>
  useQuery<WorkflowTemplatesResponse>(
    [QueryKeys.workflowTemplates],
    () => dataService.listWorkflowTemplates(),
    { staleTime: Infinity, ...config },
  );

export const useWorkflowRunsQuery = (
  workflowId: string | undefined,
  config?: UseQueryOptions<WorkflowRunListResponse>,
): QueryObserverResult<WorkflowRunListResponse> =>
  useQuery<WorkflowRunListResponse>(
    [QueryKeys.workflowRuns, workflowId],
    () => dataService.listWorkflowRuns(workflowId as string),
    {
      enabled: workflowId != null,
      refetchOnWindowFocus: true,
      refetchInterval: 5_000,
      ...config,
    },
  );

export const useCreateWorkflowMutation = () => {
  const queryClient = useQueryClient();
  return useMutation((payload: CreateWorkflowRequest) => dataService.createWorkflow(payload), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.workflows]);
    },
  });
};

export const useUpdateWorkflowMutation = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation((payload: UpdateWorkflowRequest) => dataService.updateWorkflow(id, payload), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.workflows]);
    },
  });
};

export const useDeleteWorkflowMutation = () => {
  const queryClient = useQueryClient();
  return useMutation((id: string) => dataService.deleteWorkflow(id), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.workflows]);
    },
  });
};

export const useStartWorkflowRunMutation = (workflowId: string) => {
  const queryClient = useQueryClient();
  return useMutation(
    (payload: StartWorkflowRunRequest) => dataService.startWorkflowRun(workflowId, payload),
    {
      onSuccess: ({ run }: StartWorkflowRunResponse) => {
        // Show the accepted run immediately so the stream opens without waiting
        // for a second list round trip. The stream's first frame is authoritative.
        queryClient.setQueryData<WorkflowRunListResponse>(
          [QueryKeys.workflowRuns, workflowId],
          (current) => ({
            runs: [run, ...(current?.runs ?? []).filter((entry) => entry.id !== run.id)],
          }),
        );
        // Cancel/refetch stale in-flight lists after the optimistic insertion.
        void queryClient.invalidateQueries([QueryKeys.workflowRuns, workflowId]);
      },
    },
  );
};

export const useApproveWorkflowStepMutation = (workflowId: string) => {
  const queryClient = useQueryClient();
  return useMutation(
    ({ runId, stepIndex }: { runId: string; stepIndex: number }) =>
      dataService.approveWorkflowStep(runId, stepIndex),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.workflowRuns, workflowId]);
      },
    },
  );
};

export const usePauseWorkflowRunMutation = (workflowId: string) => {
  const queryClient = useQueryClient();
  return useMutation((runId: string) => dataService.pauseWorkflowRun(runId), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.workflowRuns, workflowId]);
    },
  });
};

export const useResumeWorkflowRunMutation = (workflowId: string) => {
  const queryClient = useQueryClient();
  return useMutation((runId: string) => dataService.resumeWorkflowRun(runId), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.workflowRuns, workflowId]);
    },
  });
};

export const useCancelWorkflowRunMutation = (workflowId: string) => {
  const queryClient = useQueryClient();
  return useMutation((runId: string) => dataService.cancelWorkflowRun(runId), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.workflowRuns, workflowId]);
    },
  });
};

const TERMINAL_STATUSES: WorkflowRunView['status'][] = ['completed', 'failed', 'cancelled'];

/**
 * Subscribes to a run's server-sent progress while it is live. Every event is a
 * complete run snapshot, so a dropped frame only costs one later update.
 */
export const useWorkflowRunStream = (
  workflowId: string,
  run: WorkflowRunView | undefined,
  onRun: (run: WorkflowRunView) => void,
): void => {
  const runId = run?.id;
  const status = run?.status;
  const live = status != null && !TERMINAL_STATUSES.includes(status);
  const { token } = useAuthContext();
  useEffect(() => {
    if (!live || runId == null || token == null) {
      return;
    }
    // EventSource cannot send an Authorization header; the app's bearer auth
    // would reject it. sse.js supports headers and is already used elsewhere.
    const source = new SSE(dataService.getWorkflowRunStreamUrl(runId), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    source.addEventListener('message', (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { run?: WorkflowRunView };
        if (payload.run != null) {
          onRun(payload.run);
        }
      } catch {
        /* A malformed frame is ignored; the next snapshot still arrives. */
      }
    });
    return () => source.close();
  }, [live, onRun, runId, token]);
};
