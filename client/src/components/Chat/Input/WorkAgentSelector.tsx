import { useMemo } from 'react';
import { useAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, SystemRoles, dataService } from 'coderax-data-provider';
import type { TWorkAgent, TWorkModel, TWorkReadinessAction } from 'coderax-data-provider';
import type { WorkOptions, WorkSelection } from './workSelection';
import {
  workSelectionFromConversation,
  sanitizeWorkSelection,
  resolveWorkSelection,
  getWorkModelKey,
  selectWorkAgent,
  WORK_AUTOMATIC,
  WORK_OPENCODE_ENGINE,
  toWorkOptions,
} from './workSelection';
import { createStorageAtom } from '~/store/jotai-utils';
import { WorkRoutingBadge } from './WorkRoutingBadge';
import { useConversationMode } from '../mode';
import { useChatContext } from '~/Providers';
import { useAuthContext, useLocalize } from '~/hooks';
import { cn } from '~/utils';

export { getWorkModelKey } from './workSelection';

/** The last Work selection, re-validated against the server's offer on every read. */
export const workSelectionFamily = atomFamily((key: string) =>
  createStorageAtom<WorkSelection | null>(`workSelection:${key}`, null),
);

const selectClassName =
  'text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-focus-control max-w-56 min-w-0 cursor-pointer truncate rounded-full bg-transparent py-1.5 pr-8 pl-3 text-sm focus-visible:ring-2 focus-visible:outline-hidden disabled:cursor-default disabled:opacity-70';

/** The server exposes the OpenCode engine only to the owner; the picker mirrors that gate. */
const openCodeEngine: TWorkModel = {
  id: WORK_OPENCODE_ENGINE,
  label: 'OpenCode',
  provider: WORK_OPENCODE_ENGINE,
  engine: WORK_OPENCODE_ENGINE,
};

/** Work's own catalog: free/local models, the OpenCode engine, and the agents whose graph runs on them. */
export function useWorkOptions({ enabled = true }: { enabled?: boolean } = {}) {
  const { user } = useAuthContext();
  const canUseOpenCode = user?.role === SystemRoles.ADMIN;
  const modelsQuery = useQuery({
    queryKey: [QueryKeys.workModels],
    queryFn: () => dataService.getWorkModels(),
    retry: false,
    staleTime: 30_000,
    enabled,
  });
  const agentsQuery = useQuery({
    queryKey: [QueryKeys.workAgents],
    queryFn: () => dataService.getWorkAgents(),
    retry: false,
    staleTime: 30_000,
    enabled,
  });
  const readinessQuery = useQuery({
    queryKey: [QueryKeys.workReadiness],
    queryFn: () => dataService.getWorkReadiness(),
    retry: false,
    staleTime: 30_000,
    enabled,
  });
  const options = useMemo(() => {
    const base = toWorkOptions(modelsQuery.data?.models, agentsQuery.data?.agents);
    if (!canUseOpenCode || base.models.some((model) => model.engine != null)) {
      return base;
    }
    return { ...base, models: [...base.models, openCodeEngine] };
  }, [modelsQuery.data, agentsQuery.data, canUseOpenCode]);

  return {
    options,
    modelsQuery,
    agentsQuery,
    readinessQuery,
    isLoading: modelsQuery.isLoading || agentsQuery.isLoading,
  };
}

function agentLabel(agent: TWorkAgent, localize: ReturnType<typeof useLocalize>): string {
  const name = agent.name?.trim() || agent.id;
  return agent.members.length > 0
    ? localize('com_work_agent_coordinates', { 0: name, 1: agent.members.length })
    : name;
}

function localizeWorkReadinessAction(
  action: TWorkReadinessAction,
  localize: ReturnType<typeof useLocalize>,
): string {
  switch (action.id) {
    case 'enable_free_inference':
      return localize('com_work_readiness_enable_free_inference');
    case 'set_provider_credential':
      return localize('com_work_readiness_set_provider_credential', {
        0: action.envName ?? 'a free-provider key',
      });
    case 'configure_local_or_free_model':
      return localize('com_work_readiness_configure_local_or_free_model');
    case 'correct_endpoint_name_conflict':
      return localize('com_work_readiness_correct_endpoint_name_conflict');
    case 'use_verified_free_or_local_model':
      return localize('com_work_readiness_use_verified_free_or_local_model');
    case 'inspect_rejected_free_endpoint':
      return localize('com_work_readiness_inspect_rejected_free_endpoint');
    case 'create_agent_after_model_available':
      return localize('com_work_readiness_create_agent_after_model_available');
    default:
      return localize('com_work_models_empty');
  }
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

/** The in-task composer applies a new selection to the open Work conversation. */
export function WorkAgentConversationSelector() {
  const localize = useLocalize();
  const { options, isLoading, modelsQuery, agentsQuery, readinessQuery } = useWorkOptions();
  const { conversation, isSubmitting } = useChatContext();
  const { selectionKey } = useConversationMode();
  const [storedSelection, setSelection] = useAtom(workSelectionFamily(selectionKey));
  const selection = storedSelection
    ? sanitizeWorkSelection(storedSelection, options)
    : workSelectionFromConversation(conversation, options);
  const readinessAction = readinessQuery.data?.readiness.nextActionDescriptor;
  const hasProviderModel = options.models.some((model) => model.engine == null);

  const apply = (next: WorkSelection) => {
    const resolved = resolveWorkSelection(next, options);
    if (!resolved) {
      return;
    }
    setSelection(next);
  };

  return (
    <div className="flex min-w-0 items-center gap-1" data-testid="work-agent-selection">
      <WorkModelSelect
        options={options}
        selection={selection}
        onChange={apply}
        disabled={isSubmitting || isLoading || modelsQuery.isError}
        id="work-model-composer"
        className="w-full max-w-full"
      />
      <WorkAgentSelect
        options={options}
        selection={selection}
        onChange={apply}
        disabled={isSubmitting || isLoading || modelsQuery.isError || agentsQuery.isError}
        id="work-agent-composer"
        className="w-full max-w-full"
      />
      {isLoading && (
        <span role="status" className="text-text-secondary text-xs">
          {localize('com_work_models_loading')}
        </span>
      )}
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
      {!isLoading && !modelsQuery.isError && !hasProviderModel && (
        <span role="alert" className="text-text-secondary text-xs">
          {readinessQuery.isError
            ? localize('com_work_readiness_unavailable')
            : readinessAction
              ? localizeWorkReadinessAction(readinessAction, localize)
              : localize('com_work_models_empty')}
        </span>
      )}
    </div>
  );
}
