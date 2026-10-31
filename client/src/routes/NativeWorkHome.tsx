import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@coderax/client';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService, EModelEndpoint, MutationKeys, QueryKeys } from 'coderax-data-provider';
import type { TWorkTask } from 'coderax-data-provider';
import { WorkAgentSelect, useWorkAgentOptions } from '~/components/Chat/Input/WorkAgentSelector';
import { useLocalize } from '~/hooks';

function canCancelTask(state: TWorkTask['state']) {
  return state === 'running' || state === 'awaiting_approval' || state === 'unknown';
}

export default function NativeWorkHome() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [task, setTask] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [cancelError, setCancelError] = useState(false);
  const workAgents = useWorkAgentOptions();
  const tasks = useQuery({
    queryKey: [QueryKeys.workTasks],
    queryFn: () => dataService.getWorkTasks(),
    retry: false,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
  const cancelTask = useMutation({
    mutationKey: [MutationKeys.cancelWorkTask],
    mutationFn: (conversationId: string) => dataService.cancelWorkTask(conversationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [QueryKeys.workTasks] });
      setCancelError(false);
    },
    onError: () => setCancelError(true),
  });
  const hasModels = (workAgents.modelsQuery.data?.models ?? []).some(
    (model) => model.auto !== true,
  );
  const selectedAgent = workAgents.agents.find((agent) => agent.id === selectedAgentId);
  useEffect(() => {
    if (workAgents.agents.length > 0 && !selectedAgent) {
      setSelectedAgentId(workAgents.agents[0]!.id);
    }
  }, [selectedAgent, workAgents.agents]);
  const recentTasks = (tasks.data?.tasks ?? []).slice(0, 12);

  const startTask = () => {
    const description = task.trim();
    if (
      !description ||
      workAgents.isLoading ||
      workAgents.isError ||
      !hasModels ||
      !selectedAgent
    ) {
      return;
    }
    const search = new URLSearchParams({
      prompt: description,
      submit: 'true',
      endpoint: EModelEndpoint.agents,
      agent_id: selectedAgent.id,
      model: selectedAgent.model ?? '',
    });
    navigate(`/work/new?${search.toString()}`);
  };

  const cancel = async (item: TWorkTask) => {
    if (!canCancelTask(item.state) || cancelTask.isLoading) {
      return;
    }
    if (!window.confirm(localize('com_work_cancel_task_confirmation'))) {
      return;
    }
    setCancelError(false);
    await cancelTask.mutateAsync(item.id).catch(() => undefined);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-8">
          <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {localize('com_cyvox_work_welcome_title')}
            </h1>
            <p className="text-text-secondary mt-3 max-w-xl text-sm sm:text-base">
              {localize('com_cyvox_work_welcome_description')}
            </p>
          </div>
          {tasks.isLoading && (
            <p role="status" className="text-text-secondary py-4 text-center text-sm">
              {localize('com_cyvox_work_history_loading')}
            </p>
          )}
          {tasks.isError && (
            <p role="alert" className="text-text-secondary py-4 text-center text-sm">
              {localize('com_cyvox_tasks_unavailable')}
            </p>
          )}
          {recentTasks.length > 0 && !tasks.isError && (
            <section
              aria-label={localize('com_cyvox_work_recent_heading')}
              className="mt-8 space-y-3"
            >
              <h2 className="text-text-secondary text-sm font-medium">
                {localize('com_cyvox_work_recent_heading')}
              </h2>
              <ul className="border-border-light divide-border-light rounded-2xl border p-1">
                {recentTasks.map((item) => (
                  <li key={item.id} className="flex items-center gap-1">
                    <Button
                      variant="card"
                      size="row"
                      className="min-w-0 flex-1 justify-between"
                      onClick={() => navigate(`/work/${encodeURIComponent(item.id)}`)}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                      <span className="text-text-secondary ml-4 shrink-0 text-xs">
                        {item.state}
                      </span>
                    </Button>
                    {canCancelTask(item.state) && (
                      <Button
                        variant="row-action"
                        size="xs"
                        disabled={cancelTask.isLoading}
                        aria-label={localize('com_cyvox_cancel') + ' ' + item.title}
                        onClick={() => void cancel(item)}
                      >
                        {localize('com_cyvox_cancel')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      <div className="bg-surface-primary shrink-0 px-4 pt-3 pb-4">
        <form
          className="mx-auto w-full max-w-3xl"
          onSubmit={(event) => {
            event.preventDefault();
            startTask();
          }}
        >
          <div className="border-border-medium bg-surface-primary focus-within:border-border-heavy rounded-3xl border p-3 shadow-sm">
            <label htmlFor="work-task" className="sr-only">
              {localize('com_cyvox_work_description_label')}
            </label>
            <textarea
              id="work-task"
              className="text-text-primary placeholder:text-text-secondary max-h-48 min-h-20 w-full resize-y bg-transparent px-2 py-2 text-base focus:outline-hidden"
              rows={3}
              maxLength={4000}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.key === 'Process' ||
                  event.keyCode === 229
                ) {
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  startTask();
                }
              }}
              placeholder={localize('com_cyvox_work_description_placeholder')}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <WorkAgentSelect
                  agents={workAgents.agents}
                  value={selectedAgent?.id ?? ''}
                  onChange={(agent) => setSelectedAgentId(agent.id)}
                  disabled={workAgents.isLoading || workAgents.isError}
                />
              </div>
              <Button
                type="submit"
                variant="default"
                size="icon-sm"
                shape="round"
                aria-label={localize('com_cyvox_work_start_task_aria')}
                disabled={
                  workAgents.isLoading ||
                  workAgents.isError ||
                  !hasModels ||
                  !selectedAgent ||
                  !task.trim()
                }
              >
                <ArrowUp className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            {workAgents.modelsQuery.isError && (
              <p role="alert" className="text-text-secondary mt-2 px-3 text-xs">
                {localize('com_work_models_unavailable')}
              </p>
            )}
            {workAgents.agentsQuery.isError && (
              <p role="alert" className="text-text-secondary mt-2 px-3 text-xs">
                {localize('com_work_agents_unavailable')}
              </p>
            )}
            {!workAgents.modelsQuery.isLoading &&
              workAgents.modelsQuery.data != null &&
              !hasModels && (
                <p role="alert" className="text-text-secondary mt-2 px-3 text-xs">
                  {localize('com_work_no_models')}
                </p>
              )}
            {!workAgents.isLoading &&
              !workAgents.isError &&
              hasModels &&
              workAgents.agents.length === 0 && (
                <p role="alert" className="text-text-secondary mt-2 px-3 text-xs">
                  {localize('com_work_no_agents')}
                </p>
              )}
            {cancelError && (
              <p role="alert" className="text-text-secondary mt-2 px-3 text-xs">
                {localize('com_work_cancel_failed')}
              </p>
            )}
            <p className="text-text-secondary mt-2 px-3 text-center text-xs">
              {localize('com_work_task_selection_note')}
            </p>
            <p className="text-text-secondary mt-2 px-3 text-center text-xs">
              {localize('com_cyvox_work_policy_note')}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
