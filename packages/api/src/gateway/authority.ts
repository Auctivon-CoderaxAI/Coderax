/**
 * Durable conversation authority.
 *
 * A conversation is executed by exactly one backend. Configuration alone cannot
 * guarantee that: two gateway replicas, a restart or an operator edit could each
 * dispatch the same conversation to a different engine. This module therefore
 * keeps an authoritative, atomically advanced record per conversation, and every
 * dispatch must claim it before a request leaves Coderax.
 *
 * The record is deliberately small and additive; it stores no transcript and no
 * task state. The WorkflowEngine remains the authority for execution, while this
 * record is the authority for *which* backend a conversation belongs to.
 */

export type AuthorityMode = 'private' | 'cloud';
export type AuthorityEngine = 'native' | 'workflow-engine';
export type AuthorityState = 'active' | 'migrating';

export type AuthorityReceiptOutcome =
  | 'dispatched'
  | 'settled'
  | 'failed'
  | 'migration_started'
  | 'migration_completed';

export type AuthorityReceipt = {
  at: string;
  outcome: AuthorityReceiptOutcome;
  contractVersion: string;
  generation: number;
  taskId?: string;
};

export type ConversationAuthorityRecord = {
  ownerId: string;
  conversationId: string;
  mode: AuthorityMode;
  engine: AuthorityEngine;
  state: AuthorityState;
  /** Fencing generation; every write must name the generation it read. */
  generation: number;
  /** Dispatches that have not settled yet. Migration requires zero. */
  inFlight: number;
  contractVersion: string;
  receipts: AuthorityReceipt[];
  updatedAt: string;
};

export type AuthorityAdvance = {
  ownerId: string;
  conversationId: string;
  expectedGeneration: number;
  /** Only these fields may change; identity and conversation id never do. */
  set?: Partial<Pick<ConversationAuthorityRecord, 'engine' | 'state' | 'mode' | 'contractVersion'>>;
  generationDelta?: number;
  inFlightDelta?: number;
  receipt?: AuthorityReceipt;
  /** Extra filter: refuse unless the current state and engine still match. */
  expect?: { state?: AuthorityState; engine?: AuthorityEngine; inFlight?: number };
};

export type AuthorityCreateResult = {
  created: boolean;
  record: ConversationAuthorityRecord;
};

export type ConversationAuthorityStore = {
  read: (ownerId: string, conversationId: string) => Promise<ConversationAuthorityRecord | null>;
  create: (record: ConversationAuthorityRecord) => Promise<AuthorityCreateResult>;
  advance: (input: AuthorityAdvance) => Promise<ConversationAuthorityRecord | null>;
};

export type AuthorityRefusalCode =
  | 'WORKFLOW_ENGINE_AUTHORITY_UNMAPPED'
  | 'WORKFLOW_ENGINE_AUTHORITY_CONFLICT'
  | 'WORKFLOW_ENGINE_AUTHORITY_BUSY'
  | 'WORKFLOW_ENGINE_AUTHORITY_MIGRATION_PENDING';

export type AuthorityDecision =
  | { ok: true; generation: number }
  | { ok: false; status: 409; code: AuthorityRefusalCode };

export type ConversationAuthority = {
  read: (ownerId: string, conversationId: string) => Promise<ConversationAuthorityRecord | null>;
  /** Claims one dispatch for a conversation that the engine may execute. */
  admit: (input: {
    ownerId: string;
    conversationId: string;
    mode: AuthorityMode;
  }) => Promise<AuthorityDecision>;
  /** Records the outcome of a claimed dispatch and releases its slot. */
  settle: (input: {
    ownerId: string;
    conversationId: string;
    generation: number;
    outcome: 'settled' | 'failed';
    taskId?: string;
  }) => Promise<boolean>;
  /** Records a conversation the engine itself created, without claiming it. */
  register: (input: {
    ownerId: string;
    conversationId: string;
    mode: AuthorityMode;
  }) => Promise<AuthorityDecision>;
  beginMigration: (input: {
    ownerId: string;
    conversationId: string;
    to: AuthorityEngine;
  }) => Promise<AuthorityDecision>;
  completeMigration: (input: {
    ownerId: string;
    conversationId: string;
    generation: number;
  }) => Promise<boolean>;
};

export type ConversationAuthorityDeps = {
  store: ConversationAuthorityStore;
  contractVersion: string;
  /** Conversations the migration may move on first dispatch. */
  bootstrapConversations: readonly string[];
  now?: () => Date;
};

const DEFAULT_MAX_RECEIPTS = 20;

function refusal(code: AuthorityRefusalCode): AuthorityDecision {
  return { ok: false, status: 409, code };
}

function trimReceipts(receipts: AuthorityReceipt[], max: number): AuthorityReceipt[] {
  return receipts.length <= max ? receipts : receipts.slice(receipts.length - max);
}

/**
 * The in-process implementation of the store contract. It is atomic because Node
 * runs these mutations to completion without an await, and it exists so the
 * authority rules can be tested without a database. Production uses the Mongo
 * store from `packages/data-schemas`.
 */
export function createMemoryAuthorityStore(): ConversationAuthorityStore {
  const records = new Map<string, ConversationAuthorityRecord>();
  const keyOf = (ownerId: string, conversationId: string): string =>
    `${ownerId}\u0000${conversationId}`;
  const clone = (record: ConversationAuthorityRecord): ConversationAuthorityRecord => ({
    ...record,
    receipts: record.receipts.map((receipt) => ({ ...receipt })),
  });

  return {
    read: async (ownerId, conversationId) => {
      const record = records.get(keyOf(ownerId, conversationId));
      return record == null ? null : clone(record);
    },
    create: async (record) => {
      const key = keyOf(record.ownerId, record.conversationId);
      const existing = records.get(key);
      if (existing != null) {
        return { created: false, record: clone(existing) };
      }
      records.set(key, clone(record));
      return { created: true, record: clone(record) };
    },
    advance: async (input) => {
      const key = keyOf(input.ownerId, input.conversationId);
      const current = records.get(key);
      if (current == null || current.generation !== input.expectedGeneration) {
        return null;
      }
      if (input.expect?.state != null && current.state !== input.expect.state) {
        return null;
      }
      if (input.expect?.engine != null && current.engine !== input.expect.engine) {
        return null;
      }
      if (input.expect?.inFlight != null && current.inFlight !== input.expect.inFlight) {
        return null;
      }
      const next: ConversationAuthorityRecord = {
        ...current,
        ...(input.set ?? {}),
        generation: current.generation + (input.generationDelta ?? 0),
        inFlight: current.inFlight + (input.inFlightDelta ?? 0),
        receipts: trimReceipts(
          input.receipt == null ? current.receipts : [...current.receipts, input.receipt],
          DEFAULT_MAX_RECEIPTS,
        ),
        updatedAt: input.receipt?.at ?? current.updatedAt,
      };
      if (next.inFlight < 0) {
        return null;
      }
      records.set(key, next);
      return clone(next);
    },
  };
}

export function createConversationAuthority(
  deps: ConversationAuthorityDeps,
): ConversationAuthority {
  const now = deps.now ?? ((): Date => new Date());
  const bootstrap = new Set(deps.bootstrapConversations);
  const stamp = (): string => now().toISOString();
  const receipt = (
    outcome: AuthorityReceiptOutcome,
    generation: number,
    taskId?: string,
  ): AuthorityReceipt => ({
    at: stamp(),
    outcome,
    contractVersion: deps.contractVersion,
    generation,
    ...(taskId == null ? {} : { taskId }),
  });

  function freshRecord(input: {
    ownerId: string;
    conversationId: string;
    mode: AuthorityMode;
    inFlight: number;
    receiptOutcome?: AuthorityReceiptOutcome;
  }): ConversationAuthorityRecord {
    return {
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      mode: input.mode,
      engine: 'workflow-engine',
      state: 'active',
      generation: input.inFlight > 0 ? 1 : 0,
      inFlight: input.inFlight,
      contractVersion: deps.contractVersion,
      receipts:
        input.receiptOutcome == null
          ? []
          : [receipt(input.receiptOutcome, input.inFlight > 0 ? 1 : 0)],
      updatedAt: stamp(),
    };
  }

  async function claim(
    input: { ownerId: string; conversationId: string; mode: AuthorityMode },
    inFlight: number,
  ): Promise<AuthorityDecision> {
    const existing = await deps.store.read(input.ownerId, input.conversationId);
    let current = existing;
    if (current == null) {
      if (!bootstrap.has(input.conversationId)) {
        return refusal('WORKFLOW_ENGINE_AUTHORITY_UNMAPPED');
      }
      const created = await deps.store.create(
        freshRecord({
          ...input,
          inFlight,
          ...(inFlight > 0 ? { receiptOutcome: 'dispatched' as const } : {}),
        }),
      );
      current = created.record;
      if (created.created) {
        return { ok: true, generation: current.generation };
      }
    }
    if (current.state === 'migrating') {
      return refusal('WORKFLOW_ENGINE_AUTHORITY_MIGRATION_PENDING');
    }
    if (current.engine !== 'workflow-engine') {
      return refusal('WORKFLOW_ENGINE_AUTHORITY_CONFLICT');
    }
    const generation = current.generation + 1;
    const next = await deps.store.advance({
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      expectedGeneration: current.generation,
      set: { mode: input.mode, contractVersion: deps.contractVersion },
      generationDelta: 1,
      inFlightDelta: inFlight,
      receipt: inFlight > 0 ? receipt('dispatched', generation) : undefined,
      expect: { state: 'active', engine: 'workflow-engine' },
    });
    return next == null ? refusal('WORKFLOW_ENGINE_AUTHORITY_BUSY') : { ok: true, generation };
  }

  return {
    read: (ownerId, conversationId) => deps.store.read(ownerId, conversationId),

    admit: (input) => claim(input, 1),

    register: async (input) => {
      const existing = await deps.store.read(input.ownerId, input.conversationId);
      if (existing != null) {
        return existing.engine === 'workflow-engine' && existing.state === 'active'
          ? { ok: true, generation: existing.generation }
          : refusal(
              existing.engine === 'workflow-engine'
                ? 'WORKFLOW_ENGINE_AUTHORITY_MIGRATION_PENDING'
                : 'WORKFLOW_ENGINE_AUTHORITY_CONFLICT',
            );
      }
      const created = await deps.store.create(freshRecord({ ...input, inFlight: 0 }));
      return created.created || created.record.engine === 'workflow-engine'
        ? { ok: true, generation: created.record.generation }
        : refusal('WORKFLOW_ENGINE_AUTHORITY_CONFLICT');
    },

    settle: async (input) => {
      const next = await deps.store.advance({
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        expectedGeneration: input.generation,
        generationDelta: 1,
        inFlightDelta: -1,
        receipt: receipt(input.outcome, input.generation + 1, input.taskId),
        expect: { engine: 'workflow-engine' },
      });
      return next != null;
    },

    beginMigration: async (input) => {
      const current = await deps.store.read(input.ownerId, input.conversationId);
      if (current == null) {
        return refusal('WORKFLOW_ENGINE_AUTHORITY_UNMAPPED');
      }
      if (current.inFlight > 0) {
        return refusal('WORKFLOW_ENGINE_AUTHORITY_BUSY');
      }
      if (current.engine === input.to && current.state === 'active') {
        return { ok: true, generation: current.generation };
      }
      const generation = current.generation + 1;
      const next = await deps.store.advance({
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        expectedGeneration: current.generation,
        set: { engine: input.to, state: 'migrating' },
        generationDelta: 1,
        receipt: receipt('migration_started', generation),
        expect: { inFlight: 0 },
      });
      return next == null ? refusal('WORKFLOW_ENGINE_AUTHORITY_BUSY') : { ok: true, generation };
    },

    completeMigration: async (input) => {
      const next = await deps.store.advance({
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        expectedGeneration: input.generation,
        set: { state: 'active' },
        generationDelta: 1,
        receipt: receipt('migration_completed', input.generation + 1),
        expect: { state: 'migrating', inFlight: 0 },
      });
      return next != null;
    },
  };
}
