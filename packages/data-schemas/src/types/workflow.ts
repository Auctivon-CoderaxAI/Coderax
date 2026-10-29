import type {
  TScheduleCadence,
  WorkflowRunEventType,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  WorkflowSettings,
  WorkflowStepCondition,
  WorkflowStepInput,
  WorkflowStepStatus,
} from 'coderax-data-provider';
import type { Document, Types } from 'mongoose';

export interface IWorkflowSchedule {
  enabled: boolean;
  cadence: TScheduleCadence;
  timezone: string;
  input?: string;
  nextRunAt?: Date;
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
  runIf?: WorkflowStepCondition;
  timeoutMs?: number;
  status: WorkflowStepStatus;
  attempts: number;
  deliveryKey?: string;
  approvedAt?: Date;
  startedAt?: Date;
  settledAt?: Date;
  /** Earliest retry time after a failed attempt. */
  availableAt?: Date;
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
  events: IWorkflowRunEvent[];
  onCompleteWorkflowId?: string;
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
