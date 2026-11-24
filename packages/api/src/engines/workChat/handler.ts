import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type {
  EngineWorkChatConfig,
  EngineWorkChatRunner,
  EngineWorkChatStore,
  RunScope,
} from './types';
import type { EngineId, EngineResult, EngineRunHandle, EngineRunSummary } from '../types';
import type { Json } from './json';
import { isEngineWorkChatPath, isOwnerEngineWorkChat } from './gating';
import { isValidWorkTask, workTitle } from '../../work/task';
import { isRecord, readString } from './json';
import { buildEnginePrompt } from './prompt';
import { engineFailure } from '../types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function writeEvent(res: Response, event: object): void {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
}

function failureMessage(code: string): string {
  switch (code) {
    case 'disabled':
      return 'The selected execution engine is disabled for Work.';
    case 'sdk_unavailable':
      return 'The selected execution engine SDK is unavailable on this server.';
    case 'not_configured':
      return 'The selected execution engine is not fully configured for Work.';
    case 'server_unavailable':
      return 'The selected execution engine is unavailable.';
    case 'workspace_denied':
      return 'The configured workspace could not be used.';
    case 'busy':
      return 'Another Work task is already running.';
    case 'timeout':
      return 'The execution engine run timed out.';
    case 'cancelled':
      return 'The execution engine run was cancelled.';
    case 'protocol_error':
      return 'The execution engine event stream ended before the task finished.';
    default:
      return 'The execution engine run failed.';
  }
}

function engineLabel(engine: EngineId): string {
  return engine === 'freebuff' ? 'Freebuff' : 'OpenCode';
}

function selectedEngine(body: Json, config: EngineWorkChatConfig): 'opencode' | 'freebuff' | null {
  const requested = readString(body.model);
  if (requested == null) {
    return config.engines?.workChat?.engine ?? 'opencode';
  }
  return requested === 'opencode' || requested === 'freebuff' ? requested : null;
}

function isEngineEnabled(config: EngineWorkChatConfig, engine: EngineId): boolean {
  if (engine === 'opencode') {
    return config.engines?.opencode?.enabled === true;
  }
  if (engine === 'freebuff') {
    return config.engines?.freebuff?.enabled === true;
  }
  return false;
}

type HandlerOptions = {
  runtimeFor: (config: EngineWorkChatConfig | null | undefined) => EngineWorkChatRunner;
  storeFor: (req: Request, engine: 'opencode' | 'freebuff') => EngineWorkChatStore;
  /** Shared with the native runner so neither can start beside the other. */
  reserveRun?: (input: RunScope) => boolean;
  releaseRun?: (input: RunScope) => boolean;
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
    const engine = config ? selectedEngine(body, config) : null;
    if (!engine) {
      res.status(400).json({
        code: 'WORK_ENGINE_UNSUPPORTED',
        message: 'The selected Work execution engine is not supported.',
      });
      return;
    }
    if (!config || !isEngineEnabled(config, engine)) {
      res.status(503).json({
        code: 'WORK_ENGINE_DISABLED',
        message: 'The selected execution engine is not enabled for the deployment.',
      });
      return;
    }
    if (body.addedConvo != null) {
      res.status(400).json({
        code: 'WORK_ENGINE_ADDED_CONVERSATION_UNSUPPORTED',
        message: 'Work engines run one task at a time.',
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
        message: 'This turn cannot run through the selected execution engine.',
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
      store = options.storeFor(req, engine);
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
        message: 'The selected execution engine could not be constructed.',
      });
      return;
    }

    let closed = false;
    let finished = false;
    /** Separates a conversation-store outage from an engine failure. */
    let storeUnavailable = false;
    let activeHandle: EngineRunHandle | null = null;
    let reserved = false;
    const reservation = { userId, tenantId, conversationId };
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
      if (options.reserveRun) {
        if (!options.reserveRun(reservation)) {
          res.status(409).json({
            code: 'WORK_ENGINE_BUSY',
            message: 'Another Work run is already active for this task.',
          });
          return;
        }
        reserved = true;
      }
      if (await runtime.state({ userId, tenantId, conversationId })) {
        res.status(409).json({
          code: 'WORK_ENGINE_BUSY',
          message: 'Another engine run is already active for this task.',
        });
        return;
      }
      let existing: Awaited<ReturnType<EngineWorkChatStore['getConversation']>> = null;
      try {
        existing = isNewConversation ? null : await store.getConversation(conversationId);
      } catch (error) {
        storeUnavailable = true;
        throw error;
      }
      if (existing && (existing.tenantId ?? null) !== tenantId) {
        res.status(404).json({ code: 'WORK_TASK_NOT_FOUND' });
        return;
      }
      const promptText = body.text as string;
      const modeInstructions = readString(body.promptPrefix);
      const title =
        existing?.title && existing.title !== 'New Chat' ? existing.title : workTitle(promptText);
      let history: Array<{ text: string; isCreatedByUser: boolean }> = [];
      try {
        history = await store.loadTranscript(conversationId);
      } catch {
        // The current request is still enough to start; history is an enhancement.
      }
      const started = await runtime.start({
        userId,
        tenantId,
        conversationId,
        engine,
        prompt: buildEnginePrompt(history, promptText, modeInstructions),
      });
      if (!started.ok) {
        /** A rejected second request must never overwrite the active run's state. */
        if (started.error.code !== 'busy') {
          try {
            await store.saveConversation({ conversationId, workState: 'failed' });
          } catch (error) {
            storeUnavailable = true;
            throw error;
          }
        }
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
      try {
        await store.saveConversation({
          conversationId,
          title,
          workState: 'running',
          create: existing == null,
        });
      } catch (error) {
        storeUnavailable = true;
        throw error;
      }
      if (closed) {
        await started.value.cancel();
        await store.saveConversation({ conversationId, workState: 'cancelled' });
        finished = true;
        return;
      }

      /** A new conversation must own fresh message rows: the client can retry
       * the same optimistic id after a reload, and upserting it would move the
       * previous conversation's messages to the new one. */
      const userMessageId =
        !isNewConversation && UUID.test(String(body.messageId ?? ''))
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
        await store.saveConversation({ conversationId });
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
          if (event.type === 'text_delta' || event.type === 'text_replace') {
            const initial = text === '';
            text = event.type === 'text_delta' ? text + event.text : event.text;
            send({
              message: true,
              initial,
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
        result = engineFailure('provider_error', `The ${engineLabel(engine)} run failed.`);
      }
      const cancelled =
        streamError == null && !result.ok && result.error.code === 'cancelled' && !approvalRequired;
      const failed = streamError != null || (!result.ok && !cancelled);
      let error: string | undefined;
      if (approvalRequired) {
        error = 'The engine requested a tool permission that Work cannot approve yet.';
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
        });
      } catch {
        persisted = false;
        options.logger?.warn?.('[Work] Could not persist the engine response.');
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
          sender: engineLabel(engine),
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
      options.logger?.error?.(`[Work] The ${engineLabel(engine)} Work chat path failed.`);
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
            error: { message: `The ${engineLabel(engine)} run failed.` },
          });
          res.end();
        }
        return;
      }
      res.status(503).json({
        code: storeUnavailable ? 'WORK_ENGINE_STORE_UNAVAILABLE' : 'WORK_ENGINE_UNAVAILABLE',
        message: storeUnavailable
          ? 'Work could not reach its conversation store.'
          : `The ${engineLabel(engine)} engine could not start this task.`,
      });
    } finally {
      if (activeHandle) {
        await runtime.release?.({ ...reservation, handle: activeHandle });
      }
      if (reserved) {
        options.releaseRun?.(reservation);
      }
    }
  };
}
