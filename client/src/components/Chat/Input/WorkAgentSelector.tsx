import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EModelEndpoint, QueryKeys, dataService, getEndpointField } from 'coderax-data-provider';
import type { TWorkAgent } from 'coderax-data-provider';
import type { ResolvedWorkSelection, WorkOptions, WorkSelection } from './workSelection';
import {
  workSelectionFromConversation,
  automaticWorkSelection,
  resolveWorkSelection,
  getWorkModelKey,
  selectWorkAgent,
  WORK_AUTOMATIC,
  toWorkOptions,
} from './workSelection';
import {
  ModelSelectorChatProvider,
  useModelSelectorChatContext,
} from '~/components/Chat/Menus/Endpoints/ModelSelectorChatContext';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { createStorageAtom } from '~/store/jotai-utils';
import { useGetEndpointsQuery } from '~/data-provider';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export { getWorkModelKey } from './workSelection';

/** The last Work selection, re-validated against the server's offer on every read. */
export const workSelectionAtom = createStorageAtom<WorkSelection>(
  'workSelection',
  automaticWorkSelection,
);

const selectClassName =
  'text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-focus-control max-w-56 min-w-0 cursor-pointer truncate rounded-full bg-transparent px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden disabled:cursor-default disabled:opacity-70';

/** Work's own catalog: free/local models and the agents whose whole graph runs on them. */
export function useWorkOptions() {
  const modelsQuery = useQuery({
    queryKey: [QueryKeys.workModels],
    queryFn: () => dataService.getWorkModels(),
    retry: false,
    staleTime: 30_000,
  });
  const agentsQuery = useQuery({
    queryKey: [QueryKeys.workAgents],
    queryFn: () => dataService.getWorkAgents(),
    retry: false,
    staleTime: 30_000,
  });
  const options = useMemo(
    () => toWorkOptions(modelsQuery.data?.models, agentsQuery.data?.agents),
    [modelsQuery.data, agentsQuery.data],
  );

  return {
    options,
    modelsQuery,
    agentsQuery,
    isLoading: modelsQuery.isLoading || agentsQuery.isLoading,
  };
}

function agentLabel(agent: TWorkAgent, localize: ReturnType<typeof useLocalize>): string {
  const name = agent.name?.trim() || agent.id;
  return agent.members.length > 0
    ? localize('com_work_agent_coordinates', { 0: name, 1: agent.members.length })
    : name;
}

export function WorkModelSelect({
  options,
  selection,
  onChange,
  disabled = false,
  id = 'work-model',
  className,
}: {
  options: WorkOptions;
  selection: WorkSelection;
  onChange: (selection: WorkSelection) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const localize = useLocalize();
  const agent =
    selection.agentId === WORK_AUTOMATIC
      ? undefined
      : options.agents.find((option) => option.id === selection.agentId);
  /** A saved agent runs on its own model, so the model is shown, not offered. */
  const models = agent
    ? options.models.filter(
        (model) => model.id === agent.model && model.provider === agent.provider,
      )
    : options.models;
  const showAutomatic = !agent && options.auto?.target != null;

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {localize('com_ui_model')}
      </label>
      <select
        id={id}
        aria-label={localize('com_ui_model')}
        title={agent ? localize('com_work_model_set_by_agent') : undefined}
        className={cn(selectClassName, className)}
        value={selection.modelKey}
        onChange={(event) => onChange({ agentId: WORK_AUTOMATIC, modelKey: event.target.value })}
        disabled={disabled || agent != null || (models.length === 0 && !showAutomatic)}
      >
        {showAutomatic && (
          <option value={WORK_AUTOMATIC}>
            {localize('com_work_automatic_model', {
              0: options.auto?.target?.label || options.auto?.target?.id || '',
            })}
          </option>
        )}
        {!showAutomatic && models.length === 0 && (
          <option value={WORK_AUTOMATIC}>{localize('com_ui_model')}</option>
        )}
        {models.map((model) => (
          <option key={getWorkModelKey(model)} value={getWorkModelKey(model)}>
            {model.label?.trim() || model.id}
          </option>
        ))}
      </select>
    </>
  );
}

export function WorkAgentSelect({
  options,
  selection,
  onChange,
  disabled = false,
  id = 'work-agent',
  className,
}: {
  options: WorkOptions;
  selection: WorkSelection;
  onChange: (selection: WorkSelection) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const localize = useLocalize();

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {localize('com_work_agent')}
      </label>
      <select
        id={id}
        aria-label={localize('com_work_agent')}
        className={cn(selectClassName, className)}
        value={selection.agentId}
        onChange={(event) => {
          const agent = options.agents.find((option) => option.id === event.target.value) ?? null;
          onChange(selectWorkAgent(selection, agent));
        }}
        disabled={disabled}
      >
        <option value={WORK_AUTOMATIC}>{localize('com_work_automatic_agent')}</option>
        {options.agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agentLabel(agent, localize)}
          </option>
        ))}
      </select>
    </>
  );
}

/** Names exactly what a task will run on before it starts. */
export function WorkSelectionSummary({
  resolved,
  className,
}: {
  resolved: ResolvedWorkSelection | null;
  className?: string;
}) {
  const localize = useLocalize();
  if (!resolved) {
    return null;
  }
  const model = resolved.model.label?.trim() || resolved.model.id;
  const agentName = resolved.agent ? resolved.agent.name?.trim() || resolved.agent.id : null;
  const members = resolved.agent?.members.map((member) => member.name?.trim() || member.id) ?? [];

  return (
    <p
      data-testid="work-selection-summary"
      className={cn('text-text-secondary text-xs', className)}
    >
      {agentName
        ? localize('com_work_runs_agent_on_model', { 0: agentName, 1: model })
        : localize('com_work_runs_on_model', { 0: model })}
      {members.length > 0 && ` ${localize('com_work_with_agents', { 0: members.join(', ') })}`}
    </p>
  );
}

/** The in-task composer applies a new selection to the open Work conversation. */
export function WorkAgentConversationSelector() {
  return (
    <ModelSelectorChatProvider>
      <WorkAgentConversationSelectorContent />
    </ModelSelectorChatProvider>
  );
}

function WorkAgentConversationSelectorContent() {
  const localize = useLocalize();
  const { options, isLoading, modelsQuery, agentsQuery } = useWorkOptions();
  const { conversation, setConversation } = useChatContext();
  const { getConversation, newConversation } = useModelSelectorChatContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { onSelectEndpoint } = useSelectMention({
    modelSpecs: [],
    endpointsConfig: endpointsConfig ?? {},
    getConversation,
    newConversation,
    returnHandlers: true,
  });
  const selection = workSelectionFromConversation(conversation, options);

  const apply = (next: WorkSelection) => {
    const resolved = resolveWorkSelection(next, options);
    if (!resolved) {
      return;
    }
    if (resolved.agent) {
      onSelectEndpoint?.(EModelEndpoint.agents, {
        agent_id: resolved.agent.id,
        model: resolved.model.id,
      });
      return;
    }
    /** Without an agent the conversation runs Coderax's default agent on this
     *  model; any earlier agent is cleared so it cannot ride along. */
    const { endpoint, model } = resolved.preset;
    setConversation((previous) =>
      previous
        ? {
            ...previous,
            endpoint: endpoint as EModelEndpoint,
            endpointType: getEndpointField(endpointsConfig, endpoint, 'type') ?? null,
            model,
            agent_id: undefined,
            spec: null,
          }
        : previous,
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="work-agent-selection">
      <WorkModelSelect
        options={options}
        selection={selection}
        onChange={apply}
        disabled={isLoading || modelsQuery.isError}
        id="work-model-composer"
        className="w-full max-w-full"
      />
      <WorkAgentSelect
        options={options}
        selection={selection}
        onChange={apply}
        disabled={isLoading || modelsQuery.isError || agentsQuery.isError}
        id="work-agent-composer"
        className="w-full max-w-full"
      />
      {modelsQuery.isError && (
        <span role="alert" className="text-text-secondary text-xs">
          {localize('com_work_models_unavailable')}
        </span>
      )}
      {agentsQuery.isError && (
        <span role="alert" className="text-text-secondary text-xs">
          {localize('com_work_agents_unavailable')}
        </span>
      )}
    </div>
  );
}
