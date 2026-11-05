import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { useRecoilValue } from 'recoil';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mic, Square } from 'lucide-react';
import { dataService, MutationKeys, QueryKeys } from 'coderax-data-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconButton,
  SendIcon,
  TooltipAnchor,
  composerSurfaceClasses,
  composerSurfaceShadow,
} from '@coderax/client';
import type { TWorkTask } from 'coderax-data-provider';
import {
  composerShapeClass,
  composerWidthClass,
  landingBandClass,
  landingColumnClass,
  landingComposerClearance,
  landingGreetingBlockClass,
  landingGreetingClass,
  landingGreetingSpacing,
} from '~/components/Chat/layout';
import {
  WorkAgentSelect,
  WorkModelSelect,
  WorkSelectionSummary,
  useWorkOptions,
  workSelectionAtom,
} from '~/components/Chat/Input/WorkAgentSelector';
import { resolveWorkSelection, sanitizeWorkSelection } from '~/components/Chat/Input/workSelection';
import useSpeechToText from '~/hooks/Input/useSpeechToText';
import ModeHeader from '~/components/Chat/ModeHeader';
import { cn, removeFocusRings } from '~/utils';
import Footer from '~/components/Chat/Footer';
import { useLocalize } from '~/hooks';
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
    <IconButton
      label={label}
      size="md"
      shape="composer"
      variant="ghost"
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
      <span className="text-text-secondary hover:text-text-primary flex h-full w-full items-center justify-center transition-colors">
        {icon}
      </span>
    </IconButton>
  );
}

/**
 * Work's welcome screen. It shares Chat's landing geometry — header, greeting,
 * composer band and footer — so switching modes moves nothing; recent tasks sit
 * where Chat shows conversation starters, and agent/model selection sits in the
 * composer's action row.
 */
export default function NativeWorkHome() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);
  const [task, setTask] = useState('');
  const [cancelError, setCancelError] = useState(false);
  const [storedSelection, setStoredSelection] = useAtom(workSelectionAtom);
  const work = useWorkOptions();
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

  const selection = sanitizeWorkSelection(storedSelection, work.options);
  const resolved = resolveWorkSelection(selection, work.options);
  const hasModels = work.options.models.length > 0;
  const modelsSettled = !work.modelsQuery.isLoading && work.modelsQuery.data != null;
  const canStart = !work.isLoading && !work.modelsQuery.isError && resolved != null;
  const recentTasks = (tasks.data?.tasks ?? []).slice(0, 12);
  const agentNames = new Map(work.options.agents.map((agent) => [agent.id, agent.name]));

  const startTask = () => {
    const description = task.trim();
    if (!description || !canStart || !resolved) {
      return;
    }
    const search = new URLSearchParams({
      prompt: description,
      submit: 'true',
      endpoint: resolved.preset.endpoint,
      model: resolved.preset.model,
      ...(resolved.preset.agent_id ? { agent_id: resolved.preset.agent_id } : {}),
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
    <main className="bg-surface-canvas text-text-primary relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ModeHeader />
      <div
        data-testid="work-landing"
        className={cn('scrollbar-gutter-spacer flex min-h-0 flex-col', landingColumnClass)}
      >
        <div className={cn(landingGreetingBlockClass, landingGreetingSpacing(centerFormOnLanding))}>
          <h1 className={landingGreetingClass}>{localize('com_cyvox_work_welcome_title')}</h1>
        </div>
        <div className={cn('bg-surface-canvas relative z-10 w-full', landingBandClass)}>
          {recentTasks.length > 0 && !tasks.isError && (
            <section
              aria-label={localize('com_cyvox_work_recent_heading')}
              className={cn('mx-auto w-full px-4 pb-3 sm:px-4', composerWidthClass)}
            >
              <h2 className="text-text-muted px-1 text-xs font-medium">
                {localize('com_cyvox_work_recent_heading')}
              </h2>
              <ul className="mt-1.5 max-h-[min(30vh,15rem)] space-y-0.5 overflow-y-auto">
                {recentTasks.map((item) => {
                  const agentName = item.agentId ? agentNames.get(item.agentId) : undefined;
                  const runOn = [agentName, item.model].filter(Boolean).join(' · ');
                  return (
                    <li key={item.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        className="text-text-primary hover:bg-surface-hover focus-visible:ring-border-xheavy flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
                        onClick={() => navigate(`/work/${encodeURIComponent(item.id)}`)}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {runOn && (
                          <span className="text-text-muted hidden max-w-[40%] shrink truncate text-xs sm:inline">
                            {runOn}
                          </span>
                        )}
                        <span className="text-text-muted shrink-0 text-xs">{item.state}</span>
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
                  );
                })}
              </ul>
            </section>
          )}
          <form
            data-testid="work-composer-form"
            className={cn(
              'relative mx-auto flex w-full flex-col sm:px-2',
              composerWidthClass,
              landingComposerClearance(centerFormOnLanding),
            )}
            onSubmit={(event) => {
              event.preventDefault();
              startTask();
            }}
          >
            <div
              data-testid="work-composer-surface"
              className={cn(
                composerShapeClass,
                'relative flex w-full grow flex-col overflow-hidden',
                composerSurfaceClasses(),
                composerSurfaceShadow.within,
              )}
            >
              <label htmlFor="work-task" className="sr-only">
                {localize('com_cyvox_work_description_label')}
              </label>
              <textarea
                id="work-task"
                className={cn(
                  'placeholder:text-text-tertiary m-0 max-h-[45vh] min-h-[3.25rem] w-full resize-none bg-transparent px-5 py-3.25 text-base md:max-h-[55vh] md:py-3.5',
                  removeFocusRings,
                )}
                rows={1}
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
              <WorkSelectionSummary resolved={resolved} className="px-5 pb-1" />
              {work.modelsQuery.isError && (
                <p role="alert" className="text-text-secondary px-5 pb-2 text-sm">
                  {localize('com_work_models_unavailable')}
                </p>
              )}
              {work.agentsQuery.isError && (
                <p role="alert" className="text-text-secondary px-5 pb-2 text-sm">
                  {localize('com_work_agents_unavailable')}
                </p>
              )}
              {modelsSettled && !hasModels && (
                <p role="alert" className="text-text-secondary px-5 pb-2 text-sm">
                  {localize('com_work_no_models')}
                </p>
              )}
              {tasks.isError && (
                <p role="alert" className="text-text-secondary px-5 pb-2 text-sm">
                  {localize('com_cyvox_tasks_unavailable')}
                </p>
              )}
              {cancelError && (
                <p role="alert" className="text-text-secondary px-5 pb-2 text-sm">
                  {localize('com_work_cancel_failed')}
                </p>
              )}
              <div className="flex flex-col gap-1.5 px-2 pb-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <WorkModelSelect
                    options={work.options}
                    selection={selection}
                    onChange={setStoredSelection}
                    disabled={work.isLoading || work.modelsQuery.isError}
                  />
                  <WorkAgentSelect
                    options={work.options}
                    selection={selection}
                    onChange={setStoredSelection}
                    disabled={
                      work.isLoading || work.modelsQuery.isError || work.agentsQuery.isError
                    }
                  />
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <WorkVoiceInput value={task} onChange={setTask} />
                    <TooltipAnchor
                      description={localize('com_cyvox_work_start_task_aria')}
                      render={
                        <IconButton
                          label={localize('com_cyvox_work_start_task_aria')}
                          variant="submit"
                          size="theme"
                          shape="composer"
                          type="submit"
                          data-testid="work-start-task"
                          disabled={!canStart || !task.trim()}
                        >
                          <SendIcon className="size-6" />
                        </IconButton>
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
            {/* Beneath the surface, out of flow, as Chat's hint row is: the surface
                itself ends exactly where Chat's does. */}
            <div className="absolute inset-x-0 top-full hidden px-5 pt-1.5 sm:block">
              {tasks.isLoading && (
                <p role="status" className="text-text-muted text-xs">
                  {localize('com_cyvox_work_history_loading')}
                </p>
              )}
              <p className="text-text-muted text-xs">{localize('com_cyvox_work_policy_note')}</p>
            </div>
          </form>
        </div>
      </div>
      <Footer />
    </main>
  );
}
