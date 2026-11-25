import type { NextFunction, Request, Response } from 'express';
import type { RunScope } from '../engines/workChat/types';

type WorkRunReservation = {
  scope?: RunScope;
  requestKey?: string;
  streamKey?: string;
  started: boolean;
  settled: boolean;
  released: boolean;
  releaseRequested: boolean;
  terminalWrites: Set<Promise<unknown>>;
  releasePromise?: Promise<void>;
  resolveRelease?: () => void;
};

export type WorkRunRelease = (() => void | Promise<void>) & { markStarted: () => void };

const owners = new Map<string, WorkRunReservation>();
const requests = new Map<string, WorkRunReservation>();
const streams = new Map<string, WorkRunReservation>();
const key = (scope: RunScope) =>
  JSON.stringify([scope.tenantId, scope.userId, scope.conversationId]);
const requestKey = (scope: Pick<RunScope, 'tenantId' | 'userId'>, requestId: string) =>
  JSON.stringify([scope.tenantId, scope.userId, requestId]);
const streamKey = (userId: string, streamId: string) => JSON.stringify([userId, streamId]);

function createReservation(scope?: RunScope, idempotencyKey?: string): WorkRunReservation {
  return {
    ...(scope ? { scope } : {}),
    ...(idempotencyKey ? { requestKey: idempotencyKey } : {}),
    started: false,
    settled: false,
    released: false,
    releaseRequested: false,
    terminalWrites: new Set(),
  };
}

function removeReservation(reservation: WorkRunReservation): boolean {
  let removed = false;
  if (reservation.scope && owners.get(key(reservation.scope)) === reservation) {
    owners.delete(key(reservation.scope));
    removed = true;
  }
  if (reservation.requestKey && requests.get(reservation.requestKey) === reservation) {
    requests.delete(reservation.requestKey);
    removed = true;
  }
  if (reservation.streamKey && streams.get(reservation.streamKey) === reservation) {
    streams.delete(reservation.streamKey);
    removed = true;
  }
  reservation.released = true;
  return removed;
}

function finishRequestedRelease(reservation: WorkRunReservation): void {
  if (
    !reservation.releaseRequested ||
    reservation.released ||
    (reservation.started && (!reservation.settled || reservation.terminalWrites.size > 0))
  ) {
    return;
  }
  removeReservation(reservation);
  reservation.resolveRelease?.();
}

function releaseAfterGeneration(reservation: WorkRunReservation): WorkRunRelease {
  const release = (() => {
    reservation.releaseRequested = true;
    if (!reservation.started) {
      removeReservation(reservation);
      return;
    }
    reservation.releasePromise ??= new Promise<void>((resolve) => {
      reservation.resolveRelease = resolve;
    });
    finishRequestedRelease(reservation);
    return reservation.releasePromise;
  }) as WorkRunRelease;
  release.markStarted = () => {
    if (reservation.released) return;
    reservation.started = true;
    finishRequestedRelease(reservation);
  };
  return release;
}

/** The settled-event payload identifies the owner and conversation. Its database
 * write can outlive the controller's generation promise, so a native lease waits
 * for both the event and the write before allowing another runner into the task. */
export function trackWorkTerminalWrite<T>(
  event: { userId: string; conversationId: string; streamId?: string },
  write: Promise<T>,
): Promise<T> {
  const id = streamKey(event.userId, event.streamId ?? event.conversationId);
  const reservation = streams.get(id);
  if (
    !reservation ||
    reservation.scope?.userId !== event.userId ||
    reservation.scope.conversationId !== event.conversationId
  ) {
    return write;
  }

  reservation.settled = true;
  const tracked = Promise.resolve(write).then(
    (value) => {
      reservation.terminalWrites.delete(tracked);
      finishRequestedRelease(reservation);
      return value;
    },
    (error: unknown) => {
      reservation.terminalWrites.delete(tracked);
      finishRequestedRelease(reservation);
      throw error;
    },
  );
  reservation.terminalWrites.add(tracked);
  finishRequestedRelease(reservation);
  return tracked;
}

export function reserveWorkRun(scope: RunScope): boolean {
  const id = key(scope);
  if (owners.has(id)) return false;
  owners.set(id, createReservation(scope));
  return true;
}

export function releaseWorkRun(scope: RunScope): boolean {
  const reservation = owners.get(key(scope));
  if (reservation?.scope !== scope) return false;
  return removeReservation(reservation);
}

export function workChatRunReservationMiddleware(
  req: Request & { claimWorkRun?: (resolvedId?: string) => WorkRunRelease },
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
  const rawRequestId = req.body?.clientRequestId;
  const requestId =
    typeof rawRequestId === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(rawRequestId)
      ? rawRequestId
      : undefined;
  const idempotencyKey = requestId ? requestKey(identity, requestId) : undefined;
  // A same-key retry must reach the controller's durable idempotency claim so it
  // can attach to the active stream. It never acquires or changes the owner lease.
  if (idempotencyKey && requests.has(idempotencyKey)) return next();

  const scope =
    conversationId && !['new', 'pending'].includes(conversationId)
      ? { ...identity, conversationId }
      : undefined;
  if (scope && owners.has(key(scope)))
    return res.status(409).json({
      code: 'WORK_RUN_BUSY',
      message: 'Another Work run is already active for this task.',
    });

  const reservation = createReservation(scope, idempotencyKey);
  if (scope) owners.set(key(scope), reservation);
  if (idempotencyKey) requests.set(idempotencyKey, reservation);
  let claimed = false;
  const release = () => {
    if (!claimed) removeReservation(reservation);
  };
  const rejected = () => {
    if (!claimed) release();
  };

  // Transfer ownership before asynchronous job creation, while the response is still open.
  req.claimWorkRun = (resolvedId = conversationId) => {
    if (res.destroyed || res.writableEnded) throw new Error('Work request already closed');
    if (!reservation.scope) {
      reservation.scope = { ...identity, conversationId: resolvedId };
      const id = key(reservation.scope);
      if (owners.has(id)) throw new Error('Work conversation busy');
      owners.set(id, reservation);
    }
    const id = key(reservation.scope);
    if (owners.get(id) !== reservation) throw new Error('Work request closed before generation');
    reservation.streamKey = streamKey(identity.userId, reservation.scope.conversationId);
    streams.set(reservation.streamKey, reservation);
    claimed = true;
    return releaseAfterGeneration(reservation);
  };
  res.once('finish', rejected);
  res.once('close', rejected);
  if (res.destroyed) {
    release();
    return;
  }
  return next();
}
