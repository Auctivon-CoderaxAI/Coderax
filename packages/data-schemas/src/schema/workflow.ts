import { Schema } from 'mongoose';
import {
  WORKFLOW_DESCRIPTION_MAX_LENGTH,
  WORKFLOW_BUILD_MODES,
  WORKFLOW_BUILD_GATES,
  WORKFLOW_INSTRUCTION_MAX_LENGTH,
  WORKFLOW_MAX_PARALLEL,
  WORKFLOW_NAME_MAX_LENGTH,
  WORKFLOW_RESULT_MAX_LENGTH,
  WORKFLOW_RUN_EVENT_TYPES,
  WORKFLOW_RUN_INPUT_MAX_LENGTH,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_ID_MAX_LENGTH,
  WORKFLOW_STEP_MAX_ATTEMPTS,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_STEP_TIMEOUT_MS_MAX,
  WORKFLOW_STEP_TIMEOUT_MS_MIN,
  WORKFLOW_STEP_TITLE_MAX_LENGTH,
} from 'coderax-data-provider';
import type { IWorkflowDocument, IWorkflowRunDocument } from '~/types/workflow';

const workflowStepSchema = new Schema(
  {
    id: { type: String, required: true, maxlength: WORKFLOW_STEP_ID_MAX_LENGTH },
    title: { type: String, required: true, maxlength: WORKFLOW_STEP_TITLE_MAX_LENGTH },
    instruction: { type: String, required: true, maxlength: WORKFLOW_INSTRUCTION_MAX_LENGTH },
    approvalRequired: { type: Boolean, default: false },
    maxAttempts: { type: Number, min: 1, max: WORKFLOW_STEP_MAX_ATTEMPTS, default: 3 },
    agentId: { type: String },
    dependsOn: { type: [String], default: [] },
    // A condition may be one object or an array, so persistence accepts both.
    runIf: { type: Schema.Types.Mixed },
    join: { type: String, enum: ['all', 'any'] },
    timeoutMs: {
      type: Number,
      min: WORKFLOW_STEP_TIMEOUT_MS_MIN,
      max: WORKFLOW_STEP_TIMEOUT_MS_MAX,
    },
  },
  { _id: false },
);

const workflowEventTriggerSchema = new Schema(
  {
    eventType: { type: String, required: true, maxlength: 128 },
    sourceId: { type: String, maxlength: 128 },
    input: { type: String, maxlength: WORKFLOW_RUN_INPUT_MAX_LENGTH },
  },
  { _id: false },
);

const workflowSettingsSchema = new Schema(
  {
    maxParallel: { type: Number, min: 1, max: WORKFLOW_MAX_PARALLEL },
    stepTimeoutMs: {
      type: Number,
      min: WORKFLOW_STEP_TIMEOUT_MS_MIN,
      max: WORKFLOW_STEP_TIMEOUT_MS_MAX,
    },
  },
  { _id: false },
);

const workflowScheduleSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    cadence: { type: Schema.Types.Mixed, required: true },
    timezone: { type: String, required: true },
    input: { type: String, maxlength: WORKFLOW_RUN_INPUT_MAX_LENGTH },
    nextRunAt: { type: Date },
    retryAt: { type: Date },
    leaseUntil: { type: Date },
    leaseBy: { type: String },
    claimToken: { type: String },
  },
  { _id: false },
);

const workflowSchema: Schema<IWorkflowDocument> = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: String, index: true },
    launchFingerprint: { type: String },
    name: { type: String, required: true, maxlength: WORKFLOW_NAME_MAX_LENGTH },
    description: { type: String, maxlength: WORKFLOW_DESCRIPTION_MAX_LENGTH },
    agentId: { type: String, required: true },
    steps: {
      type: [workflowStepSchema],
      default: undefined,
      validate: [
        (value: unknown[]) => Array.isArray(value) && value.length > 0,
        'A workflow needs at least one step',
      ],
    },
    settings: { type: workflowSettingsSchema },
    schedule: { type: workflowScheduleSchema },
    eventTriggers: { type: [workflowEventTriggerSchema], default: undefined },
    onCompleteWorkflowId: { type: String },
  },
  { timestamps: true },
);

workflowSchema.index({ user: 1, createdAt: -1 });
/** The scheduler's claim query: enabled schedules whose next run is due. */
workflowSchema.index({ 'schedule.enabled': 1, 'schedule.nextRunAt': 1 });
/** Event ingress looks up subscriptions by owner and event type. */
workflowSchema.index({ user: 1, 'eventTriggers.eventType': 1 });

const workflowStepRunSchema = new Schema(
  {
    id: { type: String, required: true, maxlength: WORKFLOW_STEP_ID_MAX_LENGTH },
    title: { type: String, required: true, maxlength: WORKFLOW_STEP_TITLE_MAX_LENGTH },
    instruction: { type: String, required: true, maxlength: WORKFLOW_INSTRUCTION_MAX_LENGTH },
    approvalRequired: { type: Boolean, default: false },
    maxAttempts: { type: Number, min: 1, max: WORKFLOW_STEP_MAX_ATTEMPTS, default: 3 },
    agentId: { type: String },
    dependsOn: { type: [String], default: [] },
    runIf: { type: Schema.Types.Mixed },
    join: { type: String, enum: ['all', 'any'] },
    timeoutMs: {
      type: Number,
      min: WORKFLOW_STEP_TIMEOUT_MS_MIN,
      max: WORKFLOW_STEP_TIMEOUT_MS_MAX,
    },
    status: { type: String, enum: WORKFLOW_STEP_STATUSES, default: 'pending' },
    attempts: { type: Number, min: 0, default: 0 },
    deliveryKey: { type: String },
    // Persist the exact conversation used by this dispatched step across worker ticks.
    conversationId: { type: String },
    approvedAt: { type: Date },
    startedAt: { type: Date },
    settledAt: { type: Date },
    availableAt: { type: Date },
    terminalStatus: { type: String, enum: ['complete', 'error'] },
    terminalAttempt: { type: Number, min: 0 },
    terminalAt: { type: Date },
    error: { type: String, maxlength: 2_048 },
    reason: { type: String, maxlength: 2_048 },
    result: { type: String, maxlength: WORKFLOW_RESULT_MAX_LENGTH },
  },
  { _id: false },
);

const workflowRunEventSchema = new Schema(
  {
    at: { type: Date, required: true },
    type: { type: String, enum: WORKFLOW_RUN_EVENT_TYPES, required: true },
    stepId: { type: String },
    message: { type: String, maxlength: 2_048 },
  },
  { _id: false },
);

const workflowRunSchema: Schema<IWorkflowRunDocument> = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    workflowId: { type: String, required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: String, index: true },
    workflowName: { type: String, required: true, maxlength: WORKFLOW_NAME_MAX_LENGTH },
    agentId: { type: String, required: true },
    status: { type: String, enum: WORKFLOW_RUN_STATUSES, default: 'queued', index: true },
    currentStep: { type: Number, min: 0, default: 0 },
    steps: { type: [workflowStepRunSchema], required: true },
    settings: { type: workflowSettingsSchema },
    conversationId: { type: String },
    input: { type: String, maxlength: WORKFLOW_RUN_INPUT_MAX_LENGTH },
    buildVerification: {
      type: new Schema(
        {
          mode: { type: String, enum: WORKFLOW_BUILD_MODES, required: true },
          requiredGates: {
            type: [String],
            enum: WORKFLOW_BUILD_GATES,
            required: true,
            default: undefined,
          },
        },
        { _id: false },
      ),
    },
    trigger: {
      type: new Schema(
        {
          type: { type: String, enum: ['manual', 'schedule', 'event'], required: true },
          sourceId: { type: String },
          label: { type: String, maxlength: 256 },
        },
        { _id: false },
      ),
    },
    events: { type: [workflowRunEventSchema], default: [] },
    workflowAncestry: { type: [String], default: undefined },
    onCompleteWorkflowId: { type: String },
    chainPending: { type: Boolean },
    dedupeKey: { type: String },
    error: { type: String, maxlength: 2_048 },
    leaseBy: { type: String },
    leaseUntil: { type: Date },
    leaseToken: { type: String },
    pauseRequestedAt: { type: Date },
    startedAt: { type: Date },
    settledAt: { type: Date },
  },
  { timestamps: true },
);

workflowRunSchema.index({ user: 1, createdAt: -1 });
workflowRunSchema.index({ workflowId: 1, createdAt: -1 });
/** The runner's claim query: active runs whose lease has lapsed. */
workflowRunSchema.index({ status: 1, leaseUntil: 1 });
/** One automatic occurrence can only ever create one run, across replicas. */
workflowRunSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

export { workflowSchema, workflowRunSchema };
export default workflowSchema;
