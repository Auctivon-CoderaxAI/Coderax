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
export const WORKFLOW_RESULT_MAX_LENGTH = 16_000;
/** Total branch context injected into one merge step. */
export const WORKFLOW_HANDOFF_MAX_LENGTH = 32_000;
/** Event sources one workflow may subscribe to. */
export const WORKFLOW_EVENT_TRIGGERS_MAX = 5;
export const WORKFLOW_EVENT_TYPE_MAX_LENGTH = 128;
export const WORKFLOW_EVENT_SOURCE_MAX_LENGTH = 128;
/** Conditions one step may require; all must hold. */
export const WORKFLOW_CONDITIONS_MAX = 4;
export const WORKFLOW_CONDITION_MATCH_MAX_LENGTH = 200;

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
  /**
   * Runs only when every condition holds. A condition can test a predecessor's
   * status and an excerpt of its result, so a branch can depend on what an
   * earlier step actually produced rather than only on how it exited.
   */
  runIf?: WorkflowStepCondition | WorkflowStepCondition[];
  /**
   * How dependencies gate this step. `all` (default) waits for every dependency
   * to complete; `any` starts as soon as one completes, so a merge step can run
   * after either branch finished.
   */
  join?: WorkflowStepJoin;
  /** Per-step override for the stuck-turn timeout. */
  timeoutMs?: number;
}

export type WorkflowStepJoin = 'all' | 'any';

export type WorkflowStepConditionStatus = 'completed' | 'failed' | 'skipped';

export interface WorkflowStepCondition {
  stepId: string;
  /** Defaults to `completed`. */
  status?: WorkflowStepConditionStatus;
  /** Case-insensitive substring the named step's retained result must contain. */
  resultIncludes?: string;
}

/** Bounds for the repository and checkout a build run is bound to. */
export const WORKFLOW_BUILD_REPOSITORY_PART_MAX_LENGTH = 100;
export const WORKFLOW_BUILD_BASE_REF_MAX_LENGTH = 100;
export const WORKFLOW_BUILD_WORKSPACE_MAX_LENGTH = 128;

/** Execution modes an autonomous build run can be compiled under. */
export const WORKFLOW_BUILD_MODES = ['turbo15', 'autonomous', 'verified'] as const;

/** Evidence a build must produce before its run may settle as complete. */
export const WORKFLOW_BUILD_GATES = ['tests', 'build', 'review', 'security'] as const;

/** The repository a build edits and the base its pull request targets. */
export interface WorkflowBuildRepository {
  owner: string;
  name: string;
  baseRef?: string;
}

/**
 * Present only on runs compiled from a build plan. Settlement reads it to decide
 * whether the run needs independent evidence before `completed`, so a build can
 * never settle complete merely because its steps finished.
 */
export interface WorkflowBuildSettings {
  mode: WorkflowBuildMode;
  requiredGates: WorkflowBuildGate[];
  /** Settlement refuses a run whose delivery cannot be attributed to a repository. */
  repository?: WorkflowBuildRepository;
  /** Checkout directory under the deployment build root, unique per run. */
  workspace?: string;
  /** ISO deadline the mode targeted; a missed target is reported, never hidden. */
  deadlineAt?: string;
  /** The step whose retained output is the independent review evidence. */
  reviewStepId?: string;
  /** Delivery requires a reviewable pull request unless explicitly waived. */
  requirePullRequest?: boolean;
}

export interface WorkflowSettings {
  /** Maximum steps of this workflow in flight at once. */
  maxParallel?: number;
  /** Default timeout for a step whose generation never settles. */
  stepTimeoutMs?: number;
  /** Present only on an autonomous build run. */
  build?: WorkflowBuildSettings;
}

export const WORKFLOW_VERIFICATION_STATUSES = ['verified', 'failed'] as const;

export type WorkflowVerificationStatus = (typeof WORKFLOW_VERIFICATION_STATUSES)[number];

/** One gate's evidence, retained on the run after settlement. */
export interface WorkflowVerificationGate {
  gate: WorkflowBuildGate;
  status: 'passed' | 'failed' | 'not_run';
  summary?: string;
}

/**
 * The retained verification verdict. Absence means the run was never checked;
 * `failed` is the only safe verdict for a build that is out of time, drifted
 * from its plan, or lost its evidence.
 */
export interface WorkflowRunVerification {
  status: WorkflowVerificationStatus;
  mode: WorkflowBuildMode;
  /** The build report's outcome, for example `verified_complete` or `partial`. */
  outcome: string;
  checkedAt: string;
  summary: string;
  gates: WorkflowVerificationGate[];
  blockers: string[];
  pullRequestUrl?: string;
}

export interface WorkflowScheduleInput {
  enabled: boolean;
  cadence: TScheduleCadence;
  timezone: string;
  /** Run input supplied to every automatic occurrence. */
  input?: string;
}

/** One authenticated agent-event source that starts this workflow automatically. */
export interface WorkflowEventTrigger {
  eventType: string;
  /** Restrict to one source (a webhook, schedule, or other configured source). */
  sourceId?: string;
  /** Extra context prepended to every run started by this trigger. */
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
  seq?: number;
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
  /** Authenticated agent events that start this workflow automatically. */
  eventTriggers?: WorkflowEventTrigger[];
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
  /** Present on an autonomous build run once settlement has verified it. */
  verification?: WorkflowRunVerification;
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
  eventTriggers?: WorkflowEventTrigger[];
  onCompleteWorkflowId?: string | null;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string | null;
  agentId?: string;
  steps?: WorkflowStepInput[];
  settings?: WorkflowSettings | null;
  schedule?: WorkflowScheduleInput | null;
  eventTriggers?: WorkflowEventTrigger[] | null;
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

export type WorkflowBuildMode = (typeof WORKFLOW_BUILD_MODES)[number];
export type WorkflowBuildGate = (typeof WORKFLOW_BUILD_GATES)[number];

/** Launch input: a request, saved agents and the checkout the build edits. */
export interface StartWorkflowBuildRequest {
  request: string;
  mode: WorkflowBuildMode;
  agentId: string;
  roleAgents?: Partial<Record<string, string>>;
  repository: WorkflowBuildRepository;
  /** Directory name under the deployment build root, unique per running build. */
  workspace: string;
}

export interface WorkflowBuildSummary {
  planner: 'deterministic' | 'free_model' | 'local_model';
  requestedMode: WorkflowBuildMode;
  mode: WorkflowBuildMode;
  degraded: boolean;
  reason?: string;
  taskCount: number;
  requiredGates: WorkflowBuildGate[];
  unresolvedRoles: string[];
}

export interface StartWorkflowBuildResponse {
  workflow: WorkflowView;
  run: WorkflowRunView;
  build: WorkflowBuildSummary;
}

export function resolveWorkflowDependencies(steps: WorkflowStepInput[]): string[][] {
  return steps.map((step, index) => {
    if (step.dependsOn != null) {
      return step.dependsOn;
    }
    return index === 0 ? [] : [steps[index - 1].id];
  });
}
