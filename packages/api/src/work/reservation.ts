import type { NextFunction, Request, Response } from 'express';
import type { RunScope } from '../engines/workChat/types';

const owners = new Map<string, RunScope>();
const key = (scope: RunScope) =>
  JSON.stringify([scope.tenantId, scope.userId, scope.conversationId]);

// The settled-event payload identifies the conversation and owner. The listener's
// database write can outlive the controller's generation promise.
const terminalWrites = new Map<string, Set<Promise<unknown>>>();
const writeKey = (userId: string, conversationId: string) =>
  JSON.stringify([userId, conversationId]);

export function trackWorkTerminalWrite<T>(
  event: { userId: string; conversationId: string },
  write: Promise<T>,
): Promise<T> {
  const id = writeKey(event.userId, event.conversationId);
  const writes = terminalWrites.get(id) ?? new Set<Promise<unknown>>();
  terminalWrites.set(id, writes);
  writes.add(write);
  return write.finally(() => {
    writes.delete(write);
    if (!writes.size) terminalWrites.delete(id);
  });
}

export function reserveWorkRun(scope: RunScope): boolean {
  const id = key(scope);
  if (owners.has(id)) return false;
  owners.set(id, scope);
  return true;
}

export function releaseWorkRun(scope: RunScope): boolean {
  const id = key(scope);
  return owners.get(id) === scope && owners.delete(id);
}

export function workChatRunReservationMiddleware(
  req: Request & { claimWorkRun?: (resolvedId?: string) => () => void | Promise<void> },
  res: Response,
  next: NextFunction,
): Response | void {
  if (req.method !== 'POST' || !['/chat', '/chat/', '/chat/agents'].includes(req.path))
    return next();
  const conversationId =
    typeof req.body?.conversationId === 'string' ? req.body.conversationId.trim() : '';
  const user = req.user as { id?: string; tenantId?: string } | undefined;
  if (!user?.id) return next();
  const identity = { userId: user.id, tenantId: user.tenantId ?? null };
  let scope =
    conversationId && !['new', 'pending'].includes(conversationId)
      ? { ...identity, conversationId }
      : undefined;
  if (scope && !reserveWorkRun(scope))
    return res.status(409).json({
      code: 'WORK_RUN_BUSY',
      message: 'Another Work run is already active for this task.',
    });
  let claimed = false;
  const release = () => {
    if (scope) releaseWorkRun(scope);
  };
  const rejected = () => {
    if (!claimed) release();
  };
  // Transfer ownership before asynchronous job creation, while the response is still open.
  req.claimWorkRun = (resolvedId = conversationId) => {
    if (res.destroyed || res.writableEnded) throw new Error('Work request already closed');
    if (!scope) {
      scope = { ...identity, conversationId: resolvedId };
      if (!reserveWorkRun(scope)) throw new Error('Work conversation busy');
    }
    if (owners.get(key(scope)) !== scope) throw new Error('Work request closed before generation');
    claimed = true;
    const writes = writeKey(identity.userId, scope.conversationId);
    return () => {
      const pending = terminalWrites.get(writes);
      if (pending?.size) return Promise.allSettled([...pending]).then(release);
      release();
    };
  };
  res.once('finish', rejected);
  res.once('close', rejected);
  if (res.destroyed) {
    release();
    return;
  }
  return next();
}
