import type { EngineId, EngineResult, EngineRunHandle } from '../types';
import type { ExecutionEnginesConfig } from '../service';
import type { EngineStatusSnapshot } from '../registry';

/** The Work ingress reads the canonical engine config; it adds no fields. */
export type EngineWorkChatConfig = NonNullable<ExecutionEnginesConfig>;

/**
 * The execution an engine start claimed. `generation` is the lease token that
 * fences this run's conversation writes; it is null only for a runner that
 * does not keep durable leases. `replaces` is the expired generation the claim
 * took over, if any, so the startup stamp may adopt that row.
 */
export type EngineRunOwnership = {
  generation: string | null;
  replaces: string | null;
};

/** Run state and its fencing token, read from one lease snapshot. */
export type EngineRunSnapshot = {
  state: string | null;
  generation: string | null;
};

export type EngineWorkChatStore = {
  getConversation: (conversationId: string) => Promise<{
    conversationId: string;
    title?: string;
    tenantId?: string | null;
    isWork?: boolean;
    workAgent?: 'coderax' | 'opencode' | 'freebuff';
  } | null>;
  /**
   * Returns whether the write applied. A generation or claim predicate that
   * matches no row reports false, so the caller can tell a superseded run from
   * a stored one.
   */
  saveConversation: (input: {
    conversationId: string;
    title?: string;
    workState?: 'running' | 'completed' | 'failed' | 'cancelled';
    workAgent?: 'coderax' | 'opencode' | 'freebuff';
    create?: boolean;
    /** Fencing generation stamped by the run; null detaches a settled row. */
    workRunId?: string | null;
    /** Applies only while the row still belongs to this generation. */
    fenceWorkRun?: string;
    /** Applies only while the row belongs to this generation or the one it replaced. */
    claimWorkRun?: { generation: string; replaces: string | null };
  }) => Promise<boolean>;
  saveMessage: (input: {
    messageId: string;
    parentMessageId: string;
    conversationId: string;
    text: string;
    /** Content parts the turn streamed, so a reload renders the same message. */
    content?: Array<Record<string, unknown>>;
    isCreatedByUser: boolean;
    unfinished?: boolean;
    error?: boolean | string;
  }) => Promise<void>;
  loadTranscript: (
    conversationId: string,
  ) => Promise<Array<{ text: string; isCreatedByUser: boolean }>>;
};

export type RunScope = {
  userId: string;
  tenantId: string | null;
  conversationId: string;
};

export type EngineWorkChatRunner = {
  start: (
    input: RunScope & {
      prompt: string;
      engine?: EngineId;
      signal?: AbortSignal;
      /** Runs after ownership is verified and before the engine is dispatched. */
      beforeDispatch?: (ownership: EngineRunOwnership) => Promise<void>;
    },
  ) => Promise<EngineResult<EngineRunHandle>>;
  /** Durable: a run outlives the process that started it, so this reads the lease store. */
  state: (input: RunScope) => Promise<string | null>;
  /** State and generation from one lease snapshot; lease-backed runners implement this. */
  inspect?: (input: RunScope) => Promise<EngineRunSnapshot>;
  /** Stops only the observed generation; a replacement run is left alone. */
  cancel: (input: RunScope, generation?: string) => Promise<boolean>;
  /** The handler owns the lease until terminal persistence and cleanup have finished. */
  release?: (input: RunScope & { handle?: EngineRunHandle }) => Promise<boolean>;
  snapshot: () => EngineStatusSnapshot;
};
