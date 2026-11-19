import { useCallback, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PermissionBits, QueryKeys, dataService } from 'coderax-data-provider';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  Pause,
  Play,
  Plus,
  Rocket,
  RotateCcw,
  Trash2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import type {
  WorkflowEventTrigger,
  WorkflowRunListResponse,
  WorkflowRunStatus,
  WorkflowRunView,
  WorkflowScheduleInput,
  WorkflowStepCondition,
  WorkflowStepConditionStatus,
  WorkflowStepInput,
  WorkflowStepJoin,
  WorkflowStepStatus,
  WorkflowTemplate,
  WorkflowView,
} from 'coderax-data-provider';
import type { FormEvent } from 'react';
import type { TranslationKeys } from '~/hooks';
import {
  useApproveWorkflowStepMutation,
  useCancelWorkflowRunMutation,
  useCreateWorkflowMutation,
  useDeleteWorkflowMutation,
  useListAgentsQuery,
  usePauseWorkflowRunMutation,
  useResumeWorkflowRunMutation,
  useStartWorkflowRunMutation,
  useUpdateWorkflowMutation,
  useWorkflowRunStream,
  useWorkflowRunsQuery,
  useWorkflowTemplatesQuery,
  useWorkflowsQuery,
} from '~/data-provider';
import BuildLauncher from './BuildLauncher';
import { triggerDownload } from '~/utils/downloadFile';
import { useLocalize } from '~/hooks';

const RUN_STATUS_LABELS: Record<WorkflowRunStatus, TranslationKeys> = {
  queued: 'com_ui_workflow_status_queued',
  running: 'com_ui_workflow_status_running',
  paused: 'com_ui_workflow_status_paused',
  waiting_approval: 'com_ui_workflow_status_waiting_approval',
  completed: 'com_ui_workflow_status_completed',
  failed: 'com_ui_workflow_status_failed',
  cancelled: 'com_ui_workflow_status_cancelled',
};

const STEP_STATUS_LABELS: Record<WorkflowStepStatus, TranslationKeys> = {
  pending: 'com_ui_workflow_step_pending',
  queued: 'com_ui_workflow_step_queued',
  running: 'com_ui_workflow_step_running',
  completed: 'com_ui_workflow_step_completed',
  failed: 'com_ui_workflow_step_failed',
  skipped: 'com_ui_workflow_step_skipped',
  cancelled: 'com_ui_workflow_step_cancelled',
};

const TRIGGER_LABELS: Record<NonNullable<WorkflowRunView['trigger']>['type'], TranslationKeys> = {
  manual: 'com_ui_workflow_trigger_manual',
  schedule: 'com_ui_workflow_trigger_schedule',
  event: 'com_ui_workflow_trigger_event',
};

const TERMINAL_RUN_STATUSES: WorkflowRunStatus[] = ['completed', 'failed', 'cancelled'];

const RUN_TONE: Record<WorkflowRunStatus, string> = {
  queued: 'text-text-secondary',
  running: 'text-text-primary',
  paused: 'text-status-warning',
  waiting_approval: 'text-status-warning',
  completed: 'text-text-primary',
  failed: 'text-status-error',
  cancelled: 'text-text-secondary',
};

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

type DraftFrequency = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'cron';

interface DraftCondition {
  stepId: string;
  status: WorkflowStepConditionStatus;
  resultIncludes: string;
}

interface DraftEventTrigger {
  eventType: string;
  sourceId: string;
  input: string;
}

interface DraftStep {
  id: string;
  title: string;
  instruction: string;
  approvalRequired: boolean;
  maxAttempts: number;
  timeoutMs?: number;
  agentId: string;
  dependsOn: string[];
  runIf: DraftCondition[];
  join: WorkflowStepJoin;
}

interface Draft {
  id?: string;
  name: string;
  description: string;
  agentId: string;
  steps: DraftStep[];
  maxParallel: number;
  stepTimeoutMs?: number;
  scheduleEnabled: boolean;
  scheduleFrequency: DraftFrequency;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleDay: number;
  scheduleCron: string;
  scheduleTimezone: string;
  scheduleDaysOfWeek: number[];
  scheduleInput: string;
  eventTriggers: DraftEventTrigger[];
  onCompleteWorkflowId: string;
}

function newStep(index: number, previousId?: string): DraftStep {
  return {
    id: `step-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    instruction: '',
    approvalRequired: false,
    maxAttempts: 3,
    agentId: '',
    dependsOn: previousId == null ? [] : [previousId],
    runIf: [],
    join: 'all',
  };
}

function resolvedDependencies(step: DraftStep): string[] {
  // Missing dependencies are defaulted when a workflow is loaded. An explicit
  // empty list means an independent root and must not become linear again.
  return step.dependsOn;
}

function conditionsOf(step: WorkflowStepInput): WorkflowStepCondition[] {
  if (step.runIf == null) {
    return [];
  }
  return Array.isArray(step.runIf) ? step.runIf : [step.runIf];
}

function toDraftStep(
  step: WorkflowStepInput,
  index: number,
  input: WorkflowStepInput[],
): DraftStep {
  return {
    id: step.id,
    title: step.title,
    instruction: step.instruction,
    approvalRequired: step.approvalRequired === true,
    maxAttempts: step.maxAttempts ?? 3,
    ...(step.timeoutMs != null ? { timeoutMs: step.timeoutMs } : {}),
    agentId: step.agentId ?? '',
    dependsOn: step.dependsOn ?? (index === 0 ? [] : [input[index - 1].id]),
    runIf: conditionsOf(step).map((condition) => ({
      stepId: condition.stepId,
      status: condition.status ?? 'completed',
      resultIncludes: condition.resultIncludes ?? '',
    })),
    join: step.join ?? 'all',
  };
}

function timezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function toDraft(workflow: WorkflowView): Draft {
  const cadence = workflow.schedule?.cadence;
  let scheduleFrequency: DraftFrequency = 'daily';
  if (cadence != null) {
    scheduleFrequency = cadence.frequency === 'cron' ? 'cron' : cadence.frequency;
  }
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description ?? '',
    agentId: workflow.agentId,
    steps: workflow.steps.map((step, index) => toDraftStep(step, index, workflow.steps)),
    maxParallel: workflow.settings?.maxParallel ?? 2,
    ...(workflow.settings?.stepTimeoutMs != null
      ? { stepTimeoutMs: workflow.settings.stepTimeoutMs }
      : {}),
    scheduleEnabled: workflow.schedule?.enabled === true,
    scheduleFrequency,
    scheduleHour: cadence == null || cadence.frequency === 'cron' ? 9 : cadence.hour,
    scheduleMinute: cadence == null || cadence.frequency === 'cron' ? 0 : cadence.minute,
    scheduleDay:
      cadence != null && cadence.frequency === 'weekly' ? (cadence.daysOfWeek?.[0] ?? 1) : 1,
    scheduleCron:
      cadence != null && cadence.frequency === 'cron' ? cadence.expression : '0 9 * * 1-5',
    scheduleTimezone: workflow.schedule?.timezone ?? timezone(),
    scheduleDaysOfWeek:
      cadence != null && cadence.frequency === 'weekly' ? (cadence.daysOfWeek ?? [1]) : [1],
    scheduleInput: workflow.schedule?.input ?? '',
    eventTriggers: (workflow.eventTriggers ?? []).map((trigger) => ({
      eventType: trigger.eventType,
      sourceId: trigger.sourceId ?? '',
      input: trigger.input ?? '',
    })),
    onCompleteWorkflowId: workflow.onCompleteWorkflowId ?? '',
  };
}

function fromTemplate(template: WorkflowTemplate, agentId: string): Draft {
  return {
    name: template.name,
    description: template.description,
    agentId,
    steps: template.steps.map((step, index) => toDraftStep(step, index, template.steps)),
    maxParallel: template.settings?.maxParallel ?? 2,
    ...(template.settings?.stepTimeoutMs != null
      ? { stepTimeoutMs: template.settings.stepTimeoutMs }
      : {}),
    scheduleEnabled: false,
    scheduleFrequency: 'daily',
    scheduleHour: 9,
    scheduleMinute: 0,
    scheduleDay: 1,
    scheduleCron: '0 9 * * 1-5',
    scheduleTimezone: timezone(),
    scheduleDaysOfWeek: [1],
    scheduleInput: '',
    eventTriggers: [],
    onCompleteWorkflowId: '',
  };
}

function toStepInput(step: DraftStep): WorkflowStepInput {
  const conditions: WorkflowStepCondition[] = step.runIf
    .filter((condition) => condition.stepId.length > 0)
    .map((condition) => ({
      stepId: condition.stepId,
      status: condition.status,
      ...(condition.resultIncludes.trim().length > 0
        ? { resultIncludes: condition.resultIncludes.trim() }
        : {}),
    }));
  return {
    id: step.id,
    title: step.title.trim(),
    instruction: step.instruction.trim(),
    ...(step.approvalRequired ? { approvalRequired: true } : {}),
    maxAttempts: step.maxAttempts,
    ...(step.timeoutMs != null ? { timeoutMs: step.timeoutMs } : {}),
    ...(step.agentId.length > 0 ? { agentId: step.agentId } : {}),
    dependsOn: resolvedDependencies(step),
    join: step.join,
    ...(conditions.length === 0
      ? {}
      : { runIf: conditions.length === 1 ? conditions[0] : conditions }),
  };
}

function toEventTriggers(draft: Draft): WorkflowEventTrigger[] {
  return draft.eventTriggers
    .map((trigger) => ({
      eventType: trigger.eventType.trim(),
      ...(trigger.sourceId.trim().length > 0 ? { sourceId: trigger.sourceId.trim() } : {}),
      ...(trigger.input.trim().length > 0 ? { input: trigger.input.trim() } : {}),
    }))
    .filter((trigger) => trigger.eventType.length > 0);
}

function toSchedule(draft: Draft): WorkflowScheduleInput | null {
  if (!draft.scheduleEnabled) {
    return null;
  }
  const cadence: WorkflowScheduleInput['cadence'] =
    draft.scheduleFrequency === 'cron'
      ? { frequency: 'cron', expression: draft.scheduleCron.trim() }
      : {
          frequency: draft.scheduleFrequency,
          hour: draft.scheduleHour,
          minute: draft.scheduleMinute,
          ...(draft.scheduleFrequency === 'weekly'
            ? {
                daysOfWeek:
                  draft.scheduleDaysOfWeek.length > 0
                    ? draft.scheduleDaysOfWeek
                    : [draft.scheduleDay],
              }
            : {}),
        };
  return {
    enabled: true,
    cadence,
    timezone: draft.scheduleTimezone.trim(),
    ...(draft.scheduleInput.trim().length > 0 ? { input: draft.scheduleInput.trim() } : {}),
  };
}

function responseError(error: unknown): string | undefined {
  const response = (error as { response?: { data?: { error?: unknown } } } | null)?.response;
  const message = response?.data?.error;
  return typeof message === 'string' ? message : undefined;
}

function formatInstant(value: string | undefined): string | null {
  if (value == null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function WorkflowEditor({
  workflow,
  workflows,
  agents,
  onDone,
  onCancel,
}: {
  workflow?: WorkflowView;
  workflows: WorkflowView[];
  agents: Array<{ id: string; name?: string | null }>;
  onDone: (workflow: WorkflowView) => void;
  onCancel: () => void;
}) {
  const localize = useLocalize();
  const nameId = useId();
  const descriptionId = useId();
  const agentId = useId();
  const templateId = useId();
  const { data: templates } = useWorkflowTemplatesQuery();
  const [draft, setDraft] = useState<Draft>(() =>
    workflow != null
      ? toDraft(workflow)
      : {
          name: '',
          description: '',
          agentId: agents[0]?.id ?? '',
          steps: [newStep(0)],
          maxParallel: 2,
          scheduleEnabled: false,
          scheduleFrequency: 'daily',
          scheduleHour: 9,
          scheduleMinute: 0,
          scheduleDay: 1,
          scheduleCron: '0 9 * * 1-5',
          scheduleTimezone: timezone(),
          scheduleDaysOfWeek: [1],
          scheduleInput: '',
          eventTriggers: [],
          onCompleteWorkflowId: '',
        },
  );
  const createMutation = useCreateWorkflowMutation();
  const updateMutation = useUpdateWorkflowMutation(workflow?.id ?? '');
  const pending = createMutation.isLoading || updateMutation.isLoading;
  const failure =
    responseError(createMutation.error) ?? responseError(updateMutation.error) ?? undefined;

  const canSave =
    draft.name.trim().length > 0 &&
    draft.agentId.trim().length > 0 &&
    draft.steps.length > 0 &&
    draft.steps.every(
      (step) => step.title.trim().length > 0 && step.instruction.trim().length > 0,
    ) &&
    (!draft.scheduleEnabled ||
      (draft.scheduleTimezone.trim().length > 0 &&
        (draft.scheduleFrequency !== 'cron' || draft.scheduleCron.trim().length > 0))) &&
    draft.eventTriggers.every((trigger) => trigger.eventType.trim().length > 0);

  const patchStep = (index: number, patch: Partial<DraftStep>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, position) =>
        position === index ? { ...step, ...patch } : step,
      ),
    }));
  };

  const patchCondition = (
    stepIndex: number,
    conditionIndex: number,
    patch: Partial<DraftCondition>,
  ) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((entry, position) =>
        position !== stepIndex
          ? entry
          : {
              ...entry,
              runIf: entry.runIf.map((condition, index) =>
                index === conditionIndex ? { ...condition, ...patch } : condition,
              ),
            },
      ),
    }));
  };

  const patchEventTrigger = (index: number, patch: Partial<DraftEventTrigger>) => {
    setDraft((current) => ({
      ...current,
      eventTriggers: current.eventTriggers.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    }));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.steps.length) {
        return current;
      }
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps };
    });
  };

  const applyTemplate = (template: WorkflowTemplate) => {
    setDraft((current) => ({
      ...fromTemplate(template, current.agentId || agents[0]?.id || ''),
      scheduleTimezone: current.scheduleTimezone,
    }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || pending) {
      return;
    }
    const payload = {
      name: draft.name.trim(),
      ...(draft.description.trim().length > 0 ? { description: draft.description.trim() } : {}),
      agentId: draft.agentId,
      steps: draft.steps.map((step) => toStepInput(step)),
      settings: {
        maxParallel: draft.maxParallel,
        ...(draft.stepTimeoutMs != null ? { stepTimeoutMs: draft.stepTimeoutMs } : {}),
      },
      schedule: toSchedule(draft),
      eventTriggers: toEventTriggers(draft),
      ...(draft.onCompleteWorkflowId.length > 0
        ? { onCompleteWorkflowId: draft.onCompleteWorkflowId }
        : {}),
    };
    if (workflow != null) {
      // An omitted field means "leave unchanged"; null is the explicit unlink.
      updateMutation.mutate(
        draft.onCompleteWorkflowId.length > 0
          ? payload
          : { ...payload, onCompleteWorkflowId: null },
        { onSuccess: (saved) => onDone(saved) },
      );
      return;
    }
    createMutation.mutate(payload, { onSuccess: (saved) => onDone(saved) });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {workflow == null ? localize('com_ui_workflow_new') : localize('com_ui_workflow_edit')}
        </h2>
        <button
          type="button"
          className="text-text-secondary hover:bg-surface-active rounded-md px-2 py-1 text-sm"
          onClick={onCancel}
        >
          {localize('com_ui_workflow_cancel')}
        </button>
      </div>

      {workflow == null && (templates?.templates.length ?? 0) > 0 && (
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor={templateId}>
            {localize('com_ui_workflow_templates')}
          </label>
          <select
            id={templateId}
            className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
            defaultValue=""
            onChange={(event) => {
              const template = templates?.templates.find(
                (entry) => entry.id === event.target.value,
              );
              if (template != null) {
                applyTemplate(template);
              }
            }}
          >
            <option value="">{localize('com_ui_workflow_template_blank')}</option>
            {(templates?.templates ?? []).map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <p className="text-text-secondary mt-1 text-xs">
            {localize('com_ui_workflow_template_hint')}
          </p>
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor={nameId}>
          {localize('com_ui_workflow_name')}
        </label>
        <input
          id={nameId}
          className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
          value={draft.name}
          maxLength={120}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor={descriptionId}>
          {localize('com_ui_workflow_description')}
        </label>
        <textarea
          id={descriptionId}
          className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
          rows={2}
          maxLength={2000}
          value={draft.description}
          onChange={(event) =>
            setDraft((current) => ({ ...current, description: event.target.value }))
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor={agentId}>
            {localize('com_ui_workflow_agent')}
          </label>
          <select
            id={agentId}
            className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
            value={draft.agentId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, agentId: event.target.value }))
            }
          >
            {agents.length === 0 ? (
              <option value="">{localize('com_ui_workflow_no_agents')}</option>
            ) : (
              agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name || agent.id}
                </option>
              ))
            )}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor={`${nameId}-parallel`}>
            {localize('com_ui_workflow_max_parallel')}
          </label>
          <input
            id={`${nameId}-parallel`}
            type="number"
            min={1}
            max={8}
            className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
            value={draft.maxParallel}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                maxParallel: Math.min(8, Math.max(1, Number(event.target.value) || 1)),
              }))
            }
          />
          <p className="text-text-secondary mt-1 text-xs">
            {localize('com_ui_workflow_max_parallel_hint')}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{localize('com_ui_workflow_steps')}</h3>
          <button
            type="button"
            className="border-border-medium hover:bg-surface-active flex items-center gap-1 rounded-md border px-2 py-1 text-sm"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                steps: [
                  ...current.steps,
                  newStep(current.steps.length, current.steps[current.steps.length - 1]?.id),
                ],
              }))
            }
          >
            <Plus className="h-4 w-4" aria-hidden />
            {localize('com_ui_workflow_add_step')}
          </button>
        </div>

        {draft.steps.map((step, index) => (
          <div
            key={step.id}
            className="border-border-light bg-surface-secondary rounded-xl border p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-text-secondary text-xs font-semibold">
                {index + 1}. {localize('com_ui_workflow_step')}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="hover:bg-surface-active rounded p-1 disabled:opacity-40"
                  aria-label={localize('com_ui_workflow_move_up')}
                  disabled={index === 0}
                  onClick={() => moveStep(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  className="hover:bg-surface-active rounded p-1 disabled:opacity-40"
                  aria-label={localize('com_ui_workflow_move_down')}
                  disabled={index === draft.steps.length - 1}
                  onClick={() => moveStep(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  className="text-status-error hover:bg-surface-active rounded p-1 disabled:opacity-40"
                  aria-label={localize('com_ui_workflow_remove_step')}
                  disabled={draft.steps.length === 1}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      steps: current.steps.filter((_entry, position) => position !== index),
                    }))
                  }
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>

            <label className="sr-only" htmlFor={`${step.id}-title`}>
              {localize('com_ui_workflow_step_title')}
            </label>
            <input
              id={`${step.id}-title`}
              className="border-border-medium bg-surface-primary mb-2 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder={localize('com_ui_workflow_step_title')}
              maxLength={120}
              value={step.title}
              onChange={(event) => patchStep(index, { title: event.target.value })}
            />
            <label className="sr-only" htmlFor={`${step.id}-instruction`}>
              {localize('com_ui_workflow_step_instruction')}
            </label>
            <textarea
              id={`${step.id}-instruction`}
              className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
              placeholder={localize('com_ui_workflow_step_instruction')}
              rows={3}
              maxLength={8000}
              value={step.instruction}
              onChange={(event) => patchStep(index, { instruction: event.target.value })}
            />

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-text-secondary text-xs">
                <span className="mb-1 block">{localize('com_ui_workflow_step_agent')}</span>
                <select
                  className="border-border-medium bg-surface-primary w-full rounded-md border px-2 py-1 text-sm"
                  value={step.agentId}
                  onChange={(event) => patchStep(index, { agentId: event.target.value })}
                >
                  <option value="">{localize('com_ui_workflow_step_inherit_agent')}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name || agent.id}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-text-secondary text-xs sm:col-span-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span>{localize('com_ui_workflow_condition')}</span>
                  <button
                    type="button"
                    className="border-border-medium hover:bg-surface-active rounded-md border px-2 py-0.5 text-xs"
                    onClick={() =>
                      patchStep(index, {
                        runIf: [
                          ...step.runIf,
                          { stepId: '', status: 'completed', resultIncludes: '' },
                        ],
                      })
                    }
                  >
                    {localize('com_ui_workflow_condition_add')}
                  </button>
                </div>
                {step.runIf.length === 0 && <p>{localize('com_ui_workflow_condition_always')}</p>}
                {step.runIf.map((condition, conditionIndex) => (
                  <div
                    key={`${step.id}-condition-${conditionIndex}`}
                    className="mb-1 flex flex-wrap items-center gap-1"
                  >
                    <select
                      aria-label={localize('com_ui_workflow_condition_select')}
                      className="border-border-medium bg-surface-primary min-w-0 flex-1 rounded-md border px-2 py-1 text-sm"
                      value={condition.stepId}
                      onChange={(event) => {
                        const value = event.target.value;
                        patchCondition(index, conditionIndex, { stepId: value });
                        if (value.length > 0 && !step.dependsOn.includes(value)) {
                          patchStep(index, {
                            dependsOn: Array.from(new Set([...step.dependsOn, value])),
                          });
                        }
                      }}
                    >
                      <option value="">{localize('com_ui_workflow_condition_select')}</option>
                      {draft.steps.slice(0, index).map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.title || candidate.id}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={localize('com_ui_workflow_condition')}
                      className="border-border-medium bg-surface-primary w-28 rounded-md border px-1 py-1 text-sm"
                      value={condition.status}
                      onChange={(event) => {
                        const value = event.target.value;
                        patchCondition(index, conditionIndex, {
                          status: value === 'failed' || value === 'skipped' ? value : 'completed',
                        });
                      }}
                    >
                      <option value="completed">
                        {localize('com_ui_workflow_condition_completed')}
                      </option>
                      <option value="failed">{localize('com_ui_workflow_condition_failed')}</option>
                      <option value="skipped">
                        {localize('com_ui_workflow_condition_skipped')}
                      </option>
                    </select>
                    <input
                      className="border-border-medium bg-surface-primary min-w-0 flex-[2] rounded-md border px-2 py-1 text-sm"
                      aria-label={localize('com_ui_workflow_condition_result')}
                      placeholder={localize('com_ui_workflow_condition_result')}
                      maxLength={200}
                      value={condition.resultIncludes}
                      onChange={(event) =>
                        patchCondition(index, conditionIndex, {
                          resultIncludes: event.target.value,
                        })
                      }
                    />
                    <button
                      type="button"
                      className="text-status-error hover:bg-surface-active rounded p-1"
                      aria-label={localize('com_ui_workflow_condition_remove')}
                      onClick={() =>
                        patchStep(index, {
                          runIf: step.runIf.filter(
                            (_entry, position) => position !== conditionIndex,
                          ),
                        })
                      }
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))}
                <label className="mt-1 flex items-center gap-2">
                  <span>{localize('com_ui_workflow_join')}</span>
                  <select
                    className="border-border-medium bg-surface-primary rounded-md border px-2 py-1 text-sm"
                    aria-label={localize('com_ui_workflow_join')}
                    value={step.join}
                    onChange={(event) =>
                      patchStep(index, {
                        join: event.target.value === 'any' ? 'any' : 'all',
                      })
                    }
                  >
                    <option value="all">{localize('com_ui_workflow_join_all')}</option>
                    <option value="any">{localize('com_ui_workflow_join_any')}</option>
                  </select>
                </label>
              </div>
            </div>

            {index > 0 && (
              <fieldset className="mt-2">
                <legend className="text-text-secondary mb-1 text-xs">
                  {localize('com_ui_workflow_depends_on')}
                </legend>
                <div className="flex flex-wrap gap-3">
                  {draft.steps.slice(0, index).map((candidate) => (
                    <label key={candidate.id} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={step.dependsOn.includes(candidate.id)}
                        onChange={(event) =>
                          patchStep(index, {
                            dependsOn: event.target.checked
                              ? Array.from(new Set([...step.dependsOn, candidate.id]))
                              : step.dependsOn.filter((id) => id !== candidate.id),
                          })
                        }
                      />
                      {candidate.title || candidate.id}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={step.approvalRequired}
                  onChange={(event) => patchStep(index, { approvalRequired: event.target.checked })}
                />
                {localize('com_ui_workflow_step_approval')}
              </label>
              <label className="text-text-secondary flex items-center gap-2">
                {localize('com_ui_workflow_step_attempts')}
                <input
                  type="number"
                  min={1}
                  max={5}
                  className="border-border-medium bg-surface-primary w-16 rounded-md border px-2 py-1"
                  value={step.maxAttempts}
                  onChange={(event) =>
                    patchStep(index, {
                      maxAttempts: Math.min(5, Math.max(1, Number(event.target.value) || 1)),
                    })
                  }
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <fieldset className="border-border-light rounded-xl border p-3">
        <legend className="px-1 text-sm font-semibold">
          {localize('com_ui_workflow_schedule')}
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.scheduleEnabled}
            onChange={(event) =>
              setDraft((current) => ({ ...current, scheduleEnabled: event.target.checked }))
            }
          />
          {localize('com_ui_workflow_schedule_enabled')}
        </label>
        {draft.scheduleEnabled && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-text-secondary text-xs">
              <span className="mb-1 block">{localize('com_ui_workflow_schedule_frequency')}</span>
              <select
                className="border-border-medium bg-surface-primary w-full rounded-md border px-2 py-1 text-sm"
                value={draft.scheduleFrequency}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    scheduleFrequency: event.target.value as DraftFrequency,
                  }))
                }
              >
                <option value="hourly">{localize('com_ui_workflow_frequency_hourly')}</option>
                <option value="daily">{localize('com_ui_workflow_frequency_daily')}</option>
                <option value="weekdays">{localize('com_ui_workflow_frequency_weekdays')}</option>
                <option value="weekly">{localize('com_ui_workflow_frequency_weekly')}</option>
                <option value="cron">{localize('com_ui_workflow_frequency_cron')}</option>
              </select>
            </label>
            <label className="text-text-secondary text-xs">
              <span className="mb-1 block">{localize('com_ui_workflow_schedule_timezone')}</span>
              <input
                className="border-border-medium bg-surface-primary w-full rounded-md border px-2 py-1 text-sm"
                value={draft.scheduleTimezone}
                maxLength={64}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, scheduleTimezone: event.target.value }))
                }
              />
            </label>
            {draft.scheduleFrequency === 'cron' ? (
              <label className="text-text-secondary text-xs sm:col-span-2">
                <span className="mb-1 block">{localize('com_ui_workflow_schedule_cron')}</span>
                <input
                  className="border-border-medium bg-surface-primary w-full rounded-md border px-2 py-1 font-mono text-sm"
                  value={draft.scheduleCron}
                  maxLength={256}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, scheduleCron: event.target.value }))
                  }
                />
              </label>
            ) : (
              <>
                {draft.scheduleFrequency !== 'hourly' && (
                  <label className="text-text-secondary text-xs">
                    <span className="mb-1 block">{localize('com_ui_workflow_schedule_hour')}</span>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      className="border-border-medium bg-surface-primary w-full rounded-md border px-2 py-1 text-sm"
                      value={draft.scheduleHour}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          scheduleHour: Math.min(23, Math.max(0, Number(event.target.value) || 0)),
                        }))
                      }
                    />
                  </label>
                )}
                <label className="text-text-secondary text-xs">
                  <span className="mb-1 block">{localize('com_ui_workflow_schedule_minute')}</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    className="border-border-medium bg-surface-primary w-full rounded-md border px-2 py-1 text-sm"
                    value={draft.scheduleMinute}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        scheduleMinute: Math.min(59, Math.max(0, Number(event.target.value) || 0)),
                      }))
                    }
                  />
                </label>
                {draft.scheduleFrequency === 'weekly' && (
                  <label className="text-text-secondary text-xs">
                    <span className="mb-1 block">{localize('com_ui_workflow_schedule_day')}</span>
                    <select
                      className="border-border-medium bg-surface-primary w-full rounded-md border px-2 py-1 text-sm"
                      value={draft.scheduleDay}
                      onChange={(event) => {
                        const scheduleDay = Number(event.target.value);
                        setDraft((current) => ({
                          ...current,
                          scheduleDay,
                          scheduleDaysOfWeek: [scheduleDay],
                        }));
                      }}
                    >
                      {WEEKDAYS.map((label, value) => (
                        <option key={label} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="border-border-light rounded-xl border p-3">
        <legend className="px-1 text-sm font-semibold">
          {localize('com_ui_workflow_event_triggers')}
        </legend>
        <p className="text-text-secondary text-xs">
          {localize('com_ui_workflow_event_triggers_hint')}
        </p>
        {draft.eventTriggers.length === 0 && (
          <p className="text-text-secondary mt-2 text-xs">
            {localize('com_ui_workflow_event_trigger_none')}
          </p>
        )}
        {draft.eventTriggers.map((trigger, index) => (
          <div
            key={`event-trigger-${index}`}
            className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <label className="text-text-secondary text-xs">
              <span className="mb-1 block">{localize('com_ui_workflow_event_trigger_type')}</span>
              <input
                className="border-border-medium bg-surface-primary w-full rounded-md border px-2 py-1 text-sm"
                maxLength={128}
                value={trigger.eventType}
                onChange={(event) => patchEventTrigger(index, { eventType: event.target.value })}
              />
            </label>
            <label className="text-text-secondary text-xs">
              <span className="mb-1 block">{localize('com_ui_workflow_event_trigger_source')}</span>
              <input
                className="border-border-medium bg-surface-primary w-full rounded-md border px-2 py-1 text-sm"
                maxLength={128}
                value={trigger.sourceId}
                onChange={(event) => patchEventTrigger(index, { sourceId: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="text-status-error hover:bg-surface-active self-end rounded p-1"
              aria-label={localize('com_ui_workflow_event_trigger_remove')}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  eventTriggers: current.eventTriggers.filter(
                    (_entry, position) => position !== index,
                  ),
                }))
              }
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
            <label className="text-text-secondary text-xs sm:col-span-3">
              <span className="mb-1 block">{localize('com_ui_workflow_event_trigger_input')}</span>
              <input
                className="border-border-medium bg-surface-primary w-full rounded-md border px-2 py-1 text-sm"
                maxLength={8000}
                value={trigger.input}
                onChange={(event) => patchEventTrigger(index, { input: event.target.value })}
              />
            </label>
          </div>
        ))}
        <button
          type="button"
          className="border-border-medium hover:bg-surface-active mt-2 rounded-md border px-2 py-1 text-xs"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              eventTriggers: [...current.eventTriggers, { eventType: '', sourceId: '', input: '' }],
            }))
          }
        >
          {localize('com_ui_workflow_event_trigger_add')}
        </button>
      </fieldset>

      <div>
        <label className="mb-1 block text-sm font-medium" htmlFor={`${nameId}-chain`}>
          {localize('com_ui_workflow_chain')}
        </label>
        <select
          id={`${nameId}-chain`}
          className="border-border-medium bg-surface-primary w-full rounded-lg border px-3 py-2 text-sm"
          value={draft.onCompleteWorkflowId}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              onCompleteWorkflowId: event.target.value,
            }))
          }
        >
          <option value="">{localize('com_ui_workflow_chain_none')}</option>
          {workflows
            .filter((candidate) => candidate.id !== workflow?.id)
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
        </select>
        <p className="text-text-secondary mt-1 text-xs">{localize('com_ui_workflow_chain_hint')}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="bg-surface-submit text-text-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          disabled={!canSave || pending}
        >
          {localize('com_ui_workflow_save')}
        </button>
        <button
          type="button"
          className="border-border-medium rounded-lg border px-4 py-2 text-sm"
          onClick={onCancel}
        >
          {localize('com_ui_workflow_cancel')}
        </button>
      </div>

      {failure != null && (
        <p role="alert" className="text-status-error text-sm">
          {failure}
        </p>
      )}
    </form>
  );
}

function RunEvents({ run }: { run: WorkflowRunView }) {
  const localize = useLocalize();
  if (run.events.length === 0) {
    return null;
  }
  return (
    <details className="mt-2 text-xs">
      <summary className="text-text-secondary cursor-pointer select-none">
        {localize('com_ui_workflow_events')} ({run.events.length})
      </summary>
      <ol className="border-border-light mt-2 space-y-1 border-l pl-3">
        {run.events.slice(-12).map((entry, index) => (
          <li key={`${entry.at}-${entry.type}-${index}`} className="text-text-secondary">
            <span className="text-text-primary font-mono">{entry.type}</span>
            {entry.stepId != null ? ` · ${entry.stepId}` : ''}
            {entry.message != null ? ` · ${entry.message}` : ''}
            <span className="block">{formatInstant(entry.at)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function RunCard({ workflowId, run }: { workflowId: string; run: WorkflowRunView }) {
  const localize = useLocalize();
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const approveMutation = useApproveWorkflowStepMutation(workflowId);
  const pauseMutation = usePauseWorkflowRunMutation(workflowId);
  const resumeMutation = useResumeWorkflowRunMutation(workflowId);
  const cancelMutation = useCancelWorkflowRunMutation(workflowId);
  const approvalIndex = run.steps.findIndex(
    (step) =>
      step.approvalRequired === true &&
      step.approvedAt == null &&
      (step.status === 'pending' || step.status === 'queued'),
  );
  const canPause = run.status === 'running' || run.status === 'queued';
  const canResume = run.status === 'paused';
  const terminal = TERMINAL_RUN_STATUSES.includes(run.status);

  const downloadRun = async () => {
    setDownloading(true);
    setDownloadFailed(false);
    try {
      const response = await dataService.getWorkflowRunExport(run.id);
      const url = URL.createObjectURL(response.data as Blob);
      triggerDownload(url, `workflow-run-${run.id}.json`);
      URL.revokeObjectURL(url);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <li className="border-border-light bg-surface-primary rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${RUN_TONE[run.status]}`}>
            {localize(RUN_STATUS_LABELS[run.status])}
          </span>
          {run.trigger != null && (
            <span className="border-border-light text-text-secondary rounded-full border px-2 py-0.5 text-xs">
              {localize(TRIGGER_LABELS[run.trigger.type])}
              {run.trigger.label != null ? ` · ${run.trigger.label}` : ''}
            </span>
          )}
          <span className="text-text-secondary text-xs">{formatInstant(run.createdAt) ?? ''}</span>
          {run.steps.length > 1 && (
            <span className="text-text-secondary text-xs">
              {run.steps.filter((step) => step.status === 'completed').length}/{run.steps.length}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run.conversationId != null && (
            <Link
              className="text-text-secondary hover:bg-surface-active rounded-md px-2 py-1 text-xs"
              to={`/c/${run.conversationId}`}
            >
              {localize('com_ui_workflow_open_conversation')}
            </Link>
          )}
          <button
            type="button"
            className="text-text-secondary hover:bg-surface-active flex items-center gap-1 rounded-md px-2 py-1 text-xs disabled:opacity-50"
            disabled={downloading}
            onClick={() => {
              void downloadRun();
            }}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {localize('com_ui_workflow_artifact')}
          </button>
          <button
            type="button"
            className="text-text-secondary hover:bg-surface-active rounded-md px-2 py-1 text-xs"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {localize('com_ui_workflow_steps')}
          </button>
        </div>
      </div>

      {run.error != null && (
        <p className="text-status-error mt-2 text-xs" role="status">
          {run.error}
        </p>
      )}
      {downloadFailed && (
        <p className="text-status-error mt-2 text-xs" role="alert">
          {localize('com_ui_error')}
        </p>
      )}
      {run.pauseRequestedAt != null && run.status === 'running' && (
        <p className="text-status-warning mt-2 text-xs" role="status">
          {localize('com_ui_workflow_pause_pending')}
        </p>
      )}

      {expanded && (
        <ol className="mt-3 space-y-2">
          {run.steps.map((step, index) => (
            <li key={step.id} className="flex items-start gap-2 text-xs">
              <Check
                className={`mt-0.5 h-3.5 w-3.5 ${
                  step.status === 'completed' ? 'text-text-primary' : 'text-text-secondary'
                }`}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium">
                  {index + 1}. {step.title}
                </span>{' '}
                <span className="text-text-secondary">
                  {localize(STEP_STATUS_LABELS[step.status])}
                  {step.attempts > 1 ? ` · ${step.attempts}` : ''}
                  {step.agentId != null ? ` · ${step.agentId}` : ''}
                </span>
                {step.reason != null && (
                  <span className="text-text-secondary block">{step.reason}</span>
                )}
                {step.error != null && (
                  <span className="text-status-error block">{step.error}</span>
                )}
                {step.result != null && (
                  <details className="mt-1">
                    <summary className="text-text-secondary cursor-pointer">
                      {localize('com_ui_workflow_result')}
                    </summary>
                    <pre className="border-border-light mt-1 max-h-48 overflow-auto border-l pl-2 font-mono text-xs whitespace-pre-wrap">
                      {step.result}
                    </pre>
                  </details>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      <RunEvents run={run} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {run.status === 'waiting_approval' && approvalIndex >= 0 && (
          <button
            type="button"
            className="bg-surface-submit rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={approveMutation.isLoading}
            onClick={() => approveMutation.mutate({ runId: run.id, stepIndex: approvalIndex })}
          >
            {localize('com_ui_workflow_approve')}
          </button>
        )}
        {canPause && (
          <button
            type="button"
            className="border-border-medium flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={pauseMutation.isLoading}
            onClick={() => pauseMutation.mutate(run.id)}
          >
            <Pause className="h-3.5 w-3.5" aria-hidden />
            {localize('com_ui_workflow_pause')}
          </button>
        )}
        {canResume && (
          <button
            type="button"
            className="border-border-medium flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={resumeMutation.isLoading}
            onClick={() => resumeMutation.mutate(run.id)}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {localize('com_ui_workflow_resume')}
          </button>
        )}
        {!terminal && (
          <button
            type="button"
            className="text-status-error hover:bg-surface-active rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={cancelMutation.isLoading}
            onClick={() => cancelMutation.mutate(run.id)}
          >
            {localize('com_ui_workflow_stop')}
          </button>
        )}
      </div>
      {(approveMutation.error != null ||
        pauseMutation.error != null ||
        resumeMutation.error != null ||
        cancelMutation.error != null) && (
        <p role="alert" className="text-status-error mt-2 text-xs">
          {responseError(
            approveMutation.error ??
              pauseMutation.error ??
              resumeMutation.error ??
              cancelMutation.error,
          ) ?? localize('com_ui_workflow_error')}
        </p>
      )}
    </li>
  );
}

function RunPanel({ workflow }: { workflow: WorkflowView }) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [input, setInput] = useState('');
  const runsQuery = useWorkflowRunsQuery(workflow.id);
  const startMutation = useStartWorkflowRunMutation(workflow.id);
  const runs = runsQuery.data?.runs ?? [];
  const failure = responseError(startMutation.error) ?? responseError(runsQuery.error);
  const activeRun = runs.find((run) => !TERMINAL_RUN_STATUSES.includes(run.status));

  const onRun = useCallback(
    (next: WorkflowRunView) => {
      queryClient.setQueryData<WorkflowRunListResponse>(
        [QueryKeys.workflowRuns, workflow.id],
        (current) =>
          current == null
            ? { runs: [next] }
            : { runs: current.runs.map((run) => (run.id === next.id ? next : run)) },
      );
    },
    [queryClient, workflow.id],
  );
  useWorkflowRunStream(workflow.id, activeRun, onRun);

  return (
    <section className="mt-6 space-y-3" aria-label={localize('com_ui_workflow_runs')}>
      <div className="border-border-light bg-surface-secondary rounded-xl border p-3">
        <label className="mb-1 block text-sm font-medium" htmlFor={inputId}>
          {localize('com_ui_workflow_run_input')}
        </label>
        <textarea
          id={inputId}
          className="border-border-medium bg-surface-primary mb-2 w-full rounded-lg border px-3 py-2 text-sm"
          rows={2}
          maxLength={8000}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          type="button"
          className="bg-surface-submit flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          disabled={startMutation.isLoading}
          onClick={() =>
            startMutation.mutate(input.trim().length > 0 ? { input: input.trim() } : {})
          }
        >
          <Play className="h-4 w-4" aria-hidden />
          {localize('com_ui_workflow_run')}
        </button>
        {failure != null && (
          <p role="alert" className="text-status-error mt-2 text-sm">
            {failure}
          </p>
        )}
      </div>

      {runsQuery.isLoading && (
        <p className="text-text-secondary text-sm">{localize('com_ui_workflow_loading')}</p>
      )}
      {!runsQuery.isLoading && runs.length === 0 && (
        <p className="text-text-secondary text-sm">{localize('com_ui_workflow_empty_runs')}</p>
      )}
      {!runsQuery.isLoading && runs.length > 0 && (
        <ul className="space-y-2">
          {runs.map((run) => (
            <RunCard key={run.id} workflowId={workflow.id} run={run} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function WorkflowsView() {
  const localize = useLocalize();
  const { data, isLoading, isError, refetch } = useWorkflowsQuery();
  const { data: agents } = useListAgentsQuery(
    { requiredPermission: PermissionBits.VIEW },
    { select: (response) => response.data },
  );
  const workflows = useMemo(() => data?.workflows ?? [], [data?.workflows]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<WorkflowView | 'new' | null>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const deleteMutation = useDeleteWorkflowMutation();
  const selected = workflows.find((workflow) => workflow.id === selectedId) ?? workflows[0];

  const openCreate = () => {
    setBuildOpen(false);
    setEditing('new');
  };
  const openBuild = () => {
    setEditing(null);
    setBuildOpen(true);
  };
  const finishEdit = (workflow: WorkflowView) => {
    setSelectedId(workflow.id);
    setEditing(null);
  };
  const finishBuild = (workflowId: string) => {
    setSelectedId(workflowId);
    setBuildOpen(false);
  };

  return (
    <main className="bg-surface-primary text-text-primary h-full min-h-0 w-full overflow-y-auto px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-text-secondary text-xs font-bold tracking-widest uppercase">
              {localize('com_ui_workflow_brand')}
            </p>
            <h1 className="mt-2 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
              <WorkflowIcon className="h-6 w-6" aria-hidden />
              {localize('com_ui_workflows')}
            </h1>
            <p className="text-text-secondary mt-1 max-w-2xl text-sm">
              {localize('com_ui_workflows_subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="bg-surface-submit flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold"
              onClick={openBuild}
            >
              <Rocket className="h-4 w-4" aria-hidden />
              {localize('com_ui_workflow_build_new')}
            </button>
            <button
              type="button"
              className="border-border-medium flex items-center gap-1 rounded-lg border px-4 py-2 text-sm font-semibold"
              onClick={openCreate}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {localize('com_ui_workflow_new')}
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <section aria-label={localize('com_ui_workflows')}>
            {isLoading && (
              <p className="text-text-secondary text-sm">{localize('com_ui_workflow_loading')}</p>
            )}
            {!isLoading && isError && (
              <div className="text-sm">
                <p className="text-status-error">{localize('com_ui_workflow_error')}</p>
                <button
                  type="button"
                  className="border-border-medium mt-2 rounded-md border px-3 py-1.5"
                  onClick={() => refetch()}
                >
                  {localize('com_ui_workflow_retry')}
                </button>
              </div>
            )}
            {!isLoading && !isError && workflows.length === 0 && (
              <p className="text-text-secondary text-sm">{localize('com_ui_workflow_empty')}</p>
            )}
            {!isLoading && !isError && workflows.length > 0 && (
              <ul className="space-y-2">
                {workflows.map((workflow) => (
                  <li key={workflow.id}>
                    <button
                      type="button"
                      aria-current={selected?.id === workflow.id ? 'true' : undefined}
                      className={`w-full rounded-xl border p-3 text-left ${
                        selected?.id === workflow.id
                          ? 'border-border-heavy bg-surface-active'
                          : 'border-border-light bg-surface-secondary hover:bg-surface-active'
                      }`}
                      onClick={() => {
                        setSelectedId(workflow.id);
                        setEditing(null);
                        setBuildOpen(false);
                      }}
                    >
                      <span className="block text-sm font-semibold">{workflow.name}</span>
                      <span className="text-text-secondary mt-1 block text-xs">
                        {workflow.description || localize('com_ui_workflow_no_description')}
                      </span>
                      <span className="text-text-secondary mt-1 block text-xs">
                        {workflow.steps.length} · {localize('com_ui_workflow_steps')}
                        {workflow.schedule?.enabled === true && (
                          <>
                            {' '}
                            · {localize('com_ui_workflow_scheduled')}
                            {workflow.schedule.nextRunAt != null
                              ? ` ${formatInstant(workflow.schedule.nextRunAt) ?? ''}`
                              : ''}
                          </>
                        )}
                        {workflow.eventTriggers != null && workflow.eventTriggers.length > 0 && (
                          <>
                            {' '}
                            ·{' '}
                            {workflow.eventTriggers.map((trigger) => trigger.eventType).join(', ')}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            {editing !== null && (
              <WorkflowEditor
                key={editing === 'new' ? 'new' : editing.id}
                workflow={editing === 'new' ? undefined : editing}
                workflows={workflows}
                agents={agents ?? []}
                onDone={finishEdit}
                onCancel={() => setEditing(null)}
              />
            )}
            {buildOpen && (
              <BuildLauncher
                agents={agents ?? []}
                onStarted={finishBuild}
                onCancel={() => setBuildOpen(false)}
              />
            )}
            {!buildOpen && editing === null && selected == null && (
              <p className="text-text-secondary text-sm">{localize('com_ui_workflow_select')}</p>
            )}
            {!buildOpen && editing === null && selected != null && (
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{selected.name}</h2>
                    <p className="text-text-secondary mt-1 text-sm">
                      {selected.description || localize('com_ui_workflow_no_description')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="border-border-medium rounded-md border px-3 py-1.5 text-sm"
                      onClick={() => setEditing(selected)}
                    >
                      {localize('com_ui_workflow_edit')}
                    </button>
                    <button
                      type="button"
                      className="text-status-error hover:bg-surface-active rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
                      disabled={deleteMutation.isLoading}
                      onClick={() => {
                        if (!window.confirm(localize('com_ui_workflow_delete_confirm'))) {
                          return;
                        }
                        deleteMutation.mutate(selected.id, {
                          onSuccess: () => {
                            setSelectedId(undefined);
                            setEditing(null);
                          },
                        });
                      }}
                    >
                      <Trash2 className="mr-1 inline h-4 w-4" aria-hidden />
                      {localize('com_ui_workflow_delete')}
                    </button>
                  </div>
                </div>

                {selected.schedule?.enabled === true && (
                  <p className="text-text-secondary mt-2 text-xs">
                    {localize('com_ui_workflow_schedule_next')}:{' '}
                    {formatInstant(selected.schedule.nextRunAt) ??
                      localize('com_ui_workflow_schedule_pending')}
                  </p>
                )}
                {selected.eventTriggers != null && selected.eventTriggers.length > 0 && (
                  <p className="text-text-secondary mt-1 text-xs">
                    {localize('com_ui_workflow_event_triggers')}:{' '}
                    {selected.eventTriggers.map((trigger) => trigger.eventType).join(', ')}
                  </p>
                )}

                <ol className="mt-4 space-y-2 text-xs">
                  {selected.steps.map((step, index) => {
                    const dependencies = step.dependsOn ?? [];
                    return (
                      <li
                        key={step.id}
                        className="border-border-light bg-surface-secondary rounded-lg border px-3 py-2"
                      >
                        <span className="font-semibold">
                          {index + 1}. {step.title}
                        </span>
                        {step.agentId != null && (
                          <span className="text-text-secondary"> · {step.agentId}</span>
                        )}
                        {dependencies.length > 0 && (
                          <span className="text-text-secondary">
                            {' '}
                            · {localize('com_ui_workflow_depends_short')}{' '}
                            {dependencies
                              .map(
                                (id) =>
                                  selected.steps.find((entry) => entry.id === id)?.title ?? id,
                              )
                              .join(', ')}
                          </span>
                        )}
                        {step.approvalRequired === true && (
                          <span className="text-status-warning">
                            {' '}
                            · {localize('com_ui_workflow_approval_short')}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>

                <RunPanel workflow={selected} />
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
