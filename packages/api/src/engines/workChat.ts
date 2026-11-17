import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { SystemRoles } from 'coderax-data-provider';
import type { EngineRegistryApi, EngineStatusSnapshot } from './registry';
import type { EngineResult, EngineRunHandle, EngineRunSummary } from './types';
import type { ExecutionEnginesConfig } from './service';
import { engineFailure } from './types';
import { createExecutionEngines } from './service';
import { isValidWorkTask, workTitle } from '../work/task';

/**
 * Owner-gated OpenCode execution inside the Work chat ingress.
 *
 * This is deliberately not a general engine picker: the deployment enables it
 * with `engines.workChat.enabled`, and only an ADMIN may reach it. Everyone
 * else, and every request with a selected agent or attachments, continues to
 * the native runner. The branch reuses the existing Work conversation, message
 * rows and cancel route; it never creates a second task lifecycle.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 24_000;
const MAX_HISTORY_MESSAGE_CHARS = 4_000;
const OPEN_CODE_MODEL = 'opencode';
const OPEN_CODE_ENDPOINT = 'opencode';

function writeEvent(res: Response, event: object): void {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
}

type Json = Record<string, unknown>;

export type EngineWorkChatConfig = {
  engines?: {
    workChat?: {
      enabled?: boolean;
      engine?: 'opencode';
    } | null;
    workspaces?: {
      privateRoot?: string;
    } | null;
    opencode?: {
      enabled?: boolean;
    } | null;
  } | null;
  interfaceConfig?: unknown;
};

export type EngineWorkChatStore = {
  getConversation: (conversationId: string) => Promise<{
    conversationId: string;
    title?: string;
    tenantId?: string | null;
    isWork?: boolean;
  } | null>;
  saveConversation: (input: {
    conversationId: string;
    title?: string;
    workState?: 'running' | 'completed' | 'failed' | 'cancelled';
    create?: boolean;
    appendMessageIds?: string[];
  }) => Promise<void>;
  saveMessage: (input: {
    messageId: string;
    parentMessageId: string;
    conversationId: string;
    text: string;
    isCreatedByUser: boolean;
    unfinished?: boolean;
    error?: boolean | string;
  }) => Promise<void>;
  loadTranscript: (
    conversationId: string,
  ) => Promise<Array<{ text: string; isCreatedByUser: boolean }>>;
};

type EngineWorkChatDb = {
  getConvo: (userId: string, conversationId: string) => Promise<unknown>;
  saveConvo: (context: Json, fields: Json, options: Json) => Promise<unknown>;
  saveMessage: (context: Json, params: Json, options: Json) => Promise<unknown>;
  getMessages: (filter: Json, select: string, options: Json) => Promise<unknown[]>;
};

function isRecord(value: unknown): value is Json {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** The deployment flag is the only switch; the role check is always applied. */
export function isOwnerEngineWorkChat(input: {
  config?: EngineWorkChatConfig | null;
  user?: { role?: unknown } | null;
  body?: Json | null;
}): boolean {
  if (input.config?.engines?.workChat?.enabled !== true) {
    return false;
  }
  if (input.user?.role !== SystemRoles.ADMIN) {
    return false;
  }
  const body = input.body ?? {};
  return (
    body.agent_id == null &&
    body.agentId == null &&
    body.ephemeralAgent == null &&
    body.spec == null
  );
}

export function isEngineWorkChatPath(path: string): boolean {
  return path === '/chat' || path === '/chat/' || path === '/chat/agents';
}

/** Bounded context so a long task cannot turn every follow-up into a giant prompt. */
export function buildEnginePrompt(
  history: ReadonlyArray<{ text: string; isCreatedByUser: boolean }>,
  request: string,
): string {
  const lines: string[] = [];
  let used = 0;
  for (const message of history.slice(-MAX_HISTORY_MESSAGES)) {
    const text = message.text.trim().slice(0, MAX_HISTORY_MESSAGE_CHARS);
    if (!text) {
      continue;
    }
    const line = `${message.isCreatedByUser ? 'User' : 'Assistant'}: ${text}`;
    if (used + line.length > MAX_HISTORY_CHARS) {
      break;
    }
    used += line.length;
    lines.push(line);
  }
  return lines.length > 0
    ? `Earlier in this Work conversation:\n${lines.join('\n')}\n\nCurrent request:\n${request}`
    : request;
}

export type EngineWorkChatRunner = {
  start: (input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
    prompt: string;
  }) => Promise<EngineResult<EngineRunHandle>>;
  state: (input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
  }) => string | null;
  cancel: (input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
  }) => Promise<boolean>;
  snapshot: () => EngineStatusSnapshot;
};

type ActiveRun = {
  userId: string;
  tenantId: string | null;
  cancel: () => Promise<void>;
};

export class EngineWorkChatRuntime implements EngineWorkChatRunner {
  private readonly runs = new Map<string, ActiveRun>();

  constructor(
    private readonly registry: EngineRegistryApi,
    private readonly privateRoot: string,
  ) {}

  snapshot(): EngineStatusSnapshot {
    return this.registry.snapshot();
  }

  state(input: { userId: string; tenantId: string | null; conversationId: string }): string | null {
    const run = this.runs.get(input.conversationId);
    return run && run.userId === input.userId && run.tenantId === input.tenantId ? 'running' : null;
  }

  async cancel(input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
  }): Promise<boolean> {
    const run = this.runs.get(input.conversationId);
    if (!run || run.userId !== input.userId || run.tenantId !== input.tenantId) {
      return false;
    }
    await run.cancel();
    return true;
  }

  async start(input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
    prompt: string;
  }): Promise<EngineResult<EngineRunHandle>> {
    if (this.runs.has(input.conversationId)) {
      return engineFailure('busy', 'Another engine run is already active for this task.');
    }
    const started = await this.registry.start({
      engine: 'opencode',
      request: {
        taskKey: input.conversationId,
        conversationId: input.conversationId,
        prompt: input.prompt,
        mode: 'private',
        workspaceRoot: this.privateRoot,
      },
    });
    if (!started.ok) {
      return started;
    }
    const run: ActiveRun = {
      userId: input.userId,
      tenantId: input.tenantId,
      cancel: started.value.cancel,
    };
    this.runs.set(input.conversationId, run);
    void started.value.result
      .finally(() => {
        if (this.runs.get(input.conversationId) === run) {
          this.runs.delete(input.conversationId);
        }
      })
      .catch(() => undefined);
    return started;
  }
}

const runtimes = new Map<string, EngineWorkChatRuntime>();

function runtimeKey(config: EngineWorkChatConfig | null | undefined): string {
  const engines = config?.engines;
  return JSON.stringify({
    privateRoot: engines?.workspaces?.privateRoot ?? '',
    opencode: engines?.opencode ?? null,
    openhands: (engines as { openhands?: unknown } | undefined)?.openhands ?? null,
    defaultEngine: (engines as { defaultEngine?: unknown } | undefined)?.defaultEngine ?? null,
  });
}

/** One registry (and therefore one lease table) per configured engine shape. */
export function getEngineWorkChatRuntime(
  config: EngineWorkChatConfig | null | undefined,
): EngineWorkChatRuntime {
  const key = runtimeKey(config);
  const existing = runtimes.get(key);
  if (existing) {
    return existing;
  }
  const privateRoot = config?.engines?.workspaces?.privateRoot ?? '';
  const runtime = new EngineWorkChatRuntime(
    createExecutionEngines(config as ExecutionEnginesConfig),
    privateRoot,
  );
  runtimes.set(key, runtime);
  return runtime;
}

/** Plain store adapter; the CJS route supplies the app database and request scope. */
export function createEngineWorkChatPersistence(input: {
  db: EngineWorkChatDb;
  userId: string;
  tenantId: string | null;
  isTemporary?: boolean;
  interfaceConfig?: unknown;
}): EngineWorkChatStore {
  const { db, userId, tenantId, isTemporary, interfaceConfig } = input;
  const context = { userId, isTemporary, interfaceConfig };

  async function saveConversation(fields: {
    conversationId: string;
    title?: string;
    workState?: 'running' | 'completed' | 'failed' | 'cancelled';
    create?: boolean;
    appendMessageIds?: string[];
  }): Promise<void> {
    const saved = await db.saveConvo(
      context,
      {
        conversationId: fields.conversationId,
        isWork: true,
        workModel: OPEN_CODE_MODEL,
        ...(fields.title ? { title: fields.title } : {}),
        ...(fields.workState ? { workState: fields.workState } : {}),
        ...(fields.create && tenantId != null ? { tenantId } : {}),
      },
      {
        context: 'Work OpenCode chat conversation',
        ...(fields.create ? {} : { noUpsert: true }),
        appendMessageIds: fields.appendMessageIds ?? [],
      },
    );
    if (!saved) {
      throw new Error('Work conversation could not be saved');
    }
  }

  return {
    getConversation: async (conversationId) => {
      const row = await db.getConvo(userId, conversationId);
      if (!isRecord(row)) {
        return null;
      }
      return {
        conversationId: readString(row.conversationId) ?? conversationId,
        ...(readString(row.title) ? { title: String(row.title) } : {}),
        ...(row.tenantId === null || typeof row.tenantId === 'string'
          ? { tenantId: row.tenantId as string | null }
          : {}),
        ...(row.isWork === true ? { isWork: true } : {}),
      };
    },
    saveConversation,
    saveMessage: async (message) => {
      const saved = await db.saveMessage(
        context,
        {
          messageId: message.messageId,
          parentMessageId: message.parentMessageId,
          conversationId: message.conversationId,
          text: message.text,
          sender: message.isCreatedByUser ? 'User' : 'OpenCode',
          isCreatedByUser: message.isCreatedByUser,
          model: OPEN_CODE_MODEL,
          endpoint: OPEN_CODE_ENDPOINT,
          ...(message.unfinished ? { unfinished: true } : {}),
          ...(message.error !== undefined ? { error: message.error } : {}),
        },
        {
          context: message.isCreatedByUser
            ? 'Work OpenCode user message'
            : 'Work OpenCode response',
        },
      );
      if (!saved) {
        throw new Error('Work message could not be saved');
      }
    },
    loadTranscript: async (conversationId) => {
      const rows = await db.getMessages(
        { user: userId, conversationId },
        'messageId text isCreatedByUser createdAt',
        { sort: { createdAt: -1 }, limit: 24 },
      );
      return rows
        .filter(isRecord)
        .map((row) => ({
          text: typeof row.text === 'string' ? row.text : '',
          isCreatedByUser: row.isCreatedByUser === true,
        }))
        .filter((row) => row.text.trim().length > 0)
        .reverse();
    },
  };
}

function failureMessage(code: string): string {
  switch (code) {
    case 'disabled':
      return 'OpenCode execution is disabled for Work.';
    case 'sdk_unavailable':
      return 'The OpenCode SDK is unavailable on this server.';
    case 'not_configured':
      return 'OpenCode is not fully configured for Work.';
    case 'server_unavailable':
      return 'The OpenCode server is unavailable.';
    case 'workspace_denied':
      return 'The configured private workspace could not be used.';
    case 'busy':
      return 'Another Work task is already running.';
    case 'timeout':
      return 'The OpenCode run timed out.';
    case 'cancelled':
      return 'The OpenCode run was cancelled.';
    case 'protocol_error':
      return 'The OpenCode event stream ended before the task finished.';
    default:
      return 'The OpenCode run failed.';
  }
}

type HandlerOptions = {
  runtimeFor: (config: EngineWorkChatConfig | null | undefined) => EngineWorkChatRunner;
  storeFor: (req: Request) => EngineWorkChatStore;
  logger?: { warn?: (message: string) => void; error?: (message: string) => void };
};

export function createEngineWorkChatHandler(options: HandlerOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'POST' || !isEngineWorkChatPath(req.path)) {
      next();
      return;
    }
    const config = (req as Request & { config?: { config?: EngineWorkChatConfig | null } }).config
      ?.config;
    const user = (
      req as Request & {
        user?: { id?: string; role?: unknown; tenantId?: string | null };
      }
    ).user;
    const body = (isRecord(req.body) ? req.body : {}) as Json;
    if (!isOwnerEngineWorkChat({ config, user, body })) {
      next();
      return;
    }
    if (config?.engines?.opencode?.enabled !== true) {
      res.status(503).json({
        code: 'WORK_ENGINE_DISABLED',
        message: 'OpenCode execution is not enabled for the deployment.',
      });
      return;
    }
    if (body.addedConvo != null) {
      res.status(400).json({
        code: 'WORK_ENGINE_ADDED_CONVERSATION_UNSUPPORTED',
        message: 'OpenCode Work runs one task at a time.',
      });
      return;
    }
    if (Array.isArray(body.files) && body.files.length > 0) {
      // Attachments stay on the native runner; the engine has no file UI yet.
      next();
      return;
    }
    if (body.isRegenerate === true || body.compact === true || body.isEdited === true) {
      res.status(400).json({
        code: 'WORK_ENGINE_TURN_UNSUPPORTED',
        message: 'This turn cannot run through the OpenCode engine.',
      });
      return;
    }
    if (!isValidWorkTask(body.text)) {
      res.status(400).json({
        code: 'WORK_ENGINE_TASK_REQUIRED',
        message: 'A task prompt is required.',
      });
      return;
    }
    const userId = user?.id;
    if (!userId) {
      res.status(401).json({ code: 'WORK_UNAUTHENTICATED' });
      return;
    }

    const requestedConversationId = readString(body.conversationId);
    const isNewConversation =
      !requestedConversationId ||
      requestedConversationId === 'new' ||
      requestedConversationId === 'pending';
    const conversationId = isNewConversation ? randomUUID() : requestedConversationId;
    if (!UUID.test(conversationId)) {
      res.status(400).json({
        code: 'WORK_ENGINE_CONVERSATION_INVALID',
        message: 'The Work conversation identifier is invalid.',
      });
      return;
    }

    let store: EngineWorkChatStore;
    try {
      store = options.storeFor(req);
    } catch {
      res.status(503).json({
        code: 'WORK_ENGINE_STORE_UNAVAILABLE',
        message: 'Work could not open its conversation store.',
      });
      return;
    }
    const tenantId = user?.tenantId ?? null;
    let runtime: EngineWorkChatRunner;
    try {
      runtime = options.runtimeFor(config);
    } catch {
      res.status(503).json({
        code: 'WORK_ENGINE_UNAVAILABLE',
        message: 'The OpenCode engine could not be constructed.',
      });
      return;
    }

    let closed = false;
    let finished = false;
    let activeHandle: EngineRunHandle | null = null;
    let closeCancelled = false;
    const cancelForClose = (): void => {
      closed = true;
      if (!activeHandle || closeCancelled) {
        return;
      }
      closeCancelled = true;
      void activeHandle
        .cancel()
        .catch(() => options.logger?.warn?.('[Work] Could not cancel a closed engine stream.'));
    };
    res.on('close', () => {
      if (!finished) {
        cancelForClose();
      }
    });
    if (res.destroyed) {
      cancelForClose();
    }

    try {
      if (runtime.state({ userId, tenantId, conversationId })) {
        res.status(409).json({
          code: 'WORK_ENGINE_BUSY',
          message: 'Another engine run is already active for this task.',
        });
        return;
      }
      const existing = isNewConversation ? null : await store.getConversation(conversationId);
      if (existing && (existing.tenantId ?? null) !== tenantId) {
        res.status(404).json({ code: 'WORK_TASK_NOT_FOUND' });
        return;
      }
      const promptText = body.text as string;
      const title =
        existing?.title && existing.title !== 'New Chat' ? existing.title : workTitle(promptText);
      let history: Array<{ text: string; isCreatedByUser: boolean }> = [];
      try {
        history = await store.loadTranscript(conversationId);
      } catch {
        // The current request is still enough to start; history is an enhancement.
      }
      await store.saveConversation({
        conversationId,
        title,
        workState: 'running',
        create: existing == null,
      });
      if (closed) {
        await store.saveConversation({ conversationId, workState: 'cancelled' });
        finished = true;
        return;
      }

      const started = await runtime.start({
        userId,
        tenantId,
        conversationId,
        prompt: buildEnginePrompt(history, promptText),
      });
      if (!started.ok) {
        await store.saveConversation({ conversationId, workState: 'failed' });
        if (closed) {
          finished = true;
          return;
        }
        res.status(started.error.code === 'busy' ? 409 : 503).json({
          code: 'WORK_ENGINE_START_FAILED',
          error: started.error.code,
          message: failureMessage(started.error.code),
        });
        return;
      }
      activeHandle = started.value;
      if (closed) {
        await started.value.cancel();
        await store.saveConversation({ conversationId, workState: 'cancelled' });
        finished = true;
        return;
      }

      const userMessageId = UUID.test(String(body.messageId ?? ''))
        ? String(body.messageId)
        : randomUUID();
      const responseMessageId = `${userMessageId}_`;
      const parentMessageId = readString(body.parentMessageId) ?? '0';
      try {
        await store.saveMessage({
          messageId: userMessageId,
          parentMessageId,
          conversationId,
          text: promptText,
          isCreatedByUser: true,
        });
        await store.saveConversation({
          conversationId,
          appendMessageIds: [userMessageId],
        });
      } catch {
        await started.value.cancel();
        await store.saveConversation({ conversationId, workState: 'failed' });
        if (closed) {
          finished = true;
          return;
        }
        res.status(503).json({
          code: 'WORK_ENGINE_STORE_UNAVAILABLE',
          message: 'Work could not persist this task.',
        });
        return;
      }
      if (closed) {
        await started.value.cancel();
        await store.saveConversation({ conversationId, workState: 'cancelled' });
        finished = true;
        return;
      }

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      const send = (event: object): void => {
        if (!res.writableEnded) {
          writeEvent(res, event);
        }
      };
      send({
        created: true,
        streamId: conversationId,
        message: {
          messageId: userMessageId,
          parentMessageId,
          conversationId,
          text: promptText,
          sender: 'User',
          isCreatedByUser: true,
        },
      });

      let text = '';
      let approvalRequired = false;
      let streamError: string | undefined;
      try {
        for await (const event of started.value.events) {
          if (event.type === 'text_delta') {
            text += event.text;
            send({
              message: true,
              initial: text === event.text,
              text,
              messageId: responseMessageId,
              parentMessageId: userMessageId,
              conversationId,
            });
          } else if (event.type === 'approval_required') {
            approvalRequired = true;
            await started.value.cancel();
            break;
          }
        }
      } catch {
        streamError = 'The engine event stream failed.';
        try {
          await started.value.cancel();
        } catch {
          // The run is already settling locally.
        }
      }

      let result: EngineResult<EngineRunSummary>;
      try {
        result = await started.value.result;
      } catch {
        result = engineFailure('provider_error', 'The OpenCode run failed.');
      }
      const cancelled =
        streamError == null && !result.ok && result.error.code === 'cancelled' && !approvalRequired;
      const failed = streamError != null || (!result.ok && !cancelled);
      let error: string | undefined;
      if (approvalRequired) {
        error = 'OpenCode requested a tool permission that Work cannot approve yet.';
      } else if (streamError) {
        error = streamError;
      } else if (failed && !result.ok) {
        error = failureMessage(result.error.code);
      }
      let terminalState: 'cancelled' | 'failed' | 'completed' = 'completed';
      if (cancelled) {
        terminalState = 'cancelled';
      } else if (failed || approvalRequired) {
        terminalState = 'failed';
      }
      let persisted = true;
      try {
        await store.saveMessage({
          messageId: responseMessageId,
          parentMessageId: userMessageId,
          conversationId,
          text,
          isCreatedByUser: false,
          unfinished: cancelled || failed || approvalRequired,
          ...(error ? { error } : {}),
        });
        await store.saveConversation({
          conversationId,
          workState: terminalState,
          appendMessageIds: [responseMessageId],
        });
      } catch {
        persisted = false;
        options.logger?.warn?.('[Work] Could not persist the OpenCode response.');
        try {
          await store.saveConversation({ conversationId, workState: 'failed' });
        } catch {
          // The stream still has to close even when storage is unavailable.
        }
      }
      finished = true;
      let terminalStatus: 'aborted' | 'error' | 'complete' = 'complete';
      if (cancelled) {
        terminalStatus = 'aborted';
      } else if (failed || approvalRequired || !persisted) {
        terminalStatus = 'error';
      }
      send({
        final: true,
        terminalStatus,
        requestMessage: {
          messageId: userMessageId,
          parentMessageId,
          conversationId,
          text: promptText,
          sender: 'User',
          isCreatedByUser: true,
        },
        responseMessage: {
          messageId: responseMessageId,
          parentMessageId: userMessageId,
          conversationId,
          text,
          sender: 'OpenCode',
          isCreatedByUser: false,
          unfinished: cancelled || failed || approvalRequired || !persisted,
          ...(error || !persisted
            ? { error: error ?? 'The engine reply could not be saved.' }
            : {}),
        },
        conversation: { conversationId, title },
        title,
        ...(cancelled ? { aborted: true } : {}),
        ...(error || !persisted
          ? { error: { message: error ?? 'The engine reply could not be saved.' } }
          : {}),
      });
      res.end();
    } catch {
      options.logger?.error?.('[Work] The OpenCode Work chat path failed.');
      if (activeHandle && !finished) {
        try {
          await activeHandle.cancel();
        } catch {
          // The run is already settling locally.
        }
      }
      if (closed) {
        finished = true;
        return;
      }
      if (res.headersSent) {
        if (!res.writableEnded) {
          writeEvent(res, {
            final: true,
            terminalStatus: 'error',
            error: { message: 'The OpenCode run failed.' },
          });
          res.end();
        }
        return;
      }
      res.status(503).json({
        code: 'WORK_ENGINE_UNAVAILABLE',
        message: 'The OpenCode engine could not start this task.',
      });
    }
  };
}
