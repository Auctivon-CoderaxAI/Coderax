import { useMemo } from 'react';
import { useAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import * as Ariakit from '@ariakit/react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { QueryKeys, dataService } from 'coderax-data-provider';
import type {
  TWorkAgent,
  TWorkAgentIdentity,
  TWorkAgentId,
  TWorkModel,
  TWorkReadinessAction,
  TWorkRoutingMode,
} from 'coderax-data-provider';
import type { ReactNode } from 'react';
import type { WorkOptions, WorkSelection } from './workSelection';
import type { WorkMode } from './workSelection';
import {
  workSelectionFromConversation,
  sanitizeWorkSelection,
  resolveWorkSelection,
  getWorkModelKey,
  selectWorkAgent,
  selectWorkAgentIdentity,
  selectWorkMode,
  isWorkMode,
  workAgentOf,
  workIdentities,
  WORK_AUTOMATIC,
  WORK_MODES,
  toWorkOptions,
} from './workSelection';
import { chipClasses, chipMenuClasses, chipMenuHeadingClasses, chipMenuItemClasses } from './chip';
import { WorkProviderStatus } from './WorkProviderStatus';
import { createStorageAtom } from '~/store/jotai-utils';
import { useLocalize } from '~/hooks';
import { useConversationMode } from '../mode';
import { useChatContext } from '~/Providers';
import { cn } from '~/utils';

export { getWorkModelKey } from './workSelection';

/** The last Work selection, re-validated against the server's offer on every read. */
export const workSelectionFamily = atomFamily((key: string) =>
  createStorageAtom<WorkSelection | null>(`workSelection:${key}`, null),
);

/** Work's own catalog: models, saved agents, and the three engine identities. */
export function useWorkOptions({ enabled = true }: { enabled?: boolean } = {}) {
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
  const identitiesQuery = useQuery({
    queryKey: [QueryKeys.workAgentIdentities],
    queryFn: () => dataService.getWorkAgentIdentities(),
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
  const options = useMemo(
    () =>
      toWorkOptions(
        modelsQuery.data?.models,
        agentsQuery.data?.agents,
        modelsQuery.data?.routingModes,
        identitiesQuery.data?.agents,
      ),
    [modelsQuery.data, agentsQuery.data, identitiesQuery.data],
  );

  return {
    options,
    modelsQuery,
    agentsQuery,
    identitiesQuery,
    readinessQuery,
    isLoading: modelsQuery.isLoading || agentsQuery.isLoading || identitiesQuery.isLoading,
  };
}

function agentLabel(agent: TWorkAgent, localize: ReturnType<typeof useLocalize>): string {
  const name = agent.name?.trim() || agent.id;
  return agent.members.length > 0
    ? localize('com_work_agent_coordinates', { 0: name, 1: agent.members.length })
    : name;
}

function workModeLabel(mode: WorkMode, localize: ReturnType<typeof useLocalize>): string {
  switch (mode) {
    case 'build':
      return localize('com_work_mode_build');
    case 'plan':
      return localize('com_work_mode_plan');
    case 'mission':
      return localize('com_work_mode_mission');
    case 'skills':
      return localize('com_work_mode_skills');
  }
}

function workModeDescription(mode: WorkMode, localize: ReturnType<typeof useLocalize>): string {
  switch (mode) {
    case 'build':
      return localize('com_work_mode_build_description');
    case 'plan':
      return localize('com_work_mode_plan_description');
    case 'mission':
      return localize('com_work_mode_mission_description');
    case 'skills':
      return localize('com_work_mode_skills_description');
  }
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

type WorkSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

function routingModeLabel(
  mode: TWorkRoutingMode,
  localize: ReturnType<typeof useLocalize>,
): string {
  switch (mode) {
    case 'fast':
      return localize('com_work_routing_fast');
    case 'complex':
      return localize('com_work_routing_complex');
    case 'agent':
      return localize('com_work_routing_agent');
    default:
      return localize('com_work_automatic_model');
  }
}

/** A composer-sized select with a themed popup; the native select popup ignores the app theme. */
function WorkSelect({
  id,
  label,
  title,
  value,
  options,
  onChange,
  disabled = false,
  className,
  details,
}: {
  id: string;
  label: string;
  title?: string;
  value: string;
  options: WorkSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Server-reported status shown under the options, e.g. provider availability. */
  details?: ReactNode;
}) {
  const menuStore = Ariakit.useMenuStore({ focusLoop: true, placement: 'top-start' });
  const isOpen = menuStore.useState('open');
  const workMenuClasses = cn(chipMenuClasses, 'w-[min(21rem,calc(100vw-2rem))]');
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <Ariakit.MenuProvider store={menuStore}>
      <Ariakit.MenuButton
        id={id}
        render={<button type="button" />}
        aria-label={label}
        title={title ?? selected?.label ?? label}
        disabled={disabled}
        className={cn(
          chipClasses,
          'w-auto shrink justify-between gap-1.5 px-2.5 text-left',
          isOpen && 'bg-surface-hover',
          disabled && 'cursor-default opacity-70',
          className,
        )}
      >
        <span className="max-w-full min-w-0 truncate">{selected?.label ?? label}</span>
        <ChevronDown
          className={cn(
            'text-text-secondary size-3 shrink-0 transition-transform',
            isOpen && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </Ariakit.MenuButton>
      <Ariakit.Menu portal gutter={8} unmountOnHide className={workMenuClasses}>
        <Ariakit.MenuHeading render={<div />} className={chipMenuHeadingClasses}>
          {label}
        </Ariakit.MenuHeading>
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <Ariakit.MenuItemRadio
              key={option.value}
              name={id}
              value={option.value}
              checked={isSelected}
              disabled={option.disabled}
              hideOnClick
              onChange={() => onChange(option.value)}
              className={cn(chipMenuItemClasses(isSelected), 'items-start')}
            >
              <span className="min-w-0 flex-1 text-left">
                <span className="text-text-primary block text-sm whitespace-normal">
                  {option.label}
                </span>
                {option.description != null && (
                  <span className="text-text-secondary mt-0.5 block text-xs whitespace-normal">
                    {option.description}
                  </span>
                )}
              </span>
              {isSelected && (
                <Check className="text-text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
            </Ariakit.MenuItemRadio>
          );
        })}
        {details}
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
  );
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
  const externalAgent = workAgentOf(selection) !== 'coderax';
  const agent =
    selection.agentId === WORK_AUTOMATIC
      ? undefined
      : options.agents.find((option) => option.id === selection.agentId);
  /** A saved agent runs on its own model, so the model is shown, not offered. */
  const models = (agent
    ? options.models.filter(
        (model) => model.id === agent.model && model.provider === agent.provider,
      )
    : options.models
  ).filter((model) => model.engine == null);
  const showAutomatic = !agent && options.auto?.target != null;
  const routing = !agent
    ? (options.routing ?? []).filter((route) => route.routingMode != null && route.target != null)
    : [];
  const selectOptions: WorkSelectOption[] = [];
  for (const route of routing) {
    if (route.routingMode == null || route.target == null) {
      continue;
    }
    selectOptions.push({
      value: route.routingMode,
      label: routingModeLabel(route.routingMode, localize),
      description:
        route.routingMode === 'auto'
          ? localize('com_work_automatic_model_description')
          : localize('com_work_routing_target', { 0: route.target.label }),
    });
  }
  if (routing.length === 0 && showAutomatic) {
    selectOptions.push({
      value: WORK_AUTOMATIC,
      label: localize('com_work_automatic_model'),
      description: localize('com_work_automatic_model_description'),
    });
  }
  if (selectOptions.length === 0 && models.length === 0) {
    selectOptions.push({ value: WORK_AUTOMATIC, label: localize('com_ui_model') });
  }
  const hasSelectableModel = models.length > 0 || showAutomatic || routing.length > 0;
  for (const model of models) {
    selectOptions.push({
      value: getWorkModelKey(model),
      label: model.label?.trim() || model.id,
    });
  }

  return (
    <WorkSelect
      id={id}
      label={localize('com_ui_model')}
      title={
        externalAgent
          ? localize('com_work_agent_model_external')
          : agent
            ? localize('com_work_model_set_by_agent')
            : undefined
      }
      details={<WorkProviderStatus />}
      value={selection.modelKey}
      options={selectOptions}
      onChange={(modelKey) => onChange({ ...selection, agentId: WORK_AUTOMATIC, modelKey })}
      disabled={
        disabled || externalAgent || agent != null || !hasSelectableModel
      }
      className={className}
    />
  );
}

function agentIdentityLabel(
  identity: TWorkAgentIdentity,
  localize: ReturnType<typeof useLocalize>,
): string {
  switch (identity.id) {
    case 'coderax':
      return localize('com_work_agent_coderax');
    case 'opencode':
      return localize('com_work_agent_opencode');
    case 'freebuff':
      return localize('com_work_agent_freebuff');
  }
}

function agentIdentityDescription(
  identity: TWorkAgentIdentity,
  localize: ReturnType<typeof useLocalize>,
): string {
  if (!identity.availability.available) {
    return identity.availability.detail ?? localize('com_work_agent_unavailable');
  }
  switch (identity.id) {
    case 'coderax':
      return localize('com_work_agent_coderax_description');
    case 'opencode':
      return localize('com_work_agent_opencode_description');
    case 'freebuff':
      return localize('com_work_agent_freebuff_description');
  }
}

/** Exactly three identities; external choices are disabled when their engine cannot run. */
export function WorkAgentIdentitySelect({
  options,
  selection,
  onChange,
  disabled = false,
  id = 'work-agent-identity',
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
  const identities = workIdentities(options);
  const selected = workAgentOf(selection);
  const selectOptions: WorkSelectOption[] = identities.map((identity) => ({
    value: identity.id,
    label: agentIdentityLabel(identity, localize),
    description: agentIdentityDescription(identity, localize),
    disabled: identity.id !== 'coderax' && !identity.availability.available,
  }));

  return (
    <WorkSelect
      id={id}
      label={localize('com_work_agent_identity')}
      value={selected}
      options={selectOptions}
      onChange={(value) => {
        if (value === 'coderax' || value === 'opencode' || value === 'freebuff') {
          onChange(selectWorkAgentIdentity(selection, value as TWorkAgentId));
        }
      }}
      disabled={disabled}
      className={className}
    />
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
  const externalAgent = workAgentOf(selection) !== 'coderax';
  const modeOptions: WorkSelectOption[] = WORK_MODES.map((mode) => ({
    value: `work-mode:${mode}`,
    label: workModeLabel(mode, localize),
    description: workModeDescription(mode, localize),
  }));
  const nativeAgents = externalAgent ? [] : options.agents;
  const selectOptions: WorkSelectOption[] = [
    ...modeOptions,
    ...nativeAgents.map((agent) => ({ value: agent.id, label: agentLabel(agent, localize) })),
  ];
  const selectedValue =
    selection.agentId === WORK_AUTOMATIC
      ? `work-mode:${selection.mode ?? 'build'}`
      : selection.agentId;

  return (
    <WorkSelect
      id={id}
      label={localize('com_work_agent')}
      value={selectedValue}
      options={selectOptions}
      onChange={(value) => {
        if (value.startsWith('work-mode:')) {
          const mode = value.slice('work-mode:'.length);
          if (isWorkMode(mode)) {
            onChange(selectWorkMode(selection, mode));
          }
          return;
        }
        const agent = nativeAgents.find((option) => option.id === value) ?? null;
        onChange(selectWorkAgent(selection, agent));
      }}
      disabled={disabled}
      className={className}
    />
  );
}

/** The in-task composer applies a new selection to the open Work conversation. */
export function WorkAgentConversationSelector() {
  const localize = useLocalize();
  const { options, isLoading, modelsQuery, agentsQuery, identitiesQuery, readinessQuery } =
    useWorkOptions();
  const { conversation, isSubmitting } = useChatContext();
  const { selectionKey } = useConversationMode();
  const [storedSelection, setSelection] = useAtom(workSelectionFamily(selectionKey));
  const selection = storedSelection
    ? sanitizeWorkSelection(storedSelection, options)
    : workSelectionFromConversation(conversation, options);
  const readinessAction = readinessQuery.data?.readiness.nextActionDescriptor;
  const hasProviderModel = options.models.some((model) => model.engine == null);
  const readinessLabel = (() => {
    if (readinessQuery.isError) {
      return localize('com_work_readiness_unavailable');
    }
    if (readinessAction) {
      return localizeWorkReadinessAction(readinessAction, localize);
    }
    return localize('com_work_models_empty');
  })();

  const apply = (next: WorkSelection) => {
    const resolved = resolveWorkSelection(next, options);
    if (!resolved) {
      return;
    }
    setSelection(next);
  };

  return (
    <div className="flex min-w-0 items-center gap-1" data-testid="work-agent-selection">
      <WorkAgentIdentitySelect
        options={options}
        selection={selection}
        onChange={apply}
        disabled={isSubmitting || isLoading || identitiesQuery.isError}
        id="work-agent-identity-composer"
        className="max-w-[14rem]"
      />
      <WorkModelSelect
        options={options}
        selection={selection}
        onChange={apply}
        disabled={isSubmitting || isLoading || modelsQuery.isError}
        id="work-model-composer"
        className="max-w-[16rem]"
      />
      <WorkAgentSelect
        options={options}
        selection={selection}
        onChange={apply}
        disabled={isSubmitting || isLoading || modelsQuery.isError || agentsQuery.isError}
        id="work-agent-composer"
        className="max-w-[10rem]"
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
      {identitiesQuery.isError && (
        <span role="alert" className="text-text-secondary text-xs">
          {localize('com_work_agent_identities_unavailable')}
        </span>
      )}
      {!isLoading && !modelsQuery.isError && !hasProviderModel && (
        <span role="alert" className="text-text-secondary text-xs">
          {readinessLabel}
        </span>
      )}
    </div>
  );
}
