import type {
  TScheduleCadence,
  WorkflowEventTrigger,
  WorkflowRunEventType,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  WorkflowRunVerification,
  WorkflowSettings,
  WorkflowStepCondition,
  WorkflowStepInput,
  WorkflowStepJoin,
  WorkflowStepStatus,
} from 'coderax-data-provider';
import type { Document, Types } from 'mongoose';

export interface IWorkflowSchedule {
  enabled: boolean;
  cadence: TScheduleCadence;
  timezone: string;
  input?: string;
  nextRunAt?: Date;
  /** Backoff gate only; never replaces the occurrence identity in nextRunAt. */
  retryAt?: Date;
  leaseUntil?: Date;
  leaseBy?: string;
  claimToken?: string;
}

export interface IWorkflow {
  _id?: Types.ObjectId;
  id: string;
  user: Types.ObjectId;
  tenantId?: string;
  name: string;
  description?: string;
  agentId: string;
  steps: WorkflowStepInput[];
  settings?: WorkflowSettings;
  schedule?: IWorkflowSchedule;
  /** Authenticated agent events that start this workflow automatically. */
  eventTriggers?: WorkflowEventTrigger[];
  /** Workflow started automatically when this one completes successfully. */
  onCompleteWorkflowId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IWorkflowDocument extends Omit<IWorkflow, 'id' | '_id'>, Document {
  id: string;
}

/** The immutable per-run snapshot of a step, plus its live execution state. */
export interface IWorkflowStepRun extends Required<Pick<WorkflowStepInput, 'id' | 'title'>> {
  instruction: string;
  approvalRequired: boolean;
  maxAttempts: number;
  agentId?: string;
  dependsOn: string[];
  runIf?: WorkflowStepCondition | WorkflowStepCondition[];
  join?: WorkflowStepJoin;
  timeoutMs?: number;
  status: WorkflowStepStatus;
  attempts: number;
  deliveryKey?: string;
  /** Durable conversation identity for generation lookup, continuation and cancellation. */
  conversationId?: string;
  approvedAt?: Date;
  startedAt?: Date;
  settledAt?: Date;
  /** Earliest retry time after a failed attempt. */
  availableAt?: Date;
  /** Attempt-fenced terminal generation evidence, retained after job cleanup. */
  terminalStatus?: 'complete' | 'error';
  terminalAttempt?: number;
  terminalAt?: Date;
  error?: string;
  /** Why a conditional branch was not taken. */
  reason?: string;
  /** Retained excerpt of this step's output, exported as an artifact. */
  result?: string;
}

export interface IWorkflowRunEvent {
  at: Date;
  type: WorkflowRunEventType;
  stepId?: string;
  message?: string;
}

export interface IWorkflowRun {
  _id?: Types.ObjectId;
  id: string;
  workflowId: string;
  user: Types.ObjectId;
  tenantId?: string;
  workflowName: string;
  agentId: string;
  status: WorkflowRunStatus;
  currentStep: number;
  steps: IWorkflowStepRun[];
  settings?: WorkflowSettings;
  conversationId?: string;
  input?: string;
  trigger?: WorkflowRunTrigger;
  /** Retained build settlement verdict; absent when the run was never checked. */
  verification?: WorkflowRunVerification;
  events: IWorkflowRunEvent[];
  /** Workflow ids already traversed by this automatic chain. */
  workflowAncestry?: string[];
  onCompleteWorkflowId?: string;
  /** Set while a completed run still needs its downstream chain delivered. */
  chainPending?: boolean;
  /** Deterministic identity of an automatic occurrence, so two replicas cannot double-start it. */
  dedupeKey?: string;
  error?: string;
  leaseBy?: string;
  leaseUntil?: Date;
  leaseToken?: string;
  pauseRequestedAt?: Date;
  startedAt?: Date;
  settledAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IWorkflowRunDocument extends Omit<IWorkflowRun, '_id' | 'id'>, Document {
  id: string;
}
