import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import { buildWorkModels, resolveWorkModel } from './models';
import type { WorkModelSource } from './models';
import {
  WORK_METADATA_KEY,
  isTerminalWorkState,
  isValidWorkTask,
  isWorkConversation,
  toWorkHistory,
  toWorkTask,
  workTitle,
} from './task';
import type { WorkConversation } from './task';

/**
 * Every capability the Work routes need is supplied by the caller. The router
 * owns no storage and no model client, so conversations, runs and aborts stay
 * with the native Coderax implementations instead of a parallel engine.
 */
export type WorkDeps = {
  listModels: () => Promise<WorkModelSource[]>;
  listConversations: (input: { userId: string; limit: number }) => Promise<WorkConversation[]>;
  getConversation: (input: {
    userId: string;
    conversationId: string;
  }) => Promise<WorkConversation | null>;
  createConversation: (input: {
    userId: string;
    title: string;
    metadata: Record<string, unknown>;
  }) => Promise<WorkConversation>;
  appendTurn: (input: { userId: string; conversationId: string; message: string }) => Promise<void>;
  cancelRun: (input: { userId: string; conversationId: string }) => Promise<boolean>;
};

const HISTORY_LIMIT = 50;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

/**
 * Identity comes from the authenticated request only. A body or query `userId`
 * is never read, so one tenant cannot address another tenant's Work.
 */
function userIdOf(req: Request): string | null {
  const user = req.user as { id?: unknown } | undefined;
  return user && typeof user.id === 'string' && user.id ? user.id : null;
}

export function createWorkRouter(deps: WorkDeps): Router {
  const router = express.Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!userIdOf(req)) {
      res.status(401).json({ code: 'WORK_UNAUTHENTICATED' });
      return;
    }
    next();
  });

  router.get('/models', async (_req: Request, res: Response) => {
    try {
      const models = buildWorkModels(await deps.listModels());
      res.setHeader('Cache-Control', 'no-store');
      res.json({ models });
    } catch {
      res.status(503).json({ code: 'WORK_MODELS_UNAVAILABLE' });
    }
  });

  router.get('/tasks', async (req: Request, res: Response) => {
    const userId = userIdOf(req) as string;
    try {
      const conversations = await deps.listConversations({ userId, limit: HISTORY_LIMIT });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ tasks: toWorkHistory(conversations, HISTORY_LIMIT) });
    } catch {
      res.status(503).json({ code: 'WORK_HISTORY_UNAVAILABLE' });
    }
  });

  router.post('/tasks', async (req: Request, res: Response) => {
    const userId = userIdOf(req) as string;
    const body = (req.body ?? {}) as { task?: unknown; model?: unknown };
    if (!isValidWorkTask(body.task)) {
      res.status(400).json({ code: 'WORK_INVALID_TASK' });
      return;
    }
    const models = buildWorkModels(await deps.listModels().catch(() => []));
    const selected = resolveWorkModel(models, typeof body.model === 'string' ? body.model : null);
    if (body.model !== undefined && body.model !== null && body.model !== '' && !selected) {
      res.status(409).json({ code: 'WORK_MODEL_UNAVAILABLE' });
      return;
    }
    try {
      const conversation = await deps.createConversation({
        userId,
        title: workTitle(body.task),
        metadata: {
          [WORK_METADATA_KEY]: true,
          ...(selected ? { workModel: selected.id } : {}),
        },
      });
      const task = toWorkTask(conversation);
      res.status(201).json({ task });
    } catch {
      res.status(503).json({ code: 'WORK_START_FAILED' });
    }
  });

  router.get('/tasks/:conversationId', async (req: Request, res: Response) => {
    const userId = userIdOf(req) as string;
    const { conversationId } = req.params;
    if (!ID_PATTERN.test(conversationId)) {
      res.status(400).json({ code: 'WORK_INVALID_ID' });
      return;
    }
    const conversation = await deps.getConversation({ userId, conversationId }).catch(() => null);
    if (!conversation || !isWorkConversation(conversation)) {
      res.status(404).json({ code: 'WORK_TASK_NOT_FOUND' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ task: toWorkTask(conversation) });
  });

  router.post('/tasks/:conversationId/messages', async (req: Request, res: Response) => {
    const userId = userIdOf(req) as string;
    const { conversationId } = req.params;
    const message = (req.body ?? {}).message;
    if (!ID_PATTERN.test(conversationId) || !isValidWorkTask(message)) {
      res.status(400).json({ code: 'WORK_INVALID_MESSAGE' });
      return;
    }
    const conversation = await deps.getConversation({ userId, conversationId }).catch(() => null);
    if (!conversation || !isWorkConversation(conversation)) {
      res.status(404).json({ code: 'WORK_TASK_NOT_FOUND' });
      return;
    }
    try {
      await deps.appendTurn({ userId, conversationId, message: message.trim() });
      res.status(202).json({ accepted: true });
    } catch {
      res.status(503).json({ code: 'WORK_FOLLOW_UP_FAILED' });
    }
  });

  router.post('/tasks/:conversationId/cancel', async (req: Request, res: Response) => {
    const userId = userIdOf(req) as string;
    const { conversationId } = req.params;
    if (!ID_PATTERN.test(conversationId)) {
      res.status(400).json({ code: 'WORK_INVALID_ID' });
      return;
    }
    const conversation = await deps.getConversation({ userId, conversationId }).catch(() => null);
    if (!conversation || !isWorkConversation(conversation)) {
      res.status(404).json({ code: 'WORK_TASK_NOT_FOUND' });
      return;
    }
    const state = toWorkTask(conversation)?.state ?? 'running';
    if (isTerminalWorkState(state)) {
      res.status(409).json({ code: 'WORK_TASK_ALREADY_FINISHED' });
      return;
    }
    const canceled = await deps.cancelRun({ userId, conversationId }).catch(() => false);
    if (!canceled) {
      res.status(409).json({ code: 'WORK_NOTHING_TO_CANCEL' });
      return;
    }
    res.status(202).json({ canceled: true });
  });

  return router;
}
