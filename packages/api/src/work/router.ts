import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import type { WorkModelSource } from './models';
import type { WorkConversation } from './task';
import { isTerminalWorkState, isWorkConversation, toWorkHistory, toWorkTask } from './task';
import { buildWorkModelOptions } from './models';

/**
 * Work reads Coderax conversations and models; it never starts a run.
 *
 * Task start and follow-up belong to the existing agent chat path, which owns
 * the generation job, the model call, tool permissions, action approvals and
 * the SSE stream. A Work route that accepted a task and returned `accepted`
 * could not stream a reply and would be a second runner, so it does not exist.
 */
export type WorkDeps = {
  listModels: () => Promise<WorkModelSource[]>;
  /**
   * The deployment's configured default model, used only to resolve the
   * automatic choice. It is never trusted blindly: the resolved model must
   * also be among the offered free/local models.
   */
  configuredDefaultModel?: () => Promise<string | null>;
  listConversations: (input: { userId: string; limit: number }) => Promise<WorkConversation[]>;
  getConversation: (input: {
    userId: string;
    conversationId: string;
  }) => Promise<WorkConversation | null>;
  /** Current native job state, when the in-process generation registry knows it. */
  getRunState?: (input: { userId: string; conversationId: string }) => Promise<string | null>;
  /** Aborts the native generation for this conversation. */
  cancelRun: (input: { userId: string; conversationId: string }) => Promise<boolean>;
};

const HISTORY_LIMIT = 50;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

async function withResolvedRunState(
  conversation: WorkConversation,
  userId: string,
  getRunState?: WorkDeps['getRunState'],
): Promise<WorkConversation> {
  if (!getRunState) {
    return conversation.workState === 'running'
      ? { ...conversation, workState: 'unknown' }
      : conversation;
  }
  try {
    const liveState = await getRunState({ userId, conversationId: conversation.conversationId });
    if (typeof liveState === 'string' && liveState.length > 0) {
      return { ...conversation, workState: liveState };
    }
  } catch {
    // The persisted conversation still proves history exists; unknown is safer
    // than carrying an old running marker through a lost registry lookup.
  }
  return conversation.workState === 'running'
    ? { ...conversation, workState: 'unknown' }
    : conversation;
}

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
      const models = buildWorkModelOptions(await deps.listModels());
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
      const withState = await Promise.all(
        conversations.map((conversation) =>
          withResolvedRunState(conversation, userId, deps.getRunState),
        ),
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json({ tasks: toWorkHistory(withState, HISTORY_LIMIT) });
    } catch {
      res.status(503).json({ code: 'WORK_HISTORY_UNAVAILABLE' });
    }
  });

  router.get('/tasks/:conversationId', async (req: Request, res: Response) => {
    const userId = userIdOf(req) as string;
    const { conversationId } = req.params;
    if (!ID_PATTERN.test(conversationId)) {
      res.status(400).json({ code: 'WORK_INVALID_ID' });
      return;
    }
    let conversation: WorkConversation | null;
    try {
      conversation = await deps.getConversation({ userId, conversationId });
    } catch {
      res.status(503).json({ code: 'WORK_TASK_UNAVAILABLE' });
      return;
    }
    if (!conversation || !isWorkConversation(conversation)) {
      res.status(404).json({ code: 'WORK_TASK_NOT_FOUND' });
      return;
    }
    const resolved = await withResolvedRunState(conversation, userId, deps.getRunState);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ task: toWorkTask(resolved) });
  });

  router.post('/tasks/:conversationId/cancel', async (req: Request, res: Response) => {
    const userId = userIdOf(req) as string;
    const { conversationId } = req.params;
    if (!ID_PATTERN.test(conversationId)) {
      res.status(400).json({ code: 'WORK_INVALID_ID' });
      return;
    }
    let conversation: WorkConversation | null;
    try {
      conversation = await deps.getConversation({ userId, conversationId });
    } catch {
      res.status(503).json({ code: 'WORK_TASK_UNAVAILABLE' });
      return;
    }
    if (!conversation || !isWorkConversation(conversation)) {
      res.status(404).json({ code: 'WORK_TASK_NOT_FOUND' });
      return;
    }
    const resolved = await withResolvedRunState(conversation, userId, deps.getRunState);
    const state = toWorkTask(resolved)?.state;
    if (state && isTerminalWorkState(state)) {
      res.status(409).json({ code: 'WORK_TASK_ALREADY_FINISHED' });
      return;
    }
    let canceled: boolean;
    try {
      canceled = await deps.cancelRun({ userId, conversationId });
    } catch {
      res.status(503).json({ code: 'WORK_CANCEL_FAILED' });
      return;
    }
    if (!canceled) {
      res.status(409).json({ code: 'WORK_NOTHING_TO_CANCEL' });
      return;
    }
    res.status(202).json({ canceled: true });
  });

  return router;
}
