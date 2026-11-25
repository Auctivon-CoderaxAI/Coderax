import { randomUUID } from 'node:crypto';
import { SystemRoles } from 'coderax-data-provider';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type {
  EngineWorkChatConfig,
  EngineWorkChatRunner,
  EngineWorkChatStore,
  RunScope,
} from './types';
import type { EngineId, EngineResult, EngineRunHandle, EngineRunSummary } from '../types';
import type { Json } from './json';
import { isValidWorkTask, workTitle } from '../../work/task';
import { readWorkAgentId } from '../../work/identities';
import { isEngineWorkChatPath } from './gating';
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
  return engine === 'freebuff' ? 'FreeBuff Agent' : 'OpenCode Agent';
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
    const requestedAgent = readWorkAgentId(body.workAgent ?? body.workAgentId);
    if (
      requestedAgent.kind === 'absent' ||
      (requestedAgent.kind === 'id' && requestedAgent.id === 'coderax')
    ) {
      next();
      return;
    }
    if (requestedAgent.kind === 'invalid') {
      res.status(400).json({
        code: 'WORK_AGENT_UNSUPPORTED',
        message: 'The selected Work agent identity is not supported.',
      });
      return;
    }
    const engine =
      requestedAgent.id === 'opencode' || requestedAgent.id === 'freebuff'
        ? requestedAgent.id
        : null;
    if (!engine) {
      next();
      return;
    }
    if (!config || config.engines?.workChat?.enabled !== true) {
      res.status(503).json({
        code: 'WORK_AGENT_DISABLED',
        message: 'External agents are not enabled for this deployment.',
      });
      return;
    }
    if (user?.role !== SystemRoles.ADMIN) {
      res.status(403).json({
        code: 'WORK_AGENT_OWNER_ONLY',
        message: 'External agents are available to the Coderax owner only.',
      });
      return;
    }
    if (
      body.agent_id != null ||
      body.agentId != null ||
      body.ephemeralAgent != null ||
      body.spec != null ||
      (Array.isArray(body.files) && body.files.length > 0)
    ) {
      res.status(400).json({
        code: 'WORK_AGENT_COMBINATION_UNSUPPORTED',
        message: 'External agents cannot run Coderax saved agents, specs or attachments.',
      });
      return;
    }
    if (config.engines?.workChat?.mode !== 'cloud') {
      res.status(503).json({
        code: 'WORK_AGENT_CLOUD_REQUIRED',
        message: 'External agents require cloud execution.',
      });
      return;
    }
    if (!isEngineEnabled(config, engine)) {
      res.status(503).json({
        code: 'WORK_ENGINE_DISABLED',
        message: 'The selected agent engine is not enabled for the deployment.',
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
    /** The lease generation this run writes messages and state under. */
    let generation: string | null = null;
    let reserved = false;
    const reservation = { userId, tenantId, conversationId };
    const startup = new AbortController();
    let closeCancelled = false;
    const cancelForClose = (): void => {
      closed = true;
      if (closeCancelled) {
        return;
      }
      closeCancelled = true;
      if (activeHandle) {
        void activeHandle
          .cancel()
          .catch(() => options.logger?.warn?.('[Work] Could not cancel a closed engine stream.'));
        return;
      }
      startup.abort();
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
      /**
       * Only a run that is still executing blocks. An interrupted run reports
       * `failed`, and a cancelled one is settling; the claim below is what fences
       * those, so treating them as busy would make a crashed task unretryable.
       */
      if ((await runtime.state({ userId, tenantId, conversationId })) === 'running') {
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
      if (closed) return;
      let recorded = false;
      const started = await runtime.start({
        signal: startup.signal,
        beforeDispatch: async () => {
          if (closed) throw new Error('Work request closed');
          try {
            await store.saveConversation({
              conversationId,
              title,
              workAgent: engine,
              workState: 'running',
              create: existing == null,
            });
            recorded = true;
            if (closed) {
              await store.saveConversation({ conversationId, workState: 'cancelled' });
            }
          } catch (error) {
            storeUnavailable = true;
            throw error;
          }
          if (closed) throw new Error('Work request closed');
        },
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
            await store.saveConversation({
              conversationId,
              /** A start refused because the owner cancelled is a cancelled
               *  run, not a failure of the task. */
              workState: started.error.code === 'cancelled' ? 'cancelled' : 'failed',
              ...(!recorded && existing == null ? { title, create: true } : {}),
            });
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
      /**
       * The lease token fences this run's conversation writes: a retry stamps
       * its own generation, so a late outcome from this run matches nothing
       * instead of replacing the retry's state.
       */
      if (runtime.generation) {
        try {
          generation = await runtime.generation({ ...reservation, handle: activeHandle });
        } catch {
          generation = null;
        }
      }
      const runGeneration = generation;
      /** A terminal write applies only while this run still owns the row; it also detaches
       *  the generation, so a later reading of a dead lease cannot reopen the outcome. */
      const settle = (workState: 'completed' | 'failed' | 'cancelled') =>
        runGeneration == null
          ? { conversationId, workState }
          : { conversationId, workState, workRunId: null, fenceWorkRun: runGeneration };
      if (runGeneration != null) {
        /** The running row was created before dispatch, so this only binds it to the
         *  run's generation; writing `create` again could add a second conversation. */
        try {
          await store.saveConversation({
            conversationId,
            workState: 'running',
            workRunId: runGeneration,
          });
        } catch (error) {
          storeUnavailable = true;
          throw error;
        }
      }
      if (closed) {
        await started.value.cancel();
        await store.saveConversation(settle('cancelled'));
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
        await store.saveConversation(settle('failed'));
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
        await store.saveConversation(settle('cancelled'));
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
      /** The turn streams as content parts so the client renders the reply text
       *  and every tool call in one message: the text keeps index 0 and each
       *  call owns an index, which lets its settled result replace the call in
       *  place. Parts are also carried by the final frame, because the client
       *  substitutes that message for the streamed one. */
      const parts: Array<Record<string, unknown> | undefined> = [];
      const partIndexes = new Map<string, number>();
      const calls = new Map<string, Record<string, unknown>>();
      const sendPart = (index: number, part: Record<string, unknown>): void => {
        parts[index] = part;
        send({
          ...part,
          index,
          messageId: responseMessageId,
          conversationId,
          stream: true,
        });
      };
      const toolIndex = (callId: string): number => {
        const known = partIndexes.get(callId);
        if (known !== undefined) {
          return known;
        }
        const index = partIndexes.size + 1;
        partIndexes.set(callId, index);
        return index;
      };
      let approvalRequired = false;
      let streamError: string | undefined;
      try {
        for await (const event of started.value.events) {
          if (event.type === 'text_delta' || event.type === 'text_replace') {
            text = event.type === 'text_delta' ? text + event.text : event.text;
            sendPart(0, { type: 'text', text });
          } else if (event.type === 'tool_call') {
            const call = {
              id: event.callId,
              name: event.tool,
              type: 'tool_call',
              progress: 0.1,
              args: event.input ?? '',
            };
            calls.set(event.callId, call);
            sendPart(toolIndex(event.callId), { type: 'tool_call', tool_call: call });
          } else if (event.type === 'tool_result') {
            const index = partIndexes.get(event.callId);
            const call = calls.get(event.callId);
            if (index !== undefined && call !== undefined) {
              const settled = {
                ...call,
                progress: 1,
                runStepStatus: event.ok ? 'completed' : 'failed',
                ...(event.output ? { output: event.output } : {}),
              };
              calls.set(event.callId, settled);
              sendPart(index, { type: 'tool_call', tool_call: settled });
            }
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

      const content = parts.filter((part) => part !== undefined);
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
          ...(content.length > 0 ? { content } : {}),
          isCreatedByUser: false,
          unfinished: cancelled || failed || approvalRequired,
          ...(error ? { error } : {}),
        });
        await store.saveConversation(settle(terminalState));
      } catch {
        persisted = false;
        options.logger?.warn?.('[Work] Could not persist the engine response.');
        try {
          await store.saveConversation(settle('failed'));
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
          ...(content.length > 0 ? { content } : {}),
          sender: engineLabel(engine),
          isCreatedByUser: false,
          unfinished: cancelled || failed || approvalRequired || !persisted,
          ...(error || !persisted
            ? { error: error ?? 'The engine reply could not be saved.' }
            : {}),
        },
        conversation: { conversationId, title, workAgent: engine },
        title,
        /** What the engine actually ran, so a turn's tool activity is observable. */
        ...(result.ok ? { toolCalls: result.value.toolCalls, edits: result.value.edits } : {}),
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
