import { useCallback, useEffect, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Loader2, Mic, Square } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, composerSurfaceClasses, composerSurfaceShadow } from '@coderax/client';
import { dataService, EModelEndpoint, MutationKeys, QueryKeys } from 'coderax-data-provider';
import type { TWorkTask } from 'coderax-data-provider';
import {
  getWorkModelKey,
  WorkAgentSelect,
  WorkModelSelect,
  useWorkAgentOptions,
} from '~/components/Chat/Input/WorkAgentSelector';
import useSpeechToText from '~/hooks/Input/useSpeechToText';
import ModeHeader from '~/components/Chat/ModeHeader';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

function canCancelTask(state: TWorkTask['state']) {
  return state === 'running' || state === 'awaiting_approval' || state === 'unknown';
}

/**
 * Dictation for the task description. The transcript replaces whatever was in
 * the field when recording began, so interim results can be replaced as the
 * recognizer refines them instead of being appended twice. Send is left as a
 * separate press: a spoken task should be reviewable before it starts a run.
 */
function WorkVoiceInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const localize = useLocalize();
  const speechToText = useRecoilValue(store.speechToText);
  const baseTextRef = useRef('');
  const valueRef = useRef(value);
  valueRef.current = value;

  const setText = useCallback(
    (text: string) => {
      const base = baseTextRef.current;
      onChange(base ? `${base} ${text}` : text);
    },
    [onChange],
  );
  const ignore = useCallback(() => undefined, []);
  const { isListening, isLoading, startRecording, stopRecording, abortRecording } = useSpeechToText(
    setText,
    ignore,
    ignore,
    -1,
  );

  /* Navigating away mid-take must release the microphone. Held in a ref so a
     hook that rebuilds the callback each render cannot abort on a re-render. */
  const abortRef = useRef(abortRecording);
  abortRef.current = abortRecording;
  useEffect(() => () => abortRef.current(), []);

  if (!speechToText) {
    return null;
  }

  const transcribing = isLoading === true;
  let label = localize('com_ui_use_micrphone');
  let icon = <Mic className="size-4" aria-hidden="true" />;
  if (transcribing) {
    label = localize('com_ui_transcribing');
    icon = <Loader2 className="size-4 animate-spin" aria-hidden="true" />;
  } else if (isListening) {
    label = localize('com_ui_stop');
    icon = <Square className="size-3.5 fill-current" aria-hidden="true" />;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      shape="round"
      className="size-9 shrink-0"
      aria-label={label}
      title={label}
      aria-pressed={isListening}
      disabled={transcribing}
      onClick={() => {
        if (isListening) {
          stopRecording();
          return;
        }
        baseTextRef.current = valueRef.current.trim();
        startRecording();
      }}
    >
      {icon}
    </Button>
  );
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
  const hasCatalogModels = (workAgents.modelsQuery.data?.models ?? []).some(
    (model) => model.auto !== true,
  );
  const hasModels = workAgents.models.length > 0;
  const selectedAgent = workAgents.agents.find((agent) => agent.id === selectedAgentId);
  const selectedModel = workAgents.models.find(
    (model) => model.id === selectedAgent?.model && model.provider === selectedAgent.provider,
  );
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
      !selectedAgent ||
      !selectedModel
    ) {
      return;
    }
    const search = new URLSearchParams({
      prompt: description,
      submit: 'true',
      endpoint: EModelEndpoint.agents,
      agent_id: selectedAgent.id,
      model: selectedModel.id,
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
    <div className="bg-surface-canvas relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ModeHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col justify-center px-5 py-10">
          <h1 className="text-text-primary text-center text-3xl leading-tight font-normal tracking-tight">
            {localize('com_cyvox_work_welcome_title')}
          </h1>
          <form
            className="mt-8 w-full"
            onSubmit={(event) => {
              event.preventDefault();
              startTask();
            }}
          >
            <div
              className={cn(
                'rounded-theme-surface-lg focus-within:border-border-heavy p-3.5',
                composerSurfaceClasses(),
                composerSurfaceShadow.within,
              )}
            >
              <label htmlFor="work-task" className="sr-only">
                {localize('com_cyvox_work_description_label')}
              </label>
              <textarea
                id="work-task"
                className="text-text-primary placeholder:text-text-tertiary max-h-48 min-h-[3.5rem] w-full resize-none bg-transparent px-2 pt-2 pb-1 text-base leading-6 focus:outline-hidden"
                rows={2}
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
              <div className="flex items-center justify-between gap-2 px-1 pt-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <WorkModelSelect
                    models={workAgents.models}
                    value={selectedModel ? getWorkModelKey(selectedModel) : ''}
                    onChange={(model) => {
                      const agent = workAgents.agents.find(
                        (option) => option.model === model.id && option.provider === model.provider,
                      );
                      if (agent) {
                        setSelectedAgentId(agent.id);
                      }
                    }}
                    disabled={workAgents.isLoading || workAgents.isError}
                  />
                  <WorkAgentSelect
                    agents={workAgents.agents}
                    value={selectedAgent?.id ?? ''}
                    onChange={(agent) => setSelectedAgentId(agent.id)}
                    disabled={workAgents.isLoading || workAgents.isError}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <WorkVoiceInput value={task} onChange={setTask} />
                  <Button
                    type="submit"
                    variant="default"
                    size="icon-sm"
                    shape="round"
                    className="size-9 shrink-0"
                    aria-label={localize('com_cyvox_work_start_task_aria')}
                    disabled={
                      workAgents.isLoading ||
                      workAgents.isError ||
                      !hasModels ||
                      !selectedAgent ||
                      !selectedModel ||
                      !task.trim()
                    }
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-1 px-1">
              {tasks.isLoading && (
                <p role="status" className="text-text-muted text-center text-xs">
                  {localize('com_cyvox_work_history_loading')}
                </p>
              )}
              {tasks.isError && (
                <p role="alert" className="text-text-muted text-center text-xs">
                  {localize('com_cyvox_tasks_unavailable')}
                </p>
              )}
              {workAgents.modelsQuery.isError && (
                <p role="alert" className="text-text-muted text-center text-xs">
                  {localize('com_work_models_unavailable')}
                </p>
              )}
              {workAgents.agentsQuery.isError && (
                <p role="alert" className="text-text-muted text-center text-xs">
                  {localize('com_work_agents_unavailable')}
                </p>
              )}
              {!workAgents.modelsQuery.isLoading &&
                workAgents.modelsQuery.data != null &&
                !hasCatalogModels && (
                  <p role="alert" className="text-text-muted text-center text-xs">
                    {localize('com_work_no_models')}
                  </p>
                )}
              {!workAgents.isLoading &&
                !workAgents.isError &&
                hasCatalogModels &&
                workAgents.agents.length === 0 && (
                  <p role="alert" className="text-text-muted text-center text-xs">
                    {localize('com_work_no_agents')}
                  </p>
                )}
              {cancelError && (
                <p role="alert" className="text-text-muted text-center text-xs">
                  {localize('com_work_cancel_failed')}
                </p>
              )}
              <p className="text-text-muted text-center text-xs">
                {localize('com_cyvox_work_policy_note')}
              </p>
            </div>
          </form>
          {recentTasks.length > 0 && !tasks.isError && (
            <section aria-label={localize('com_cyvox_work_recent_heading')} className="mt-6 w-full">
              <h2 className="text-text-muted px-1 text-xs font-medium">
                {localize('com_cyvox_work_recent_heading')}
              </h2>
              <ul className="mt-1.5 space-y-0.5">
                {recentTasks.map((item) => (
                  <li key={item.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      className="text-text-primary hover:bg-surface-hover focus-visible:ring-border-xheavy flex min-w-0 flex-1 items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
                      onClick={() => navigate(`/work/${encodeURIComponent(item.id)}`)}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="text-text-muted ml-3 shrink-0 text-xs">{item.state}</span>
                    </button>
                    {canCancelTask(item.state) && (
                      <button
                        type="button"
                        className="text-text-secondary hover:bg-surface-hover hover:text-text-primary shrink-0 rounded-lg px-2 py-1 text-xs transition-colors disabled:opacity-60"
                        disabled={cancelTask.isLoading}
                        aria-label={localize('com_cyvox_cancel') + ' ' + item.title}
                        onClick={() => void cancel(item)}
                      >
                        {localize('com_cyvox_cancel')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
