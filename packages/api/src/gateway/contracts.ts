import { z } from 'zod';

/**
 * Coderax's server-side copy of the WorkflowEngine wire contract.
 *
 * The authoritative definitions live in `Coderax-WorkflowEngine/packages/contracts`
 * and are published as `@coderax/sdk` once that package is released. Until then
 * this module is the single place Coderax learns the shapes, so swapping to the
 * published SDK is one import change rather than a rewrite. It is pinned to
 * CONTRACT_VERSION 1.0.0: the startup handshake refuses any other version, and
 * every request and response is validated here rather than trusted.
 *
 * Nothing in this module reads configuration, a credential or the environment.
 */

export const CONTRACT_VERSION: string = '1.0.0';

const identifier = (max = 128) => z.string().trim().min(1).max(max);

const ConversationId = identifier();
const TaskId = identifier();
const RequestId = identifier();
const DataMode = z.enum(['private', 'cloud']);
const AgentId = z.enum(['coderax', 'opencode', 'freebuff']);
const TaskState = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);
const IsoDateTime = z.string().datetime({ offset: true });

export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
];

export function isTerminalTaskState(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

const ModelRef = z.object({ providerId: identifier(64), modelId: identifier(160) }).strict();

const Usage = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const ProblemCode = z.enum([
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

/** The engine's failure body. `detail` is user-safe by contract, never a stack. */
const Problem = z
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

const EngineCapabilities = z
  .object({
    streaming: z.boolean(),
    tools: z.boolean(),
    cancellation: z.boolean(),
    resume: z.boolean(),
    modelSelection: z.boolean(),
    durable: z.boolean(),
  })
  .strict();

const Availability = z
  .object({
    available: z.boolean(),
    reason: z.enum([
      'ready',
      'disabled',
      'not_configured',
      'sdk_unavailable',
      'server_unavailable',
      'model_missing',
      'forbidden',
      'not_ready',
    ]),
    detail: z.string().max(500),
  })
  .strict();

const EngineStatus = z
  .object({
    id: z.string().min(1).max(40),
    capabilities: EngineCapabilities,
    availability: Availability,
  })
  .strict();

const HealthCheck = z
  .object({
    name: z.string().min(1).max(80),
    status: z.enum(['ok', 'degraded', 'failed']),
    required: z.boolean(),
    detail: z.string().max(500).optional(),
  })
  .strict();

const HealthReport = z
  .object({
    status: z.enum(['ok', 'degraded', 'failed']),
    contractVersion: z.string().min(1).max(32),
    startedAt: IsoDateTime,
    uptimeMs: z.number().int().nonnegative(),
    checks: z.array(HealthCheck),
    engines: z.array(EngineStatus),
  })
  .strict();

const ReadinessReport = z
  .object({
    ready: z.boolean(),
    missing: z.array(z.string().max(120)),
    checks: z.array(HealthCheck),
  })
  .strict();

const AgentDescriptor = z
  .object({
    id: AgentId,
    engine: z.enum(['native', 'opencode', 'freebuff']),
    label: z.string().min(1).max(80),
    external: z.boolean(),
    capabilities: EngineCapabilities,
    availability: Availability,
    isolation: z
      .object({
        workspace: z.literal('isolated'),
        memory: z.enum(['none', 'granted']),
        credentials: z.enum(['none', 'scoped']),
        conversations: z.enum(['none', 'granted']),
      })
      .strict(),
  })
  .strict();

const AgentList = z.object({ agents: z.array(AgentDescriptor) }).strict();

const ModelDescriptor = z
  .object({
    ref: ModelRef,
    label: z.string().min(1).max(160),
    costClass: z.enum(['free', 'paid']),
    contextTokens: z.number().int().positive().optional(),
    toolCalling: z.boolean(),
    streaming: z.boolean(),
    availability: Availability,
  })
  .strict();

const ModelList = z
  .object({
    models: z.array(ModelDescriptor),
    route: z.array(ModelRef),
    allowPaid: z.literal(false),
  })
  .strict();

const Budget = z
  .object({
    maxRequests: z.number().int().positive().max(10_000),
    maxInputTokens: z.number().int().positive().max(50_000_000),
    maxOutputTokens: z.number().int().positive().max(50_000_000),
  })
  .strict();

const ChatRequest = z
  .object({
    message: z.string().min(1).max(200_000),
    conversationId: ConversationId.optional(),
    agent: AgentId.default('coderax'),
    model: ModelRef.optional(),
    mode: DataMode.default('private'),
  })
  .strict();

const ChatReply = z
  .object({
    conversationId: ConversationId,
    messageId: identifier(),
    text: z.string(),
    agent: AgentId,
    model: ModelRef,
    usage: Usage.optional(),
    createdAt: IsoDateTime,
  })
  .strict();

const WorkSubmitRequest = z
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

const Artifact = z
  .object({
    path: z.string().min(1).max(1024),
    bytes: z.number().int().nonnegative().optional(),
    digest: z.string().min(1).max(128).optional(),
  })
  .strict();

const TaskStatus = z
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
      z.object({ id: identifier(80), title: z.string().max(200), state: TaskState }).strict(),
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
      .object({ code: z.string().min(1).max(60), detail: z.string().max(1000).optional() })
      .strict()
      .optional(),
  })
  .strict();

const TaskAccepted = z
  .object({
    taskId: TaskId,
    conversationId: ConversationId,
    state: TaskState,
    generation: z.number().int().nonnegative(),
    eventsPath: z.string().min(1).max(300),
  })
  .strict();

const CancelRequest = z.object({ reason: z.string().max(500).optional() }).strict();
const ResumeRequest = z.object({ generation: z.number().int().nonnegative() }).strict();
const RetryRequest = z
  .object({ generation: z.number().int().nonnegative(), model: ModelRef.optional() })
  .strict();

const TaskControlResult = z
  .object({
    taskId: TaskId,
    state: TaskState,
    generation: z.number().int().nonnegative(),
    outcome: z.enum(['accepted', 'already_terminal', 'not_found', 'superseded']),
  })
  .strict();

const Message = z
  .object({
    messageId: identifier(),
    conversationId: ConversationId,
    role: z.enum(['user', 'assistant', 'tool']),
    text: z.string(),
    createdAt: IsoDateTime,
    unfinished: z.boolean().optional(),
    agent: AgentId.optional(),
  })
  .strict();

const Conversation = z
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

const ConversationSummary = z
  .object({
    conversationId: ConversationId,
    title: z.string().max(300).optional(),
    isWork: z.boolean(),
    agent: AgentId,
    updatedAt: IsoDateTime,
  })
  .strict();

const ConversationList = z.object({ conversations: z.array(ConversationSummary) }).strict();

const MemoryList = z
  .object({
    entries: z.array(
      z
        .object({
          key: z.string().min(1).max(200),
          value: z.string().max(20_000),
          mode: DataMode,
          updatedAt: IsoDateTime,
        })
        .strict(),
    ),
  })
  .strict();

const PermissionList = z
  .object({
    requests: z.array(
      z
        .object({
          requestId: identifier(),
          taskId: TaskId,
          agent: AgentId,
          scope: z.enum([
            'workspace.read',
            'workspace.write',
            'command.execute',
            'network.access',
            'memory.read',
            'conversation.read',
            'credential.use',
          ]),
          description: z.string().min(1).max(2000),
          resource: z.string().min(1).max(1024),
          requestedAt: IsoDateTime,
          expiresAt: IsoDateTime,
          decision: z.enum(['pending', 'approved', 'denied']),
          decidedAt: IsoDateTime.optional(),
        })
        .strict(),
    ),
  })
  .strict();

const PermissionDecisionRequest = z
  .object({
    requestId: identifier(),
    decision: z.enum(['approved', 'denied']),
    reason: z.string().max(500).optional(),
  })
  .strict();

const NotificationList = z
  .object({
    notifications: z.array(
      z
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
        .strict(),
    ),
    unread: z.number().int().nonnegative(),
  })
  .strict();

export const EVENT_SCHEMA_VERSION = 1 as const;

const ExecutionEventType = z.enum([
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

const envelope = {
  v: z.literal(EVENT_SCHEMA_VERSION),
  eventId: z.string().min(1).max(120),
  taskId: TaskId,
  seq: z.number().int().positive(),
  at: IsoDateTime,
  agent: AgentId,
  generation: z.number().int().nonnegative(),
};

const stepPayload = z.object({ stepId: identifier(80), title: z.string().max(200) }).strict();

const ExecutionEvent = z.discriminatedUnion('type', [
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
          callId: identifier(120),
          tool: identifier(80),
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
          callId: identifier(120),
          tool: identifier(80),
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
          requestId: identifier(120),
          tool: identifier(80),
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
          code: z.string().min(1).max(60),
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

export const TERMINAL_EVENT_TYPES: readonly ExecutionEventType[] = [
  'task.completed',
  'task.failed',
  'task.cancelled',
  'task.interrupted',
];

export function isTerminalEvent(type: ExecutionEventType): boolean {
  return TERMINAL_EVENT_TYPES.includes(type);
}

export type ConversationId = z.infer<typeof ConversationId>;
export type TaskId = z.infer<typeof TaskId>;
export type RequestId = z.infer<typeof RequestId>;
export type DataMode = z.infer<typeof DataMode>;
export type AgentId = z.infer<typeof AgentId>;
export type TaskState = z.infer<typeof TaskState>;
export type IsoDateTime = z.infer<typeof IsoDateTime>;
export type ModelRef = z.infer<typeof ModelRef>;
export type Usage = z.infer<typeof Usage>;
export type ProblemCode = z.infer<typeof ProblemCode>;
export type Problem = z.infer<typeof Problem>;
export type EngineCapabilities = z.infer<typeof EngineCapabilities>;
export type Availability = z.infer<typeof Availability>;
export type EngineStatus = z.infer<typeof EngineStatus>;
export type HealthCheck = z.infer<typeof HealthCheck>;
export type HealthReport = z.infer<typeof HealthReport>;
export type ReadinessReport = z.infer<typeof ReadinessReport>;
export type AgentDescriptor = z.infer<typeof AgentDescriptor>;
export type AgentList = z.infer<typeof AgentList>;
export type ModelDescriptor = z.infer<typeof ModelDescriptor>;
export type ModelList = z.infer<typeof ModelList>;
export type Budget = z.infer<typeof Budget>;
export type ChatRequest = z.infer<typeof ChatRequest>;
export type ChatReply = z.infer<typeof ChatReply>;
export type WorkSubmitRequest = z.infer<typeof WorkSubmitRequest>;
export type Artifact = z.infer<typeof Artifact>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type TaskAccepted = z.infer<typeof TaskAccepted>;
export type CancelRequest = z.infer<typeof CancelRequest>;
export type ResumeRequest = z.infer<typeof ResumeRequest>;
export type RetryRequest = z.infer<typeof RetryRequest>;
export type TaskControlResult = z.infer<typeof TaskControlResult>;
export type Message = z.infer<typeof Message>;
export type Conversation = z.infer<typeof Conversation>;
export type ConversationSummary = z.infer<typeof ConversationSummary>;
export type ConversationList = z.infer<typeof ConversationList>;
export type MemoryList = z.infer<typeof MemoryList>;
export type PermissionList = z.infer<typeof PermissionList>;
export type PermissionDecisionRequest = z.infer<typeof PermissionDecisionRequest>;
export type NotificationList = z.infer<typeof NotificationList>;
export type ExecutionEventType = z.infer<typeof ExecutionEventType>;
export type ExecutionEvent = z.infer<typeof ExecutionEvent>;

const schemaTable = {
  ConversationId,
  TaskId,
  RequestId,
  DataMode,
  AgentId,
  TaskState,
  IsoDateTime,
  ModelRef,
  Usage,
  ProblemCode,
  Problem,
  EngineCapabilities,
  Availability,
  EngineStatus,
  HealthCheck,
  HealthReport,
  ReadinessReport,
  AgentDescriptor,
  AgentList,
  ModelDescriptor,
  ModelList,
  Budget,
  ChatRequest,
  ChatReply,
  WorkSubmitRequest,
  Artifact,
  TaskStatus,
  TaskAccepted,
  CancelRequest,
  ResumeRequest,
  RetryRequest,
  TaskControlResult,
  Message,
  Conversation,
  ConversationSummary,
  ConversationList,
  MemoryList,
  PermissionList,
  PermissionDecisionRequest,
  NotificationList,
  ExecutionEventType,
  ExecutionEvent,
};

type ContractSchemas = typeof schemaTable;

/** The runtime schemas, typed once so declarations stay isolated-safe. */
export function contractSchemas(): ContractSchemas {
  return schemaTable;
}
