import type { Types } from 'mongoose';

export type AuthorityMode = 'private' | 'cloud';
export type AuthorityEngine = 'native' | 'workflow-engine';
export type AuthorityState = 'active' | 'migrating';
export type AuthorityReceiptOutcome =
  | 'dispatched'
  | 'settled'
  | 'failed'
  | 'migration_started'
  | 'migration_completed';

export interface IConversationAuthorityReceipt {
  at: string;
  outcome: AuthorityReceiptOutcome;
  contractVersion: string;
  generation: number;
  taskId?: string;
}

export type AuthorityReceipt = IConversationAuthorityReceipt;

/**
 * Which backend owns one conversation, and the fencing generation every write
 * must name. It stores no transcript and no task state; the engine remains the
 * authority for execution.
 */
export interface IConversationAuthority {
  _id?: Types.ObjectId;
  ownerId: string;
  conversationId: string;
  mode: AuthorityMode;
  engine: AuthorityEngine;
  state: AuthorityState;
  generation: number;
  inFlight: number;
  contractVersion: string;
  receipts: IConversationAuthorityReceipt[];
  createdAt?: Date;
  updatedAt?: Date;
}
