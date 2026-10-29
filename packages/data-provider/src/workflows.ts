import type { TScheduleCadence } from './types/schedules';

/** Bounds are shared by the editor, the API validator and the database schema. */
export const WORKFLOW_NAME_MAX_LENGTH = 120;
export const WORKFLOW_DESCRIPTION_MAX_LENGTH = 2_000;
export const WORKFLOW_INSTRUCTION_MAX_LENGTH = 8_000;
export const WORKFLOW_STEP_TITLE_MAX_LENGTH = 120;
export const WORKFLOW_STEP_ID_MAX_LENGTH = 64;
export const WORKFLOW_STEPS_MAX = 25;
export const WORKFLOW_RUN_INPUT_MAX_LENGTH = 8_000;
export const WORKFLOW_RUNS_PAGE_MAX = 50;
export const WORKFLOW_STEP_MAX_ATTEMPTS = 5;
/** Independent steps a single run may have in flight at once. */
export const WORKFLOW_MAX_PARALLEL = 8;
export const WORKFLOW_STEP_TIMEOUT_MS_DEFAULT = 30 * 60_000;
export const WORKFLOW_STEP_TIMEOUT_MS_MIN = 10_000;
export const WORKFLOW_STEP_TIMEOUT_MS_MAX = 24 * 60 * 60_000;
/** Structured execution log retained on a run; older entries are dropped. */
export const WORKFLOW_EVENTS_MAX = 200;
/** Per-step result text retained as an artifact excerpt. */
export const WORKFLOW_RESULT_MAX_LENGTH = 4_000;

/**
 * A step is one agent turn. `dependsOn` names the steps that must settle before
 * it may start, which is what turns the list into a DAG: steps with no edge
 * between them run in parallel. A step with no `dependsOn` follows the previous
 * step, preserving the original linear behavior.
 */
export interface WorkflowStepInput {
  id: string;
  title: string;
  instruction: string;
  approvalRequired?: boolean;
  maxAttempts?: number;
  /** Delegates this step to another agent; defaults to the workflow's agent. */
  agentId?: string;
  dependsOn?: string[];
  /** Runs only when the named step settled with the given status. */
  runIf?: WorkflowStepCondition;
  /** Per-step override for the stuck-turn timeout. */
  timeoutMs?: number;
}

export type WorkflowStepConditionStatus = 'completed' | 'failed';

export interface WorkflowStepCondition {
  stepId: string;
  status: WorkflowStepConditionStatus;
}

export interface WorkflowSettings {
  /** Maximum steps of this workflow in flight at once. */
  maxParallel?: number;
  /** Default timeout for a step whose generation never settles. */
  stepTimeoutMs?: number;
}

export interface WorkflowScheduleInput {
  enabled: boolean;
  cadence: TScheduleCadence;
  timezone: string;
  /** Run input supplied to every automatic occurrence. */
  input?: string;
}

export interface WorkflowScheduleView extends WorkflowScheduleInput {
  nextRunAt?: string;
}

export const WORKFLOW_STEP_STATUSES = [
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'skipped',
  'cancelled',
] as const;

export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

export const WORKFLOW_RUN_STATUSES = [
  'queued',
  'running',
  'paused',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const;

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

/** Why a run exists: a person, a schedule, or a completed predecessor run. */
export interface WorkflowRunTrigger {
  type: 'manual' | 'schedule' | 'event';
  /** The workflow or schedule that caused the run, when not manual. */
  sourceId?: string;
  label?: string;
}

export const WORKFLOW_RUN_EVENT_TYPES = [
  'run.queued',
  'run.started',
  'run.paused',
  'run.resumed',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'step.queued',
  'step.dispatched',
  'step.retried',
  'step.completed',
  'step.failed',
  'step.cancelled',
  'step.skipped',
  'step.approval_required',
  'step.approved',
  'trigger.fired',
] as const;

export type WorkflowRunEventType = (typeof WORKFLOW_RUN_EVENT_TYPES)[number];

/** A structured, ordered execution log entry. */
export interface WorkflowRunEvent {
  at: string;
  type: WorkflowRunEventType;
  stepId?: string;
  message?: string;
}

/** A step as the client renders it: the definition plus its live execution state. */
export interface WorkflowStepView extends WorkflowStepInput {
  status: WorkflowStepStatus;
  attempts: number;
  approvedAt?: string;
  startedAt?: string;
  settledAt?: string;
  error?: string;
  /** Why a branch was not taken. */
  reason?: string;
  /** Excerpt of what this step produced. */
  result?: string;
}

/** One exported artifact: the retained text a step produced. */
export interface WorkflowArtifact {
  stepId: string;
  title: string;
  status: WorkflowStepStatus;
  startedAt?: string;
  settledAt?: string;
  result?: string;
  error?: string;
}

export interface WorkflowView {
  id: string;
  name: string;
  description?: string;
  agentId: string;
  steps: WorkflowStepInput[];
  settings?: WorkflowSettings;
  schedule?: WorkflowScheduleView;
  /** Workflow started automatically when this one completes successfully. */
  onCompleteWorkflowId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunView {
  id: string;
  workflowId: string;
  workflowName: string;
  agentId: string;
  status: WorkflowRunStatus;
  conversationId?: string;
  input?: string;
  steps: WorkflowStepView[];
  error?: string;
  trigger?: WorkflowRunTrigger;
  events: WorkflowRunEvent[];
  pauseRequestedAt?: string;
  createdAt: string;
  startedAt?: string;
  settledAt?: string;
}

export interface WorkflowListResponse {
  workflows: WorkflowView[];
}

export interface WorkflowRunListResponse {
  runs: WorkflowRunView[];
}

export interface WorkflowRunResponse {
  run: WorkflowRunView;
}

export interface WorkflowTemplatesResponse {
  templates: WorkflowTemplate[];
}

export interface WorkflowArtifactResponse {
  run: WorkflowRunView;
  artifacts: WorkflowArtifact[];
}

export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  agentId: string;
  steps: WorkflowStepInput[];
  settings?: WorkflowSettings;
  schedule?: WorkflowScheduleInput | null;
  onCompleteWorkflowId?: string | null;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string | null;
  agentId?: string;
  steps?: WorkflowStepInput[];
  settings?: WorkflowSettings | null;
  schedule?: WorkflowScheduleInput | null;
  onCompleteWorkflowId?: string | null;
}

export interface StartWorkflowRunRequest {
  input?: string;
}

export interface StartWorkflowRunResponse {
  run: WorkflowRunView;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStepInput[];
  settings?: WorkflowSettings;
}

/**
 * Reusable starting points. They are ordinary definitions, so editing one
 * creates a workflow the user owns rather than a hidden special case.
 */
export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'code-review-gate',
    name: 'Code review gate',
    description:
      'Implement a change, review it independently, then require approval before shipping.',
    steps: [
      {
        id: 'implement',
        title: 'Implement the change',
        instruction:
          'Inspect the repository and implement the requested change. Run the focused tests that cover it and report exactly what you changed.',
      },
      {
        id: 'review',
        title: 'Review the change',
        instruction:
          'Review the previous step independently as a senior reviewer. List concrete defects with file and line references, or state that none were found.',
        dependsOn: ['implement'],
        approvalRequired: true,
      },
      {
        id: 'fix',
        title: 'Address review findings',
        instruction:
          'Fix every valid finding from the review. Re-run the affected checks and summarize the residual risks.',
        dependsOn: ['review'],
        runIf: { stepId: 'review', status: 'completed' },
      },
    ],
  },
  {
    id: 'release-notes',
    name: 'Release notes',
    description:
      'Collect merged work, draft release notes, and prepare an announcement in parallel.',
    steps: [
      {
        id: 'collect',
        title: 'Collect merged changes',
        instruction:
          'Summarize the merged pull requests since the last release, grouped by area. Cite PR numbers.',
      },
      {
        id: 'notes',
        title: 'Draft release notes',
        instruction:
          'Write user-facing release notes from the collected changes. Keep them specific and free of internal jargon.',
        dependsOn: ['collect'],
        approvalRequired: true,
      },
      {
        id: 'announcement',
        title: 'Draft the announcement',
        instruction:
          'Write a short announcement suitable for the team channel, based on the collected changes.',
        dependsOn: ['collect'],
      },
    ],
  },
  {
    id: 'bug-triage',
    name: 'Bug triage',
    description: 'Reproduce a report, isolate the cause, propose a fix, then verify it.',
    steps: [
      {
        id: 'reproduce',
        title: 'Reproduce the report',
        instruction:
          'Reproduce the reported behavior. Record the exact commands, expected output and actual output.',
      },
      {
        id: 'diagnose',
        title: 'Isolate the cause',
        instruction:
          'Find the root cause of the reproduced behavior. Name the file and function responsible and explain the failure path.',
        dependsOn: ['reproduce'],
      },
      {
        id: 'fix',
        title: 'Propose and apply a fix',
        instruction:
          'Implement the smallest fix for the diagnosed cause and run the focused tests.',
        dependsOn: ['diagnose'],
      },
      {
        id: 'verify',
        title: 'Verify the fix',
        instruction:
          'Verify the fix against the original reproduction and report the result. Flag any remaining risk.',
        dependsOn: ['fix'],
        approvalRequired: true,
      },
    ],
  },
];

/** The terminal set: a run in one of these states never advances again. */
export const TERMINAL_WORKFLOW_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  'completed',
  'failed',
  'cancelled',
];

export function isTerminalWorkflowRunStatus(status: WorkflowRunStatus): boolean {
  return TERMINAL_WORKFLOW_RUN_STATUSES.includes(status);
}

/** Resolves the effective dependencies of a step list. */
export function resolveWorkflowDependencies(steps: WorkflowStepInput[]): string[][] {
  return steps.map((step, index) => {
    if (step.dependsOn != null) {
      return step.dependsOn;
    }
    return index === 0 ? [] : [steps[index - 1].id];
  });
}
