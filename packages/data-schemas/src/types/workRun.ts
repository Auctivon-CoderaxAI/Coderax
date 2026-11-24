import type { Types } from 'mongoose';

/**
 * Durable execution lease for one Work engine run.
 *
 * The record is keyed by tenant, owner and conversation rather than by _id so a
 * restarting or second API replica can address the same run without reading the
 * conversation document first. It carries no conversation payload: message and
 * conversation rows stay the record of what ran.
 */
export interface IWorkRun {
  /** `${tenantId}:${user}:${conversationId}`; the unique identity of one Work task. */
  key: string;
  user: string;
  conversationId: string;
  /** Fenced owner token; only the holder may renew, release or be cancelled. */
  token: string;
  /** Runtime instance that started the run, for diagnostics and takeover. */
  owner: string;
  /** Set when a cancel request arrives, so an owner on another replica sees it. */
  cancelRequested: boolean;
  /** A lease past this instant is no longer authoritative. */
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type WorkRunDocument = IWorkRun & { _id?: Types.ObjectId };
