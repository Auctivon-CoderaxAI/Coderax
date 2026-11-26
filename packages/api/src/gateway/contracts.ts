import { z } from 'zod';

/**
 * The gateway speaks the authoritative Coderax WorkflowEngine HTTP contract.
 *
 * Source of truth: `Auctivon-CoderaxAI/Coderax-WorkflowEngine`, branch `main`,
 * `packages/contracts/src` (HTTP contracts 1.0.0, execution events 1).
 * This module mirrors that contract deliberately and validates in both
 * directions, so a drifted deployment fails at this boundary with a named
 * contract error instead of producing a silently wrong UI or a forwarded
 * request the engine never promised to accept.
 *
 * Types are written out rather than inferred: this workspace builds declarations
 * with `isolatedDeclarations`, which refuses an exported schema whose type it
 * cannot print. Keeping the wire type explicit also makes a contract review a
 * type review, not a diff of zod chains.
 *
 * Rules for editing this file:
 * - Only add an operation that exists in the engine's `ROUTES` catalogue.
 * - Never loosen a schema to make an upstream response fit.
 * - A breaking change bumps `CONTRACT_VERSION` and the `/vN` prefix.
 */

export const CONTRACT_VERSION = '1.0.0' as const;
export const EVENT_SCHEMA_VERSION = 1 as const;

/** Coderax mounts the gateway under this prefix; it is the versioned surface clients call. */
export const GATEWAY_PREFIX: '/v1' = '/v1' as const;
export const GATEWAY_CONTRACT_VERSION: typeof CONTRACT_VERSION = CONTRACT_VERSION;

/* ------------------------------------------------------------------------- *
 * Wire types
 * ------------------------------------------------------------------------- */

export type DataMode = 'private' | 'cloud';
export type AgentId = 'coderax' | 'opencode' | 'freebuff';
export type EngineId = 'native' | 'opencode' | 'freebuff';
export type EngineFailureCode =
  | 'disabled'
  | 'sdk_unavailable'
  | 'not_configured'
  | 'server_unavailable'
  | 'workspace_denied'
  | 'busy'
  | 'timeout'
  | 'cancelled'
  | 'protocol_error'
  | 'provider_error'
  | 'budget_exhausted'
  | 'paid_model_refused';

export type TaskState =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/** Agent selection maps to exactly one engine. There is no implicit substitution. */
export const AGENT_ENGINE: Readonly<Record<AgentId, EngineId>> = Object.freeze({
  coderax: 'native',
  opencode: 'opencode',
  freebuff: 'freebuff',
});

export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
];

export function isTerminalState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

export type ModelRef = { providerId: string; modelId: string };
export type Usage = { inputTokens?: number; outputTokens?: number };
export type Budget = { maxRequests: number; maxInputTokens: number; maxOutputTokens: number };

export type EngineCapabilities = {
  streaming: boolean;
  tools: boolean;
  cancellation: boolean;
  resume: boolean;
  modelSelection: boolean;
  durable: boolean;
};

export type AvailabilityReason =
  | 'ready'
  | 'disabled'
  | 'not_configured'
  | 'sdk_unavailable'
  | 'server_unavailable'
  | 'model_missing'
  | 'forbidden'
  | 'not_ready';

export type Availability = {
  available: boolean;
  reason: AvailabilityReason;
  detail: string;
};

export type AgentIsolation = {
  workspace: 'isolated';
  memory: 'none' | 'granted';
  credentials: 'none' | 'scoped';
  conversations: 'none' | 'granted';
};

export type AgentDescriptor = {
  id: AgentId;
  engine: EngineId;
  label: string;
  external: boolean;
  capabilities: EngineCapabilities;
  availability: Availability;
  isolation: AgentIsolation;
};

export type AgentList = { agents: AgentDescriptor[] };

export type CostClass = 'free' | 'paid';

export type ModelDescriptor = {
  ref: ModelRef;
  label: string;
  costClass: CostClass;
  contextTokens?: number;
  toolCalling: boolean;
  streaming: boolean;
  availability: Availability;
};

export type ModelList = {
  models: ModelDescriptor[];
  route: ModelRef[];
  allowPaid: false;
};

export type EngineStatus = {
  id: string;
  capabilities: EngineCapabilities;
  availability: Availability;
};

export type CheckStatus = 'ok' | 'degraded' | 'failed';

export type HealthCheck = {
  name: string;
  status: CheckStatus;
  required: boolean;
  detail?: string;
};

export type HealthReport = {
  status: CheckStatus;
  contractVersion: typeof CONTRACT_VERSION;
  startedAt: string;
  uptimeMs: number;
  checks: HealthCheck[];
  engines: EngineStatus[];
};

export type ReadinessReport = {
  ready: boolean;
  missing: string[];
  checks: HealthCheck[];
};

export type ProblemCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'conflict'
  | 'busy'
  | 'not_ready'
  | 'engine_unavailable'
  | 'engine_not_configured'
  | 'model_missing'
  | 'workspace_denied'
  | 'budget_exhausted'
  | 'paid_model_refused'
  | 'permission_required'
  | 'cancelled'
  | 'protocol_error'
  | 'internal_error';

export type Problem = {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
  requestId?: string;
  retryable: boolean;
};

export type ChatRequest = {
  message: string;
  conversationId?: string;
  agent: AgentId;
  model?: ModelRef;
  mode: DataMode;
};

export type ChatReply = {
  conversationId: string;
  messageId: string;
  text: string;
  agent: AgentId;
  model: ModelRef;
  usage?: Usage;
  createdAt: string;
};

export type WorkSubmitRequest = {
  objective: string;
  conversationId?: string;
  agent?: AgentId;
  model?: ModelRef;
  mode: DataMode;
  budget?: Budget;
  requireApproval: boolean;
};

export type Artifact = {
  path: string;
  bytes?: number;
  digest?: string;
};

export type ArtifactList = {
  taskId: string;
  conversationId: string;
  state: TaskState;
  artifacts: Artifact[];
};

export type TaskStep = { id: string; title: string; state: TaskState };

export type TaskStatus = {
  taskId: string;
  conversationId: string;
  state: TaskState;
  agent: AgentId;
  mode: DataMode;
  model?: ModelRef;
  generation: number;
  createdAt: string;
  updatedAt: string;
  leaseExpiresAt?: string;
  cancelRequested: boolean;
  steps: TaskStep[];
  result?: { summary?: string; artifacts: Artifact[] };
  usage?: Usage;
  failure?: { code: string; detail?: string };
};

export type TaskAccepted = {
  taskId: string;
  conversationId: string;
  state: TaskState;
  generation: number;
  eventsPath: string;
};

export type CancelRequest = { reason?: string };

export type TaskControlResult = {
  taskId: string;
  state: TaskState;
  generation: number;
  outcome: 'accepted' | 'already_terminal' | 'not_found' | 'superseded';
};

export type RetryRequest = { generation: number; model?: ModelRef };
export type ResumeRequest = { generation: number };

export type Message = {
  messageId: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  createdAt: string;
  unfinished?: boolean;
  agent?: AgentId;
};

export type Conversation = {
  conversationId: string;
  title?: string;
  mode: DataMode;
  isWork: boolean;
  agent: AgentId;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
};

export type ConversationSummary = {
  conversationId: string;
  title?: string;
  isWork: boolean;
  agent: AgentId;
  updatedAt: string;
};

export type ConversationList = { conversations: ConversationSummary[] };

export type MemoryEntry = {
  key: string;
  value: string;
  mode: DataMode;
  updatedAt: string;
};

export type MemoryList = { entries: MemoryEntry[] };

export type PermissionScope =
  | 'workspace.read'
  | 'workspace.write'
  | 'command.execute'
  | 'network.access'
  | 'memory.read'
  | 'conversation.read'
  | 'credential.use';

export type PermissionRequest = {
  requestId: string;
  taskId: string;
  agent: AgentId;
  scope: PermissionScope;
  description: string;
  resource: string;
  requestedAt: string;
  expiresAt: string;
  decision: 'pending' | 'approved' | 'denied';
  decidedAt?: string;
};

export type PermissionList = { requests: PermissionRequest[] };

export type PermissionDecisionRequest = {
  requestId: string;
  decision: 'approved' | 'denied';
  reason?: string;
};

export type CompletionNotification = {
  taskId: string;
  conversationId: string;
  agent: AgentId;
  mode: DataMode;
  state: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  summary?: string;
  createdAt: string;
  read: boolean;
};

export type NotificationList = {
  notifications: CompletionNotification[];
  unread: number;
};

export type ExecutionEventType =
  | 'task.queued'
  | 'task.started'
  | 'step.started'
  | 'step.completed'
  | 'text.delta'
  | 'text.replace'
  | 'tool.call'
  | 'tool.result'
  | 'file.edit'
  | 'approval.required'
  | 'usage'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'task.interrupted';

export type EventEnvelope = {
  v: typeof EVENT_SCHEMA_VERSION;
  eventId: string;
  taskId: string;
  seq: number;
  at: string;
  agent: AgentId;
  generation: number;
};

export type StepPayload = { stepId: string; title: string };

export type ExecutionEvent =
  | (EventEnvelope & { type: 'task.queued' })
  | (EventEnvelope & { type: 'task.started'; payload?: { sessionId?: string } })
  | (EventEnvelope & { type: 'step.started'; payload: StepPayload })
  | (EventEnvelope & { type: 'step.completed'; payload: StepPayload })
  | (EventEnvelope & { type: 'text.delta'; payload: { text: string } })
  | (EventEnvelope & { type: 'text.replace'; payload: { text: string } })
  | (EventEnvelope & {
      type: 'tool.call';
      payload: { callId: string; tool: string; input?: unknown };
    })
  | (EventEnvelope & {
      type: 'tool.result';
      payload: { callId: string; tool: string; ok: boolean; output?: string };
    })
  | (EventEnvelope & {
      type: 'approval.required';
      payload: { requestId: string; tool: string; description: string };
    })
  | (EventEnvelope & { type: 'file.edit'; payload: { path: string } })
  | (EventEnvelope & { type: 'usage'; payload: Usage })
  | (EventEnvelope & {
      type: 'task.completed';
      payload: { summary?: string; model?: ModelRef; usage?: Usage };
    })
  | (EventEnvelope & {
      type: 'task.failed';
      payload: { code: EngineFailureCode; detail?: string; retryable: boolean };
    })
  | (EventEnvelope & { type: 'task.cancelled'; payload: { reason?: string } })
  | (EventEnvelope & { type: 'task.interrupted'; payload: { detail: string } });

export const TERMINAL_EVENT_TYPES: readonly ExecutionEventType[] = [
  'task.completed',
  'task.failed',
  'task.cancelled',
  'task.interrupted',
];

export function isTerminalEvent(type: ExecutionEventType): boolean {
  return TERMINAL_EVENT_TYPES.includes(type);
}

/** Gateway-only frames; they wrap engine payloads and never replace an engine schema. */
export type WorkStreamFrame =
  | { type: 'accepted'; task: TaskAccepted }
  | { type: 'event'; event: ExecutionEvent };

export type GatewayCapability =
  | 'chat'
  | 'streaming'
  | 'work'
  | 'events'
  | 'cancel'
  | 'resume'
  | 'retry'
  | 'conversations'
  | 'memory'
  | 'permissions'
  | 'notifications'
  | 'discovery'
  | 'artifacts'
  | 'scheduling';

/* ------------------------------------------------------------------------- *
 * Schemas
 * ------------------------------------------------------------------------- */

const identifier = (label: string, max = 128): z.ZodString =>
  z.string().trim().min(1).max(max).describe(label);

export const OwnerId: z.ZodString = identifier('owner identifier');
export const ConversationId: z.ZodString = identifier('conversation identifier');
export const TaskId: z.ZodString = identifier('task identifier');
export const MessageId: z.ZodString = identifier('message identifier');
export const RequestId: z.ZodString = identifier('request correlation identifier');

export const DataMode: z.ZodType<DataMode, z.ZodTypeDef, unknown> = z.enum(['private', 'cloud']);
export const AgentId: z.ZodType<AgentId, z.ZodTypeDef, unknown> = z.enum([
  'coderax',
  'opencode',
  'freebuff',
]);
export const EngineId: z.ZodType<EngineId, z.ZodTypeDef, unknown> = z.enum([
  'native',
  'opencode',
  'freebuff',
]);
export const EngineFailureCode: z.ZodType<EngineFailureCode, z.ZodTypeDef, unknown> = z.enum([
  'disabled',
  'sdk_unavailable',
  'not_configured',
  'server_unavailable',
  'workspace_denied',
  'busy',
  'timeout',
  'cancelled',
  'protocol_error',
  'provider_error',
  'budget_exhausted',
  'paid_model_refused',
]);
export const TaskState: z.ZodType<TaskState, z.ZodTypeDef, unknown> = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);
export const CostClass: z.ZodType<CostClass, z.ZodTypeDef, unknown> = z.enum(['free', 'paid']);
export const AvailabilityReason: z.ZodType<AvailabilityReason, z.ZodTypeDef, unknown> = z.enum([
  'ready',
  'disabled',
  'not_configured',
  'sdk_unavailable',
  'server_unavailable',
  'model_missing',
  'forbidden',
  'not_ready',
]);
export const CheckStatus: z.ZodType<CheckStatus, z.ZodTypeDef, unknown> = z.enum([
  'ok',
  'degraded',
  'failed',
]);
export const ProblemCode: z.ZodType<ProblemCode, z.ZodTypeDef, unknown> = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'busy',
  'not_ready',
  'engine_unavailable',
  'engine_not_configured',
  'model_missing',
  'workspace_denied',
  'budget_exhausted',
  'paid_model_refused',
  'permission_required',
  'cancelled',
  'protocol_error',
  'internal_error',
]);
export const PermissionScope: z.ZodType<PermissionScope, z.ZodTypeDef, unknown> = z.enum([
  'workspace.read',
  'workspace.write',
  'command.execute',
  'network.access',
  'memory.read',
  'conversation.read',
  'credential.use',
]);
export const ExecutionEventType: z.ZodType<ExecutionEventType, z.ZodTypeDef, unknown> = z.enum([
  'task.queued',
  'task.started',
  'step.started',
  'step.completed',
  'text.delta',
  'text.replace',
  'tool.call',
  'tool.result',
  'file.edit',
  'approval.required',
  'usage',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'task.interrupted',
]);
export const GatewayCapability: z.ZodType<GatewayCapability, z.ZodTypeDef, unknown> = z.enum([
  'chat',
  'streaming',
  'work',
  'events',
  'cancel',
  'resume',
  'retry',
  'conversations',
  'memory',
  'permissions',
  'notifications',
  'discovery',
  'artifacts',
  'scheduling',
]);

export const IsoDateTime: z.ZodString = z.string().datetime({ offset: true });

export const ModelRef: z.ZodType<ModelRef, z.ZodTypeDef, unknown> = z
  .object({
    providerId: identifier('provider identifier', 64),
    modelId: identifier('model identifier', 160),
  })
  .strict();

export const Usage: z.ZodType<Usage, z.ZodTypeDef, unknown> = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export const Budget: z.ZodType<Budget, z.ZodTypeDef, unknown> = z
  .object({
    maxRequests: z.number().int().positive().max(10_000),
    maxInputTokens: z.number().int().positive().max(50_000_000),
    maxOutputTokens: z.number().int().positive().max(50_000_000),
  })
  .strict();

export const EngineCapabilities: z.ZodType<EngineCapabilities, z.ZodTypeDef, unknown> = z
  .object({
    streaming: z.boolean(),
    tools: z.boolean(),
    cancellation: z.boolean(),
    resume: z.boolean(),
    modelSelection: z.boolean(),
    durable: z.boolean(),
  })
  .strict();

export const Availability: z.ZodType<Availability, z.ZodTypeDef, unknown> = z
  .object({
    available: z.boolean(),
    reason: AvailabilityReason,
    detail: z.string().max(500),
  })
  .strict();

export const AgentIsolation: z.ZodType<AgentIsolation, z.ZodTypeDef, unknown> = z
  .object({
    workspace: z.literal('isolated'),
    memory: z.enum(['none', 'granted']),
    credentials: z.enum(['none', 'scoped']),
    conversations: z.enum(['none', 'granted']),
  })
  .strict();

export const AgentDescriptor: z.ZodType<AgentDescriptor, z.ZodTypeDef, unknown> = z
  .object({
    id: AgentId,
    engine: EngineId,
    label: z.string().min(1).max(80),
    external: z.boolean(),
    capabilities: EngineCapabilities,
    availability: Availability,
    isolation: AgentIsolation,
  })
  .strict();

export const AgentList: z.ZodType<AgentList, z.ZodTypeDef, unknown> = z
  .object({ agents: z.array(AgentDescriptor) })
  .strict();

export const ModelDescriptor: z.ZodType<ModelDescriptor, z.ZodTypeDef, unknown> = z
  .object({
    ref: ModelRef,
    label: z.string().min(1).max(160),
    costClass: CostClass,
    contextTokens: z.number().int().positive().optional(),
    toolCalling: z.boolean(),
    streaming: z.boolean(),
    availability: Availability,
  })
  .strict();

export const ModelList: z.ZodType<ModelList, z.ZodTypeDef, unknown> = z
  .object({
    models: z.array(ModelDescriptor),
    route: z.array(ModelRef),
    allowPaid: z.literal(false),
  })
  .strict();

export const EngineStatus: z.ZodType<EngineStatus, z.ZodTypeDef, unknown> = z
  .object({
    id: z.string().min(1).max(40),
    capabilities: EngineCapabilities,
    availability: Availability,
  })
  .strict();

export const HealthCheck: z.ZodType<HealthCheck, z.ZodTypeDef, unknown> = z
  .object({
    name: z.string().min(1).max(80),
    status: CheckStatus,
    required: z.boolean(),
    detail: z.string().max(500).optional(),
  })
  .strict();

export const HealthReport: z.ZodType<HealthReport, z.ZodTypeDef, unknown> = z
  .object({
    status: CheckStatus,
    contractVersion: z.literal(CONTRACT_VERSION),
    startedAt: IsoDateTime,
    uptimeMs: z.number().int().nonnegative(),
    checks: z.array(HealthCheck),
    engines: z.array(EngineStatus),
  })
  .strict();

export const ReadinessReport: z.ZodType<ReadinessReport, z.ZodTypeDef, unknown> = z
  .object({
    ready: z.boolean(),
    missing: z.array(z.string().max(120)),
    checks: z.array(HealthCheck),
  })
  .strict();

export const Problem: z.ZodType<Problem, z.ZodTypeDef, unknown> = z
  .object({
    type: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    status: z.number().int().min(400).max(599),
    code: ProblemCode,
    detail: z.string().max(2000).optional(),
    requestId: RequestId.optional(),
    retryable: z.boolean(),
  })
  .strict();

export const ChatRequest: z.ZodType<ChatRequest, z.ZodTypeDef, unknown> = z
  .object({
    message: z.string().min(1).max(200_000),
    conversationId: ConversationId.optional(),
    agent: AgentId.default('coderax'),
    model: ModelRef.optional(),
    mode: DataMode.default('private'),
  })
  .strict();

export const ChatReply: z.ZodType<ChatReply, z.ZodTypeDef, unknown> = z
  .object({
    conversationId: ConversationId,
    messageId: MessageId,
    text: z.string(),
    agent: AgentId,
    model: ModelRef,
    usage: Usage.optional(),
    createdAt: IsoDateTime,
  })
  .strict();

export const WorkSubmitRequest: z.ZodType<WorkSubmitRequest, z.ZodTypeDef, unknown> = z
  .object({
    objective: z.string().min(1).max(200_000),
    conversationId: ConversationId.optional(),
    agent: AgentId.optional(),
    model: ModelRef.optional(),
    mode: DataMode.default('cloud'),
    budget: Budget.optional(),
    requireApproval: z.boolean().default(true),
  })
  .strict();

export const Artifact: z.ZodType<Artifact, z.ZodTypeDef, unknown> = z
  .object({
    path: z.string().min(1).max(1024),
    bytes: z.number().int().nonnegative().optional(),
    digest: z.string().min(1).max(128).optional(),
  })
  .strict();

export const ArtifactList: z.ZodType<ArtifactList, z.ZodTypeDef, unknown> = z
  .object({
    taskId: TaskId,
    conversationId: ConversationId,
    state: TaskState,
    artifacts: z.array(Artifact),
  })
  .strict();

export const TaskStatus: z.ZodType<TaskStatus, z.ZodTypeDef, unknown> = z
  .object({
    taskId: TaskId,
    conversationId: ConversationId,
    state: TaskState,
    agent: AgentId,
    mode: DataMode,
    model: ModelRef.optional(),
    generation: z.number().int().nonnegative(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
    leaseExpiresAt: IsoDateTime.optional(),
    cancelRequested: z.boolean(),
    steps: z.array(
      z
        .object({
          id: z.string().min(1).max(80),
          title: z.string().max(200),
          state: TaskState,
        })
        .strict(),
    ),
    result: z
      .object({
        summary: z.string().max(20_000).optional(),
        artifacts: z.array(Artifact),
      })
      .strict()
      .optional(),
    usage: Usage.optional(),
    failure: z
      .object({
        code: z.string().min(1).max(60),
        detail: z.string().max(1000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const TaskAccepted: z.ZodType<TaskAccepted, z.ZodTypeDef, unknown> = z
  .object({
    taskId: TaskId,
    conversationId: ConversationId,
    state: TaskState,
    generation: z.number().int().nonnegative(),
    eventsPath: z.string().min(1).max(300),
  })
  .strict();

export const CancelRequest: z.ZodType<CancelRequest, z.ZodTypeDef, unknown> = z
  .object({ reason: z.string().max(500).optional() })
  .strict();

export const TaskControlResult: z.ZodType<TaskControlResult, z.ZodTypeDef, unknown> = z
  .object({
    taskId: TaskId,
    state: TaskState,
    generation: z.number().int().nonnegative(),
    outcome: z.enum(['accepted', 'already_terminal', 'not_found', 'superseded']),
  })
  .strict();

export const RetryRequest: z.ZodType<RetryRequest, z.ZodTypeDef, unknown> = z
  .object({ generation: z.number().int().nonnegative(), model: ModelRef.optional() })
  .strict();

export const ResumeRequest: z.ZodType<ResumeRequest, z.ZodTypeDef, unknown> = z
  .object({ generation: z.number().int().nonnegative() })
  .strict();

export const Message: z.ZodType<Message, z.ZodTypeDef, unknown> = z
  .object({
    messageId: MessageId,
    conversationId: ConversationId,
    role: z.enum(['user', 'assistant', 'tool']),
    text: z.string(),
    createdAt: IsoDateTime,
    unfinished: z.boolean().optional(),
    agent: AgentId.optional(),
  })
  .strict();

export const Conversation: z.ZodType<Conversation, z.ZodTypeDef, unknown> = z
  .object({
    conversationId: ConversationId,
    title: z.string().max(300).optional(),
    mode: DataMode,
    isWork: z.boolean(),
    agent: AgentId,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
    messages: z.array(Message),
  })
  .strict();

export const ConversationSummary: z.ZodType<ConversationSummary, z.ZodTypeDef, unknown> = z
  .object({
    conversationId: ConversationId,
    title: z.string().max(300).optional(),
    isWork: z.boolean(),
    agent: AgentId,
    updatedAt: IsoDateTime,
  })
  .strict();

export const ConversationList: z.ZodType<ConversationList, z.ZodTypeDef, unknown> = z
  .object({ conversations: z.array(ConversationSummary) })
  .strict();

export const MemoryEntry: z.ZodType<MemoryEntry, z.ZodTypeDef, unknown> = z
  .object({
    key: z.string().min(1).max(200),
    value: z.string().max(20_000),
    mode: DataMode,
    updatedAt: IsoDateTime,
  })
  .strict();

export const MemoryList: z.ZodType<MemoryList, z.ZodTypeDef, unknown> = z
  .object({ entries: z.array(MemoryEntry) })
  .strict();

export const PermissionRequest: z.ZodType<PermissionRequest, z.ZodTypeDef, unknown> = z
  .object({
    requestId: RequestId,
    taskId: TaskId,
    agent: AgentId,
    scope: PermissionScope,
    description: z.string().min(1).max(2000),
    resource: z.string().min(1).max(1024),
    requestedAt: IsoDateTime,
    expiresAt: IsoDateTime,
    decision: z.enum(['pending', 'approved', 'denied']),
    decidedAt: IsoDateTime.optional(),
  })
  .strict();

export const PermissionList: z.ZodType<PermissionList, z.ZodTypeDef, unknown> = z
  .object({ requests: z.array(PermissionRequest) })
  .strict();

export const PermissionDecisionRequest: z.ZodType<
  PermissionDecisionRequest,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    requestId: RequestId,
    decision: z.enum(['approved', 'denied']),
    reason: z.string().max(500).optional(),
  })
  .strict();

export const CompletionNotification: z.ZodType<CompletionNotification, z.ZodTypeDef, unknown> = z
  .object({
    taskId: TaskId,
    conversationId: ConversationId,
    agent: AgentId,
    mode: DataMode,
    state: z.enum(['completed', 'failed', 'cancelled', 'interrupted']),
    summary: z.string().max(500).optional(),
    createdAt: IsoDateTime,
    read: z.boolean(),
  })
  .strict();

export const NotificationList: z.ZodType<NotificationList, z.ZodTypeDef, unknown> = z
  .object({
    notifications: z.array(CompletionNotification),
    unread: z.number().int().nonnegative(),
  })
  .strict();

const envelope = {
  v: z.literal(EVENT_SCHEMA_VERSION),
  eventId: z.string().min(1).max(120),
  taskId: TaskId,
  seq: z.number().int().positive(),
  at: IsoDateTime,
  agent: AgentId,
  generation: z.number().int().nonnegative(),
};

const stepPayload = z
  .object({ stepId: z.string().min(1).max(80), title: z.string().max(200) })
  .strict();

export const ExecutionEvent: z.ZodType<ExecutionEvent, z.ZodTypeDef, unknown> =
  z.discriminatedUnion('type', [
    z.object({ ...envelope, type: z.literal('task.queued') }).strict(),
    z
      .object({
        ...envelope,
        type: z.literal('task.started'),
        payload: z
          .object({ sessionId: z.string().min(1).max(200).optional() })
          .strict()
          .optional(),
      })
      .strict(),
    z.object({ ...envelope, type: z.literal('step.started'), payload: stepPayload }).strict(),
    z.object({ ...envelope, type: z.literal('step.completed'), payload: stepPayload }).strict(),
    z
      .object({
        ...envelope,
        type: z.literal('text.delta'),
        payload: z.object({ text: z.string().min(1) }).strict(),
      })
      .strict(),
    z
      .object({
        ...envelope,
        type: z.literal('text.replace'),
        payload: z.object({ text: z.string() }).strict(),
      })
      .strict(),
    z
      .object({
        ...envelope,
        type: z.literal('tool.call'),
        payload: z
          .object({
            callId: z.string().min(1).max(120),
            tool: z.string().min(1).max(80),
            input: z.unknown().optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...envelope,
        type: z.literal('tool.result'),
        payload: z
          .object({
            callId: z.string().min(1).max(120),
            tool: z.string().min(1).max(80),
            ok: z.boolean(),
            output: z.string().max(20_000).optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...envelope,
        type: z.literal('approval.required'),
        payload: z
          .object({
            requestId: z.string().min(1).max(120),
            tool: z.string().min(1).max(80),
            description: z.string().max(2000),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...envelope,
        type: z.literal('file.edit'),
        payload: z.object({ path: z.string().min(1).max(1024) }).strict(),
      })
      .strict(),
    z.object({ ...envelope, type: z.literal('usage'), payload: Usage }).strict(),
    z
      .object({
        ...envelope,
        type: z.literal('task.completed'),
        payload: z
          .object({
            summary: z.string().max(20_000).optional(),
            model: ModelRef.optional(),
            usage: Usage.optional(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...envelope,
        type: z.literal('task.failed'),
        payload: z
          .object({
            code: EngineFailureCode,
            detail: z.string().max(1000).optional(),
            retryable: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...envelope,
        type: z.literal('task.cancelled'),
        payload: z.object({ reason: z.string().max(500).optional() }).strict(),
      })
      .strict(),
    z
      .object({
        ...envelope,
        type: z.literal('task.interrupted'),
        payload: z.object({ detail: z.string().max(500) }).strict(),
      })
      .strict(),
  ]);

/* ------------------------------------------------------------------------- *
 * Route catalogue
 * ------------------------------------------------------------------------- */

export type EngineOperation =
  | 'getHealth'
  | 'getReadiness'
  | 'listAgents'
  | 'listModels'
  | 'submitChat'
  | 'submitWork'
  | 'getTask'
  | 'cancelTask'
  | 'resumeTask'
  | 'retryTask'
  | 'streamTaskEvents'
  | 'listConversations'
  | 'getConversation'
  | 'listMemory'
  | 'listPermissions'
  | 'decidePermission'
  | 'listNotifications';

export const ENGINE_OPERATIONS: readonly EngineOperation[] = [
  'getHealth',
  'getReadiness',
  'listAgents',
  'listModels',
  'submitChat',
  'submitWork',
  'getTask',
  'cancelTask',
  'resumeTask',
  'retryTask',
  'streamTaskEvents',
  'listConversations',
  'getConversation',
  'listMemory',
  'listPermissions',
  'decidePermission',
  'listNotifications',
];

export type EngineRoute = {
  operation: EngineOperation;
  method: 'GET' | 'POST';
  /** OpenAPI-style path; `{taskId}` and `{conversationId}` are substituted. */
  path: string;
  stream: boolean;
  successStatus: number;
  /** Request body schema, when the operation takes one. */
  body?: z.ZodTypeAny;
  /** Response schema; every successful response is parsed with it. */
  response: z.ZodTypeAny;
};

/**
 * The route catalogue. A gateway route exists only because an entry exists here,
 * and a response is only returned after its schema accepted it.
 */
export const ENGINE_ROUTES: Readonly<Record<EngineOperation, EngineRoute>> = Object.freeze({
  getHealth: {
    operation: 'getHealth',
    method: 'GET',
    path: '/v1/health',
    stream: false,
    successStatus: 200,
    response: HealthReport,
  },
  getReadiness: {
    operation: 'getReadiness',
    method: 'GET',
    path: '/v1/ready',
    stream: false,
    successStatus: 200,
    response: ReadinessReport,
  },
  listAgents: {
    operation: 'listAgents',
    method: 'GET',
    path: '/v1/agents',
    stream: false,
    successStatus: 200,
    response: AgentList,
  },
  listModels: {
    operation: 'listModels',
    method: 'GET',
    path: '/v1/models',
    stream: false,
    successStatus: 200,
    response: ModelList,
  },
  submitChat: {
    operation: 'submitChat',
    method: 'POST',
    path: '/v1/chat',
    stream: true,
    successStatus: 200,
    body: ChatRequest,
    response: ChatReply,
  },
  submitWork: {
    operation: 'submitWork',
    method: 'POST',
    path: '/v1/work',
    stream: false,
    successStatus: 202,
    body: WorkSubmitRequest,
    response: TaskAccepted,
  },
  getTask: {
    operation: 'getTask',
    method: 'GET',
    path: '/v1/work/{taskId}',
    stream: false,
    successStatus: 200,
    response: TaskStatus,
  },
  cancelTask: {
    operation: 'cancelTask',
    method: 'POST',
    path: '/v1/work/{taskId}/cancel',
    stream: false,
    successStatus: 200,
    body: CancelRequest,
    response: TaskControlResult,
  },
  resumeTask: {
    operation: 'resumeTask',
    method: 'POST',
    path: '/v1/work/{taskId}/resume',
    stream: false,
    successStatus: 200,
    body: ResumeRequest,
    response: TaskControlResult,
  },
  retryTask: {
    operation: 'retryTask',
    method: 'POST',
    path: '/v1/work/{taskId}/retry',
    stream: false,
    successStatus: 200,
    body: RetryRequest,
    response: TaskControlResult,
  },
  streamTaskEvents: {
    operation: 'streamTaskEvents',
    method: 'GET',
    path: '/v1/work/{taskId}/events',
    stream: true,
    successStatus: 200,
    response: ExecutionEvent,
  },
  listConversations: {
    operation: 'listConversations',
    method: 'GET',
    path: '/v1/conversations',
    stream: false,
    successStatus: 200,
    response: ConversationList,
  },
  getConversation: {
    operation: 'getConversation',
    method: 'GET',
    path: '/v1/conversations/{conversationId}',
    stream: false,
    successStatus: 200,
    response: Conversation,
  },
  listMemory: {
    operation: 'listMemory',
    method: 'GET',
    path: '/v1/memory',
    stream: false,
    successStatus: 200,
    response: MemoryList,
  },
  listPermissions: {
    operation: 'listPermissions',
    method: 'GET',
    path: '/v1/work/{taskId}/permissions',
    stream: false,
    successStatus: 200,
    response: PermissionList,
  },
  decidePermission: {
    operation: 'decidePermission',
    method: 'POST',
    path: '/v1/work/{taskId}/permissions',
    stream: false,
    successStatus: 200,
    body: PermissionDecisionRequest,
    response: PermissionList,
  },
  listNotifications: {
    operation: 'listNotifications',
    method: 'GET',
    path: '/v1/notifications',
    stream: false,
    successStatus: 200,
    response: NotificationList,
  },
});

/** Builds an engine path with encoded parameters. Unknown placeholders throw. */
export function enginePath(
  operation: EngineOperation,
  params: Readonly<Record<string, string>> = {},
): string {
  const route = ENGINE_ROUTES[operation];
  return route.path.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value == null || value.length === 0) {
      throw new Error(`operation ${operation} requires parameter ${key}`);
    }
    return encodeURIComponent(value);
  });
}

export type SchemaIssue = { path: string; message: string };

/**
 * Converts a zod failure into issue summaries without echoing submitted values.
 * Zod messages describe the expected shape, and the path names the field.
 */
export function describeIssues(error: z.ZodError, limit = 5): SchemaIssue[] {
  return error.issues.slice(0, limit).map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : '(body)',
    message: issue.message,
  }));
}
