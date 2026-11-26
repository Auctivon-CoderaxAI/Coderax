import type { Model } from 'mongoose';
import type {
  AuthorityEngine,
  AuthorityMode,
  AuthorityReceipt,
  AuthorityState,
  IConversationAuthority,
} from '~/types/conversationAuthority';
import { createConversationAuthorityModel } from '~/models/conversationAuthority';

const DUPLICATE_KEY_ERROR = 11000;
/** Receipts retained per conversation; older ones are discarded on write. */
const MAX_RECEIPTS = 20;

/** Plain, storage-independent view returned to callers. */
export type ConversationAuthorityView = {
  ownerId: string;
  conversationId: string;
  mode: AuthorityMode;
  engine: AuthorityEngine;
  state: AuthorityState;
  generation: number;
  inFlight: number;
  contractVersion: string;
  receipts: AuthorityReceipt[];
  updatedAt: string;
};

export type AuthorityAdvanceInput = {
  ownerId: string;
  conversationId: string;
  expectedGeneration: number;
  set?: Partial<Pick<ConversationAuthorityView, 'engine' | 'state' | 'mode' | 'contractVersion'>>;
  generationDelta?: number;
  inFlightDelta?: number;
  receipt?: AuthorityReceipt;
  /** Retention for this write; older receipts are discarded on write. */
  maxReceipts?: number;
  expect?: { state?: AuthorityState; engine?: AuthorityEngine; inFlight?: number };
};

export type AuthorityCreateResult = {
  created: boolean;
  record: ConversationAuthorityView;
};

export type ConversationAuthorityMethods = {
  readConversationAuthority: (
    ownerId: string,
    conversationId: string,
  ) => Promise<ConversationAuthorityView | null>;
  createConversationAuthority: (
    record: ConversationAuthorityView,
  ) => Promise<AuthorityCreateResult>;
  advanceConversationAuthority: (
    input: AuthorityAdvanceInput,
  ) => Promise<ConversationAuthorityView | null>;
};

function toView(doc: IConversationAuthority): ConversationAuthorityView {
  return {
    ownerId: doc.ownerId,
    conversationId: doc.conversationId,
    mode: doc.mode,
    engine: doc.engine,
    state: doc.state,
    generation: doc.generation,
    inFlight: doc.inFlight,
    contractVersion: doc.contractVersion,
    receipts: (doc.receipts ?? []).map((receipt) => ({
      at: receipt.at,
      outcome: receipt.outcome,
      contractVersion: receipt.contractVersion,
      generation: receipt.generation,
      ...(receipt.taskId == null ? {} : { taskId: receipt.taskId }),
    })),
    updatedAt: (doc.updatedAt ?? new Date()).toISOString(),
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === DUPLICATE_KEY_ERROR
  );
}

/**
 * Durable conversation authority.
 *
 * Creation relies on the unique `(ownerId, conversationId)` index, so two
 * replicas racing to map the same conversation cannot both succeed. Advances are
 * compare-and-set on `generation`: a caller that read an older generation writes
 * nothing, which is what stops a stale replica from dispatching a conversation
 * another replica has already claimed.
 */
export function createConversationAuthorityMethods(
  mongoose: typeof import('mongoose'),
): ConversationAuthorityMethods {
  const model = (): Model<IConversationAuthority> => createConversationAuthorityModel(mongoose);

  async function readConversationAuthority(
    ownerId: string,
    conversationId: string,
  ): Promise<ConversationAuthorityView | null> {
    const doc = (await model()
      .findOne({ ownerId, conversationId })
      .lean()) as IConversationAuthority | null;
    return doc == null ? null : toView(doc);
  }

  async function createConversationAuthority(
    record: ConversationAuthorityView,
  ): Promise<AuthorityCreateResult> {
    try {
      const created = await model().create({
        ownerId: record.ownerId,
        conversationId: record.conversationId,
        mode: record.mode,
        engine: record.engine,
        state: record.state,
        generation: record.generation,
        inFlight: record.inFlight,
        contractVersion: record.contractVersion,
        receipts: record.receipts,
      });
      return {
        created: true,
        record: toView(created.toObject() as unknown as IConversationAuthority),
      };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
    const existing = await readConversationAuthority(record.ownerId, record.conversationId);
    if (existing == null) {
      /** Deleted between the duplicate rejection and the read; one retry only. */
      const retried = await model().create({
        ownerId: record.ownerId,
        conversationId: record.conversationId,
        mode: record.mode,
        engine: record.engine,
        state: record.state,
        generation: record.generation,
        inFlight: record.inFlight,
        contractVersion: record.contractVersion,
        receipts: record.receipts,
      });
      return {
        created: true,
        record: toView(retried.toObject() as unknown as IConversationAuthority),
      };
    }
    return { created: false, record: existing };
  }

  async function advanceConversationAuthority(
    input: AuthorityAdvanceInput,
  ): Promise<ConversationAuthorityView | null> {
    const filter: Record<string, unknown> = {
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      generation: input.expectedGeneration,
    };
    if (input.expect?.state != null) {
      filter.state = input.expect.state;
    }
    if (input.expect?.engine != null) {
      filter.engine = input.expect.engine;
    }
    if (input.expect?.inFlight != null) {
      filter.inFlight = input.expect.inFlight;
    } else if (input.inFlightDelta != null && input.inFlightDelta < 0) {
      filter.inFlight = { $gte: Math.abs(input.inFlightDelta) };
    }

    const update: Record<string, unknown> = {};
    const increment = {
      ...(input.generationDelta == null ? {} : { generation: input.generationDelta }),
      ...(input.inFlightDelta == null ? {} : { inFlight: input.inFlightDelta }),
    };
    if (Object.keys(increment).length > 0) {
      update.$inc = increment;
    }
    if (input.set != null && Object.keys(input.set).length > 0) {
      update.$set = input.set;
    }
    if (input.receipt != null) {
      const maxReceipts = Math.min(Math.max(input.maxReceipts ?? MAX_RECEIPTS, 1), 500);
      update.$push = {
        receipts: { $each: [input.receipt], $slice: -maxReceipts },
      };
    }
    if (Object.keys(update).length === 0) {
      return readConversationAuthority(input.ownerId, input.conversationId);
    }

    const doc = (await model()
      .findOneAndUpdate(filter, update, { new: true })
      .lean()) as IConversationAuthority | null;
    return doc == null ? null : toView(doc);
  }

  return {
    readConversationAuthority,
    createConversationAuthority,
    advanceConversationAuthority,
  };
}
