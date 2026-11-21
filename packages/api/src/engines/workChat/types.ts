import type { EngineStatusSnapshot } from '../registry';
import type { EngineResult, EngineRunHandle } from '../types';

export type EngineWorkChatConfig = {
  engines?: {
    workChat?: {
      enabled?: boolean;
      engine?: 'opencode';
      mode?: 'private' | 'cloud';
    } | null;
    workspaces?: {
      privateRoot?: string;
      cloudRoot?: string;
    } | null;
    opencode?: {
      enabled?: boolean;
      model?: string;
    } | null;
  } | null;
  interfaceConfig?: unknown;
};

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
    appendMessageIds?: string[];
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
  start: (input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
    prompt: string;
  }) => Promise<EngineResult<EngineRunHandle>>;
  state: (input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
  }) => string | null;
  cancel: (input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
  }) => Promise<boolean>;
  /** The handler owns the lease until terminal persistence has finished. */
  release?: (input: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
    handle?: EngineRunHandle;
  }) => boolean;
  snapshot: () => EngineStatusSnapshot;
};
