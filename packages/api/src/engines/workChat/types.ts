import type { EngineId, EngineResult, EngineRunHandle } from '../types';
import type { ExecutionEnginesConfig } from '../service';
import type { EngineStatusSnapshot } from '../registry';

/** The Work ingress reads the canonical engine config; it adds no fields. */
export type EngineWorkChatConfig = NonNullable<ExecutionEnginesConfig>;

export type EngineWorkChatStore = {
  getConversation: (conversationId: string) => Promise<{
    conversationId: string;
    title?: string;
    tenantId?: string | null;
    isWork?: boolean;
  } | null>;
  saveConversation: (input: {
    conversationId: string;
    title?: string;
    workState?: 'running' | 'completed' | 'failed' | 'cancelled';
    create?: boolean;
  }) => Promise<void>;
  saveMessage: (input: {
    messageId: string;
    parentMessageId: string;
    conversationId: string;
    text: string;
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
    input: RunScope & { prompt: string; engine?: EngineId },
  ) => Promise<EngineResult<EngineRunHandle>>;
  /** Durable: a run outlives the process that started it, so this reads the lease store. */
  state: (input: RunScope) => Promise<string | null>;
  cancel: (input: RunScope) => Promise<boolean>;
  /** The handler owns the lease until terminal persistence has finished. */
  release?: (input: RunScope & { handle?: EngineRunHandle }) => Promise<boolean>;
  snapshot: () => EngineStatusSnapshot;
};
