import { useMemo } from 'react';
import { useAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import * as Ariakit from '@ariakit/react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { QueryKeys, SystemRoles, dataService } from 'coderax-data-provider';
import type { TWorkAgent, TWorkModel, TWorkReadinessAction } from 'coderax-data-provider';
import type { ReactNode } from 'react';
import type { WorkOptions, WorkSelection } from './workSelection';
import type { WorkMode } from './workSelection';
import {
  workSelectionFromConversation,
  sanitizeWorkSelection,
  resolveWorkSelection,
  getWorkModelKey,
  selectWorkAgent,
  selectWorkMode,
  isWorkMode,
  WORK_AUTOMATIC,
  WORK_MODES,
  WORK_OPENCODE_ENGINE,
  toWorkOptions,
} from './workSelection';
import { chipClasses, chipMenuClasses, chipMenuHeadingClasses, chipMenuItemClasses } from './chip';
import { WorkProviderStatus } from './WorkProviderStatus';
import { createStorageAtom } from '~/store/jotai-utils';
import { useAuthContext, useLocalize } from '~/hooks';
import { useConversationMode } from '../mode';
import { useChatContext } from '~/Providers';
import { cn } from '~/utils';

export { getWorkModelKey } from './workSelection';

/** The last Work selection, re-validated against the server's offer on every read. */
export const workSelectionFamily = atomFamily((key: string) =>
  createStorageAtom<WorkSelection | null>(`workSelection:${key}`, null),
);

/** The server exposes the OpenCode engine only to the owner; the picker mirrors that gate. */
const openCodeEngine: TWorkModel = {
  id: WORK_OPENCODE_ENGINE,
  label: 'OpenCode',
  provider: WORK_OPENCODE_ENGINE,
  engine: WORK_OPENCODE_ENGINE,
};

/** Work's own catalog: free/local models, available engines, and agents whose graph runs on them. */
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

type WorkSelectOption = { value: string; label: string; description?: string };

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
  const selectOptions: WorkSelectOption[] = [];
  if (showAutomatic) {
    selectOptions.push({
      value: WORK_AUTOMATIC,
      label: localize('com_work_automatic_model'),
      description: localize('com_work_automatic_model_description'),
    });
  }
  if (!showAutomatic && models.length === 0) {
    selectOptions.push({ value: WORK_AUTOMATIC, label: localize('com_ui_model') });
  }
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
      title={agent ? localize('com_work_model_set_by_agent') : undefined}
      details={<WorkProviderStatus />}
      value={selection.modelKey}
      options={selectOptions}
      onChange={(modelKey) => onChange({ ...selection, agentId: WORK_AUTOMATIC, modelKey })}
      disabled={disabled || agent != null || (models.length === 0 && !showAutomatic)}
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
  const modeOptions: WorkSelectOption[] = WORK_MODES.map((mode) => ({
    value: `work-mode:${mode}`,
    label: workModeLabel(mode, localize),
    description: workModeDescription(mode, localize),
  }));
  const selectOptions: WorkSelectOption[] = [
    ...modeOptions,
    ...options.agents.map((agent) => ({ value: agent.id, label: agentLabel(agent, localize) })),
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
        const agent = options.agents.find((option) => option.id === value) ?? null;
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
  const { options, isLoading, modelsQuery, agentsQuery, readinessQuery } = useWorkOptions();
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
      {!isLoading && !modelsQuery.isError && !hasProviderModel && (
        <span role="alert" className="text-text-secondary text-xs">
          {readinessLabel}
        </span>
      )}
    </div>
  );
}
