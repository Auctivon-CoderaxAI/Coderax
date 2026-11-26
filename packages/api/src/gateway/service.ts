import { z } from 'zod';
import type {
  AgentList,
  ArtifactList,
  ChatReply,
  Conversation,
  ConversationList,
  ExecutionEvent,
  HealthReport,
  MemoryList,
  ModelList,
  NotificationList,
  PermissionDecisionRequest,
  PermissionList,
  ReadinessReport,
  TaskAccepted,
  TaskControlResult,
  TaskStatus,
  WorkSubmitRequest,
  ChatRequest,
  DataMode,
  EngineOperation,
} from './contracts';
import type { CapabilityNegotiation, CapabilitySnapshot } from './negotiation';
import type { TransportSelector } from './transport';
import type { EngineHttpClient } from './client';
import type { GatewayResult } from './errors';
import type { GatewayConfig } from './config';
import {
  AgentList as AgentListSchema,
  ArtifactList as ArtifactListSchema,
  ChatReply as ChatReplySchema,
  ChatRequest as ChatRequestSchema,
  Conversation as ConversationSchema,
  ConversationList as ConversationListSchema,
  ENGINE_ROUTES,
  ExecutionEvent as ExecutionEventSchema,
  HealthReport as HealthReportSchema,
  MemoryList as MemoryListSchema,
  ModelList as ModelListSchema,
  NotificationList as NotificationListSchema,
  PermissionDecisionRequest as PermissionDecisionRequestSchema,
  PermissionList as PermissionListSchema,
  ReadinessReport as ReadinessReportSchema,
  TaskAccepted as TaskAcceptedSchema,
  TaskControlResult as TaskControlResultSchema,
  TaskStatus as TaskStatusSchema,
  WorkSubmitRequest as WorkSubmitRequestSchema,
  CancelRequest,
  ResumeRequest,
  RetryRequest,
  enginePath,
  isTerminalEvent,
} from './contracts';
import { fail, gatewayError, ok } from './errors';

/**
 * The gateway service owns every decision between an inbound Coderax request and
 * an outbound engine call: authentication is already done, but transport
 * authority, contract version, capability availability, request validation and
 * response validation all happen here. A forwarding path that skips one of these
 * steps does not exist.
 */

/** Diagnostics surface: the gateway's version, transport selection and engine readiness. */
export type GatewayMeta = {
  gateway: {
    contractVersion: string;
    operations: string[];
    authority: 'native' | 'engine';
    reversible: boolean;
    engineConversations: number;
    nativeConversations: number;
  };
  engine: {
    configured: boolean;
    reachable: boolean;
    compatible: boolean;
    ready: boolean;
    contractVersion?: string;
    eventSchemaVersion: number;
    checkedAt?: string;
    failure?: string;
  };
  capabilities: Record<string, boolean>;
  unavailable: string[];
};

export type ChatStream = { kind: 'reply'; reply: ChatReply };

export type EventStream = {
  taskId: string;
  conversationId: string;
  events: AsyncIterable<ExecutionEvent>;
};

export type GatewayService = {
  meta: () => Promise<GatewayResult<GatewayMeta>>;
  health: () => Promise<GatewayResult<HealthReport>>;
  readiness: () => Promise<GatewayResult<ReadinessReport>>;
  agents: () => Promise<GatewayResult<AgentList>>;
  models: () => Promise<GatewayResult<ModelList>>;
  chat: (body: unknown) => Promise<GatewayResult<ChatStream>>;
  submitWork: (body: unknown) => Promise<GatewayResult<TaskAccepted>>;
  task: (taskId: string) => Promise<GatewayResult<TaskStatus>>;
  artifacts: (taskId: string) => Promise<GatewayResult<ArtifactList>>;
  cancel: (taskId: string, body: unknown) => Promise<GatewayResult<TaskControlResult>>;
  resume: (taskId: string, body: unknown) => Promise<GatewayResult<TaskControlResult>>;
  retry: (taskId: string, body: unknown) => Promise<GatewayResult<TaskControlResult>>;
  events: (
    taskId: string,
    after: number,
    options?: { signal?: AbortSignal },
  ) => Promise<GatewayResult<EventStream>>;
  conversations: () => Promise<GatewayResult<ConversationList>>;
  conversation: (conversationId: string) => Promise<GatewayResult<Conversation>>;
  memory: (mode: DataMode) => Promise<GatewayResult<MemoryList>>;
  permissions: (taskId: string) => Promise<GatewayResult<PermissionList>>;
  decidePermission: (taskId: string, body: unknown) => Promise<GatewayResult<PermissionList>>;
  notifications: () => Promise<GatewayResult<NotificationList>>;
  scheduling: () => GatewayResult<never>;
};

export type GatewayServiceOptions = {
  client: EngineHttpClient;
  negotiation: CapabilityNegotiation;
  transport: TransportSelector;
  config: GatewayConfig;
};

type CallOptions = {
  operation: EngineOperation;
  params?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

const streamable = (operation: EngineOperation): boolean => ENGINE_ROUTES[operation].stream;

export function createGatewayService(options: GatewayServiceOptions): GatewayService {
  const { client, negotiation, transport, config } = options;

  async function snapshot(): Promise<GatewayResult<CapabilitySnapshot>> {
    if (!config.enabled) {
      return fail(
        gatewayError('gateway_disabled', {
          detail: 'the WorkflowEngine gateway is not enabled for this deployment',
        }),
      );
    }
    if (config.baseUrl == null) {
      return fail(
        gatewayError('gateway_disabled', {
          detail: 'the WorkflowEngine gateway has no configured base URL',
        }),
      );
    }
    return negotiation.snapshot();
  }

  async function callJson<T>(
    call: CallOptions,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    requestId?: string,
  ): Promise<GatewayResult<T>> {
    const route = ENGINE_ROUTES[call.operation];
    const path = enginePath(call.operation, call.params);
    const response = await client.call({
      operation: call.operation,
      path,
      method: route.method,
      ...(call.query == null ? {} : { query: call.query }),
      ...(call.body === undefined ? {} : { body: call.body }),
      stream: false,
    });
    if (!response.ok) {
      return fail(response.error);
    }
    if (response.value.kind !== 'json') {
      return fail(
        gatewayError('contract_mismatch', {
          detail: `the engine answered ${call.operation} with a stream`,
          ...(requestId ? { requestId } : {}),
        }),
      );
    }
    if (response.value.status !== route.successStatus) {
      return fail(
        gatewayError('contract_mismatch', {
          detail: `the engine answered ${call.operation} with HTTP ${response.value.status}`,
          ...(requestId ? { requestId } : {}),
        }),
      );
    }
    const parsed = schema.safeParse(response.value.body);
    if (!parsed.success) {
      return fail(
        gatewayError('contract_mismatch', {
          detail: `the ${call.operation} response did not match contract ${negotiation.contractVersion}`,
          ...(requestId ? { requestId } : {}),
        }),
      );
    }
    return ok(parsed.data);
  }

  async function assertAuthority(
    conversationId: string | undefined,
    requestId?: string,
  ): Promise<GatewayResult<true>> {
    const authority = transport.authorityForConversation(conversationId);
    if (authority !== 'engine') {
      return fail(
        gatewayError('authority_conflict', {
          detail:
            conversationId == null
              ? 'new conversations are owned by the in-repository engine'
              : 'this conversation is owned by the in-repository engine',
          ...(requestId ? { requestId } : {}),
          retryable: false,
        }),
      );
    }
    return ok(true);
  }

  async function readTask(taskId: string, requestId?: string): Promise<GatewayResult<TaskStatus>> {
    const parsed = z.string().trim().min(1).max(128).safeParse(taskId);
    if (!parsed.success) {
      return fail(
        gatewayError('validation_failed', {
          detail: 'taskId is invalid',
          ...(requestId ? { requestId } : {}),
        }),
      );
    }
    return callJson(
      { operation: 'getTask', params: { taskId: parsed.data } },
      TaskStatusSchema,
      requestId,
    );
  }

  async function taskWithAuthority(
    taskId: string,
    requestId?: string,
  ): Promise<GatewayResult<TaskStatus>> {
    const task = await readTask(taskId, requestId);
    if (!task.ok) {
      return task;
    }
    const authority = await assertAuthority(task.value.conversationId, requestId);
    if (!authority.ok) {
      return authority;
    }
    return task;
  }

  function requireEngineDataPlane(requestId?: string): GatewayResult<true> {
    if (transport.mode !== 'engine') {
      return fail(
        gatewayError('transport_native', {
          detail:
            'conversation history is owned by the in-repository engine while authority is native',
          ...(requestId ? { requestId } : {}),
          retryable: false,
        }),
      );
    }
    return ok(true);
  }

  return {
    meta: async () => {
      const lastKnown = negotiation.lastKnown();
      if (!config.enabled) {
        return ok({
          gateway: {
            contractVersion: negotiation.contractVersion,
            operations: [],
            authority: transport.mode,
            reversible: true,
            engineConversations: config.engineConversations.length,
            nativeConversations: config.nativeConversations.length,
          },
          engine: {
            configured: false,
            reachable: false,
            compatible: false,
            ready: false,
            eventSchemaVersion: 1,
          },
          capabilities: {},
          unavailable: [],
        });
      }

      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return ok({
          gateway: {
            contractVersion: negotiation.contractVersion,
            operations: [],
            authority: transport.mode,
            reversible: true,
            engineConversations: config.engineConversations.length,
            nativeConversations: config.nativeConversations.length,
          },
          engine: {
            configured: true,
            reachable: lastKnown?.ok === true,
            compatible: false,
            ready: false,
            eventSchemaVersion: 1,
            failure: negotiated.error.code,
          },
          capabilities: {},
          unavailable: [],
        });
      }

      return ok({
        gateway: {
          contractVersion: negotiated.value.contractVersion,
          operations: Object.keys(ENGINE_ROUTES),
          authority: transport.mode,
          reversible: true,
          engineConversations: config.engineConversations.length,
          nativeConversations: config.nativeConversations.length,
        },
        engine: {
          configured: true,
          reachable: true,
          compatible: negotiated.value.compatible,
          ready: negotiated.value.ready,
          contractVersion: negotiated.value.contractVersion,
          eventSchemaVersion: negotiated.value.eventSchemaVersion,
          checkedAt: negotiated.value.checkedAt,
        },
        capabilities: negotiated.value.capabilities,
        unavailable: negotiated.value.unavailable,
      });
    },

    health: async () => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      return callJson({ operation: 'getHealth' }, HealthReportSchema);
    },

    readiness: async () => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      return callJson({ operation: 'getReadiness' }, ReadinessReportSchema);
    },

    agents: async () => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      return callJson({ operation: 'listAgents' }, AgentListSchema);
    },

    models: async () => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      return callJson({ operation: 'listModels' }, ModelListSchema);
    },

    chat: async (body) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      const request = ChatRequestSchema.safeParse(body);
      if (!request.success) {
        return fail(
          gatewayError('validation_failed', {
            detail: `chat request is invalid: ${request.error.issues
              .slice(0, 3)
              .map((issue) => issue.path.join('.'))
              .join(', ')}`,
          }),
        );
      }
      const authority = await assertAuthority(request.data.conversationId);
      if (!authority.ok) {
        return authority;
      }
      const reply = await callJson<ChatReply>(
        { operation: 'submitChat', body: request.data satisfies ChatRequest },
        ChatReplySchema,
      );
      if (!reply.ok) {
        return reply;
      }
      return ok({ kind: 'reply', reply: reply.value });
    },

    submitWork: async (body) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      const request = WorkSubmitRequestSchema.safeParse(body);
      if (!request.success) {
        return fail(
          gatewayError('validation_failed', {
            detail: `work request is invalid: ${request.error.issues
              .slice(0, 3)
              .map((issue) => issue.path.join('.'))
              .join(', ')}`,
          }),
        );
      }
      const authority = await assertAuthority(request.data.conversationId);
      if (!authority.ok) {
        return authority;
      }
      return callJson<TaskAccepted>(
        { operation: 'submitWork', body: request.data satisfies WorkSubmitRequest },
        TaskAcceptedSchema,
      );
    },

    task: async (taskId) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      return taskWithAuthority(taskId);
    },

    artifacts: async (taskId) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      const task = await taskWithAuthority(taskId);
      if (!task.ok) {
        return task;
      }
      // Read-only projection of the authoritative task result. The contract has
      // no artifact transfer operation, so the gateway must not invent one.
      return ok(
        ArtifactListSchema.parse({
          taskId: task.value.taskId,
          conversationId: task.value.conversationId,
          state: task.value.state,
          artifacts: task.value.result?.artifacts ?? [],
        }),
      );
    },

    cancel: async (taskId, body) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      if (!negotiated.value.capabilities.cancel) {
        return fail(
          gatewayError('capability_unavailable', {
            detail: 'the WorkflowEngine reports no engine with cancellation support',
            retryable: true,
          }),
        );
      }
      const task = await taskWithAuthority(taskId);
      if (!task.ok) {
        return task;
      }
      const request = CancelRequest.safeParse(body ?? {});
      if (!request.success) {
        return fail(gatewayError('validation_failed', { detail: 'cancel request is invalid' }));
      }
      return callJson<TaskControlResult>(
        { operation: 'cancelTask', params: { taskId: task.value.taskId }, body: request.data },
        TaskControlResultSchema,
      );
    },

    resume: async (taskId, body) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      if (!negotiated.value.capabilities.resume) {
        return fail(
          gatewayError('capability_unavailable', {
            detail: 'the WorkflowEngine reports no engine with resume support',
            retryable: true,
          }),
        );
      }
      const task = await taskWithAuthority(taskId);
      if (!task.ok) {
        return task;
      }
      const request = ResumeRequest.safeParse(body);
      if (!request.success) {
        return fail(gatewayError('validation_failed', { detail: 'resume request is invalid' }));
      }
      return callJson<TaskControlResult>(
        { operation: 'resumeTask', params: { taskId: task.value.taskId }, body: request.data },
        TaskControlResultSchema,
      );
    },

    retry: async (taskId, body) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      if (!negotiated.value.capabilities.retry) {
        return fail(
          gatewayError('capability_unavailable', {
            detail: 'the WorkflowEngine reports no durable engine, so retry cannot be honored',
            retryable: true,
          }),
        );
      }
      const task = await taskWithAuthority(taskId);
      if (!task.ok) {
        return task;
      }
      const request = RetryRequest.safeParse(body);
      if (!request.success) {
        return fail(gatewayError('validation_failed', { detail: 'retry request is invalid' }));
      }
      return callJson<TaskControlResult>(
        { operation: 'retryTask', params: { taskId: task.value.taskId }, body: request.data },
        TaskControlResultSchema,
      );
    },

    events: async (taskId, after, streamOptions) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      if (!negotiated.value.capabilities.events) {
        return fail(
          gatewayError('capability_unavailable', {
            detail: 'the WorkflowEngine does not offer durable event replay',
            retryable: true,
          }),
        );
      }
      const task = await taskWithAuthority(taskId);
      if (!task.ok) {
        return task;
      }
      if (!Number.isInteger(after) || after < 0) {
        return fail(
          gatewayError('validation_failed', { detail: 'after must be a non-negative integer' }),
        );
      }

      const route = ENGINE_ROUTES.streamTaskEvents;
      const response = await client.call({
        operation: 'streamTaskEvents',
        path: enginePath('streamTaskEvents', { taskId: task.value.taskId }),
        method: route.method,
        query: { after },
        stream: streamable('streamTaskEvents'),
        ...(streamOptions?.signal ? { signal: streamOptions.signal } : {}),
      });
      if (!response.ok) {
        return response;
      }
      if (response.value.kind !== 'stream') {
        return fail(
          gatewayError('contract_mismatch', {
            detail: 'the engine answered the event operation without a stream',
          }),
        );
      }

      const engineTaskId = task.value.taskId;
      const frames = response.value.frames;

      const events = (async function* (): AsyncGenerator<ExecutionEvent> {
        const seen = new Set<string>();
        let lastSeq = after;
        for await (const frame of frames) {
          let parsedFrame: unknown;
          try {
            parsedFrame = JSON.parse(frame);
          } catch {
            throw gatewayError('contract_mismatch', {
              detail: 'the engine produced an event frame that was not JSON',
            });
          }
          const parsed = ExecutionEventSchema.safeParse(parsedFrame);
          if (!parsed.success) {
            throw gatewayError('contract_mismatch', {
              detail: 'the engine produced an event that did not match the published schema',
            });
          }
          const event = parsed.data;
          // A stream is per task. An event for another task is a contract
          // violation, not something the gateway filters and passes on.
          if (event.taskId !== engineTaskId) {
            throw gatewayError('contract_mismatch', {
              detail: 'the engine produced an event for a different task',
            });
          }
          if (seen.has(event.eventId) || event.seq <= lastSeq) {
            continue;
          }
          seen.add(event.eventId);
          lastSeq = event.seq;
          yield event;
          if (isTerminalEvent(event.type)) {
            return;
          }
        }
      })();

      return ok({
        taskId: task.value.taskId,
        conversationId: task.value.conversationId,
        events,
      });
    },

    conversations: async () => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      const list = await callJson({ operation: 'listConversations' }, ConversationListSchema);
      if (!list.ok) {
        return list;
      }
      return ok({
        conversations: list.value.conversations.filter(
          (conversation) =>
            transport.authorityForConversation(conversation.conversationId) === 'engine',
        ),
      });
    },

    conversation: async (conversationId) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      const parsed = z.string().trim().min(1).max(128).safeParse(conversationId);
      if (!parsed.success) {
        return fail(gatewayError('validation_failed', { detail: 'conversationId is invalid' }));
      }
      const authority = await assertAuthority(parsed.data);
      if (!authority.ok) {
        return authority;
      }
      return callJson<Conversation>(
        { operation: 'getConversation', params: { conversationId: parsed.data } },
        ConversationSchema,
      );
    },

    memory: async (mode) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      const dataPlane = requireEngineDataPlane();
      if (!dataPlane.ok) {
        return dataPlane;
      }
      return callJson<MemoryList>({ operation: 'listMemory', query: { mode } }, MemoryListSchema);
    },

    permissions: async (taskId) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      const task = await taskWithAuthority(taskId);
      if (!task.ok) {
        return task;
      }
      return callJson<PermissionList>(
        { operation: 'listPermissions', params: { taskId: task.value.taskId } },
        PermissionListSchema,
      );
    },

    decidePermission: async (taskId, body) => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      const task = await taskWithAuthority(taskId);
      if (!task.ok) {
        return task;
      }
      const request = PermissionDecisionRequestSchema.safeParse(body);
      if (!request.success) {
        return fail(
          gatewayError('validation_failed', { detail: 'permission decision is invalid' }),
        );
      }
      const decision: PermissionDecisionRequest = request.data;
      const updated = await callJson<PermissionList>(
        {
          operation: 'decidePermission',
          params: { taskId: task.value.taskId },
          body: decision,
        },
        PermissionListSchema,
      );
      if (!updated.ok) {
        return updated;
      }
      const decided = updated.value.requests.some(
        (entry) => entry.requestId === decision.requestId && entry.decision === decision.decision,
      );
      if (!decided) {
        return fail(
          gatewayError('contract_mismatch', {
            detail: 'the engine did not record the permission decision it accepted',
          }),
        );
      }
      return updated;
    },

    notifications: async () => {
      const negotiated = await snapshot();
      if (!negotiated.ok) {
        return negotiated;
      }
      const list = await callJson({ operation: 'listNotifications' }, NotificationListSchema);
      if (!list.ok) {
        return list;
      }
      const notifications = list.value.notifications.filter(
        (notification) =>
          transport.authorityForConversation(notification.conversationId) === 'engine',
      );
      return ok({
        notifications,
        unread: notifications.filter((notification) => !notification.read).length,
      });
    },

    scheduling: () =>
      fail(
        gatewayError('capability_unavailable', {
          detail:
            'the WorkflowEngine contract publishes no scheduling operation; scheduling remains on the in-repository scheduler',
          retryable: false,
        }),
      ),
  };
}
