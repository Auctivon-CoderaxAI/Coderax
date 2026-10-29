import type {
  TScheduleCadence,
  WorkflowRunEvent,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  WorkflowSettings,
  WorkflowStepCondition,
  WorkflowStepStatus,
} from 'coderax-data-provider';

/** The durable, process-independent shape a workflow runner advances. */
export interface WorkflowStepRecord {
  id: string;
  title: string;
  instruction: string;
  approvalRequired: boolean;
  maxAttempts: number;
  status: WorkflowStepStatus;
  attempts: number;
  agentId?: string;
  dependsOn?: string[];
  runIf?: WorkflowStepCondition;
  timeoutMs?: number;
  /** Conversation this step's turn belongs to; parallel branches fork their own. */
  conversationId?: string;
  deliveryKey?: string;
  approvedAt?: Date;
  startedAt?: Date;
  settledAt?: Date;
  availableAt?: Date;
  error?: string;
  reason?: string;
  result?: string;
}

export interface WorkflowRunRecord {
  id: string;
  userId: string;
  tenantId?: string;
  workflowId: string;
  workflowName: string;
  agentId: string;
  status: WorkflowRunStatus;
  currentStep: number;
  steps: WorkflowStepRecord[];
  settings?: WorkflowSettings;
  conversationId?: string;
  input?: string;
  trigger?: WorkflowRunTrigger;
  events: WorkflowRunEvent[];
  onCompleteWorkflowId?: string;
  error?: string;
  pauseRequestedAt?: Date;
  startedAt?: Date;
  settledAt?: Date;
}

export interface WorkflowRunPatch {
  status?: WorkflowRunStatus;
  currentStep?: number;
  steps?: WorkflowStepRecord[];
  events?: WorkflowRunEvent[];
  error?: string | null;
  pauseRequestedAt?: Date | null;
  startedAt?: Date;
  settledAt?: Date | null;
}

/** A generation's terminal state, read from the job manager. */
export interface WorkflowGenerationState {
  status?: string;
  createdAt?: number;
  /** Present when the host projects the fire envelope's metadata onto the job. */
  metadata?: {
    workflowRunId?: unknown;
    workflowStepId?: unknown;
  };
}

export interface WorkflowEngineStore {
  claimRuns: (input: {
    workerId: string;
    leaseToken: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }) => Promise<WorkflowRunRecord[]>;
  /** Lease-fenced write. False means another worker owns the run now. */
  saveRun: (input: {
    runId: string;
    leaseToken: string;
    now: Date;
    patch: WorkflowRunPatch;
  }) => Promise<boolean>;
  releaseRun: (input: { runId: string; leaseToken: string; now: Date }) => Promise<void>;
}

/** One due workflow schedule, leased for the duration of one dispatch attempt. */
export interface WorkflowScheduleClaim {
  workflowId: string;
  claimToken: string;
  scheduledFor: Date;
  cadence: TScheduleCadence;
  timezone: string;
}

export interface WorkflowScheduleDeps {
  claimDue: (input: {
    workerId: string;
    now: Date;
    leaseUntil: Date;
    limit: number;
  }) => Promise<WorkflowScheduleClaim[]>;
  /** Creates the occurrence's run (idempotently) and advances the schedule. */
  complete: (input: {
    workflowId: string;
    claimToken: string;
    scheduledFor: Date;
    nextRunAt: Date | null;
    now: Date;
  }) => Promise<unknown>;
  /** Returns the schedule to the queue after a failed dispatch attempt. */
  release: (input: { workflowId: string; claimToken: string; nextRunAt: Date }) => Promise<void>;
  computeNextRunAt: (input: {
    workflowId: string;
    cadence: TScheduleCadence;
    timezone: string;
    after: Date;
  }) => Date | null;
}

export interface WorkflowEngineDeps {
  store: WorkflowEngineStore;
  /** Dispatches one agent turn and returns the durable delivery identity. */
  enqueueStep: (input: {
    run: WorkflowRunRecord;
    step: WorkflowStepRecord;
    stepIndex: number;
  }) => Promise<string>;
  getGeneration: (conversationId: string) => Promise<WorkflowGenerationState | null>;
  /** Stops a runaway or cancelled turn before another one is dispatched. */
  abortGeneration?: (
    conversationId: string,
    options?: { expectedCreatedAt?: number },
  ) => Promise<void>;
  /** Reads the text a settled step produced, for artifacts and branch handoff. */
  readStepResult?: (input: {
    run: WorkflowRunRecord;
    step: WorkflowStepRecord;
    conversationId: string;
  }) => Promise<string | null>;
  /** Notifies the host after a run reaches a terminal status. */
  onRunSettled?: (run: WorkflowRunRecord) => Promise<void>;
  schedules?: WorkflowScheduleDeps;
  now?: () => Date;
  random?: () => number;
  newId?: () => string;
  workerId?: string;
  concurrency?: number;
  leaseMs?: number;
  tickMs?: number;
  retryBaseMs?: number;
  retryCapMs?: number;
  /** A step with no terminal generation after this long is retried or failed. */
  stepTimeoutMs?: number;
  scheduleConcurrency?: number;
}

export interface WorkflowEngine {
  start: () => void;
  stop: () => Promise<void>;
  wake: () => void;
  runTick: () => Promise<number>;
}
