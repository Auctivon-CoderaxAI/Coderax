import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EModelEndpoint, QueryKeys, dataService } from 'coderax-data-provider';
import type { Agent, TWorkModel } from 'coderax-data-provider';
import {
  ModelSelectorChatProvider,
  useModelSelectorChatContext,
} from '~/components/Chat/Menus/Endpoints/ModelSelectorChatContext';
import { useListAgentsQuery, useGetEndpointsQuery } from '~/data-provider';
import { useLocalize, useAgentDefaultPermissionLevel } from '~/hooks';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { cn } from '~/utils';

export type WorkAgentOption = Pick<Agent, 'id' | 'name' | 'model' | 'provider'>;
type EligibleAgent = Agent & { id: string; model: string; provider: string };

export function getWorkModelKey(model: Pick<TWorkModel, 'id' | 'provider'>): string {
  return JSON.stringify([model.provider ?? '', model.id]);
}

/** Only agents that can run on the server's current Work-eligible model catalog. */
export function filterWorkAgents(agents: Agent[], models: TWorkModel[]): WorkAgentOption[] {
  const available = new Set(
    models
      .filter((model) => model.auto !== true && typeof model.provider === 'string')
      .map((model) => `${model.provider}\u0000${model.id}`),
  );

  return agents
    .filter(
      (agent): agent is EligibleAgent =>
        typeof agent.id === 'string' &&
        agent.id.length > 0 &&
        typeof agent.model === 'string' &&
        agent.model.length > 0 &&
        typeof agent.provider === 'string' &&
        available.has(`${agent.provider}\u0000${agent.model}`),
    )
    .map(({ id, name, model, provider }) => ({ id, name, model, provider }));
}

/** Only expose models that at least one accessible Work agent can actually run. */
export function filterWorkModels(agents: WorkAgentOption[], models: TWorkModel[]): TWorkModel[] {
  const configured = new Set(agents.map((agent) => `${agent.provider}\u0000${agent.model}`));
  return models.filter(
    (model) =>
      model.auto !== true &&
      typeof model.provider === 'string' &&
      configured.has(`${model.provider}\u0000${model.id}`),
  );
}

export function useWorkAgentOptions() {
  const permissionLevel = useAgentDefaultPermissionLevel();
  const modelsQuery = useQuery({
    queryKey: [QueryKeys.workModels],
    queryFn: () => dataService.getWorkModels(),
    retry: false,
    staleTime: 30_000,
  });
  const agentsQuery = useListAgentsQuery(
    { requiredPermission: permissionLevel },
    { retry: false, staleTime: 30_000 },
  );
  const agents = useMemo(
    () => filterWorkAgents(agentsQuery.data?.data ?? [], modelsQuery.data?.models ?? []),
    [agentsQuery.data, modelsQuery.data],
  );
  const models = useMemo(
    () => filterWorkModels(agents, modelsQuery.data?.models ?? []),
    [agents, modelsQuery.data],
  );

  return {
    agents,
    models,
    modelsQuery,
    agentsQuery,
    isLoading: modelsQuery.isLoading || agentsQuery.isLoading,
    isError: modelsQuery.isError || agentsQuery.isError,
  };
}

export function WorkModelSelect({
  models,
  value,
  onChange,
  disabled = false,
  id = 'work-model',
  className,
}: {
  models: TWorkModel[];
  value: string;
  onChange: (model: TWorkModel) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const localize = useLocalize();
  const selectedModel = models.find((model) => getWorkModelKey(model) === value);

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {localize('com_ui_model')}
      </label>
      <select
        id={id}
        aria-label={localize('com_ui_model')}
        className={cn(
          'text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-focus-control max-w-56 min-w-0 cursor-pointer rounded-full bg-transparent px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden',
          className,
        )}
        value={selectedModel ? getWorkModelKey(selectedModel) : ''}
        onChange={(event) => {
          const model = models.find((option) => getWorkModelKey(option) === event.target.value);
          if (model) {
            onChange(model);
          }
        }}
        disabled={disabled || models.length === 0}
      >
        <option value="">{localize('com_ui_model')}</option>
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
  agents,
  value,
  onChange,
  disabled = false,
  id = 'work-agent',
  className,
}: {
  agents: WorkAgentOption[];
  value: string;
  onChange: (agent: WorkAgentOption) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const localize = useLocalize();
  const selectedAgent = agents.find((agent) => agent.id === value);

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {localize('com_work_agent')}
      </label>
      <select
        id={id}
        aria-label={localize('com_work_agent')}
        className={cn(
          'text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-focus-control max-w-56 min-w-0 cursor-pointer rounded-full bg-transparent px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden',
          className,
        )}
        value={selectedAgent?.id ?? ''}
        onChange={(event) => {
          const agent = agents.find((option) => option.id === event.target.value);
          if (agent) {
            onChange(agent);
          }
        }}
        disabled={disabled || agents.length === 0}
      >
        <option value="">{localize('com_work_select_agent')}</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name?.trim() || agent.id}
          </option>
        ))}
      </select>
    </>
  );
}

/** Composer selector applies an agent through the same conversation-setting path as Chat. */
export function WorkAgentConversationSelector() {
  return (
    <ModelSelectorChatProvider>
      <WorkAgentConversationSelectorContent />
    </ModelSelectorChatProvider>
  );
}

function WorkAgentConversationSelectorContent() {
  const localize = useLocalize();
  const { agents, models, isLoading, modelsQuery, agentsQuery } = useWorkAgentOptions();
  const { agent_id, model, getConversation, newConversation } = useModelSelectorChatContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { onSelectEndpoint } = useSelectMention({
    modelSpecs: [],
    endpointsConfig: endpointsConfig ?? {},
    getConversation,
    newConversation,
    returnHandlers: true,
  });

  const selectedAgent = agents.find((agent) => agent.id === agent_id);
  const selectedModel =
    models.find(
      (option) => option.id === selectedAgent?.model && option.provider === selectedAgent.provider,
    ) ?? models.find((option) => option.id === model);
  const compatibleAgents = selectedModel
    ? agents.filter(
        (agent) => agent.model === selectedModel.id && agent.provider === selectedModel.provider,
      )
    : agents;
  const hasCatalogModels = (modelsQuery.data?.models ?? []).some((option) => option.auto !== true);

  const onChangeAgent = (agent: WorkAgentOption) => {
    onSelectEndpoint?.(EModelEndpoint.agents, {
      agent_id: agent.id,
      model: agent.model ?? '',
    });
  };
  const onChangeModel = (selected: TWorkModel) => {
    const compatibleAgent = agents.find(
      (agent) => agent.model === selected.id && agent.provider === selected.provider,
    );
    if (compatibleAgent) {
      onSelectEndpoint?.(EModelEndpoint.agents, {
        agent_id: compatibleAgent.id,
        model: selected.id,
      });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="work-agent-selection">
      <WorkModelSelect
        models={models}
        value={selectedModel ? getWorkModelKey(selectedModel) : ''}
        onChange={onChangeModel}
        disabled={isLoading || modelsQuery.isError || agentsQuery.isError}
        id="work-model-composer"
        className="w-full max-w-full"
      />
      <WorkAgentSelect
        agents={compatibleAgents}
        value={agent_id ?? ''}
        onChange={onChangeAgent}
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
      {!isLoading && !modelsQuery.isError && !agentsQuery.isError && !hasCatalogModels && (
        <span role="alert" className="text-text-secondary text-xs">
          {localize('com_work_no_models')}
        </span>
      )}
      {!isLoading &&
        !modelsQuery.isError &&
        !agentsQuery.isError &&
        hasCatalogModels &&
        agents.length === 0 && (
          <span role="alert" className="text-text-secondary text-xs">
            {localize('com_work_no_agents')}
          </span>
        )}
    </div>
  );
}
