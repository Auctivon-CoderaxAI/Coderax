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

export type WorkAgentOption = Pick<Agent, 'id' | 'name' | 'model' | 'provider'>;
type EligibleAgent = Agent & { id: string; model: string; provider: string };

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

  return {
    agents,
    modelsQuery,
    agentsQuery,
    isLoading: modelsQuery.isLoading || agentsQuery.isLoading,
    isError: modelsQuery.isError || agentsQuery.isError,
  };
}

export function WorkAgentSelect({
  agents,
  value,
  onChange,
  disabled = false,
  id = 'work-agent',
}: {
  agents: WorkAgentOption[];
  value: string;
  onChange: (agent: WorkAgentOption) => void;
  disabled?: boolean;
  id?: string;
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
        className="border-border-light bg-surface-secondary hover:bg-surface-hover text-text-primary focus-visible:ring-focus-control max-w-56 min-w-0 rounded-full border px-3 py-2 text-xs focus-visible:ring-2 focus-visible:outline-hidden"
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
  const { agents, isLoading, modelsQuery, agentsQuery } = useWorkAgentOptions();
  const { agent_id, getConversation, newConversation } = useModelSelectorChatContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { onSelectEndpoint } = useSelectMention({
    modelSpecs: [],
    endpointsConfig: endpointsConfig ?? {},
    getConversation,
    newConversation,
    returnHandlers: true,
  });

  const onChange = (agent: WorkAgentOption) => {
    onSelectEndpoint?.(EModelEndpoint.agents, {
      agent_id: agent.id,
      model: agent.model ?? '',
    });
  };

  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="work-agent-selection">
      <WorkAgentSelect
        agents={agents}
        value={agent_id ?? ''}
        onChange={onChange}
        disabled={isLoading || modelsQuery.isError || agentsQuery.isError}
        id="work-agent-composer"
      />
      {(modelsQuery.isError || agentsQuery.isError) && (
        <span role="alert" className="text-text-secondary text-xs">
          {localize('com_work_agents_unavailable')}
        </span>
      )}
    </div>
  );
}
