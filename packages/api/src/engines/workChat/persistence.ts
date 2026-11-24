import type { EngineWorkChatStore } from './types';
import type { Json } from './json';
import { isRecord, readString } from './json';

type EngineWorkChatStoreEngine = 'opencode' | 'freebuff';

/** Engine identity persisted on Work rows, so a reload shows the engine that ran. */
const ENGINE_LABELS = {
  opencode: { model: 'opencode', sender: 'OpenCode', label: 'OpenCode' },
  freebuff: { model: 'freebuff', sender: 'Freebuff', label: 'Freebuff' },
} as const;

type EngineWorkChatDb = {
  getConvo: (userId: string, conversationId: string) => Promise<unknown>;
  saveConvo: (context: Json, fields: Json, options: Json) => Promise<unknown>;
  saveMessage: (context: Json, params: Json, options: Json) => Promise<unknown>;
  getMessages: (filter: Json, select: string, options: Json) => Promise<unknown[]>;
};

/** Plain store adapter; the CJS route supplies the app database and request scope. */
export function createEngineWorkChatPersistence(input: {
  db: EngineWorkChatDb;
  userId: string;
  tenantId: string | null;
  isTemporary?: boolean;
  interfaceConfig?: unknown;
  engine?: EngineWorkChatStoreEngine;
}): EngineWorkChatStore {
  const { db, userId, tenantId, isTemporary, interfaceConfig } = input;
  const context = { userId, isTemporary, interfaceConfig };
  const engine: EngineWorkChatStoreEngine = input.engine === 'freebuff' ? 'freebuff' : 'opencode';
  const labels = ENGINE_LABELS[engine];

  async function saveConversation(fields: {
    conversationId: string;
    title?: string;
    workState?: 'running' | 'completed' | 'failed' | 'cancelled';
    create?: boolean;
  }): Promise<void> {
    const saved = await db.saveConvo(
      context,
      {
        conversationId: fields.conversationId,
        isWork: true,
        workModel: labels.model,
        ...(fields.title ? { title: fields.title } : {}),
        ...(fields.workState ? { workState: fields.workState } : {}),
        ...(fields.create && tenantId != null ? { tenantId } : {}),
      },
      {
        context: `Work ${labels.label} chat conversation`,
        ...(fields.create ? {} : { noUpsert: true }),
      },
    );
    if (!saved) {
      throw new Error('Work conversation could not be saved');
    }
  }

  return {
    getConversation: async (conversationId) => {
      const row = await db.getConvo(userId, conversationId);
      if (!isRecord(row)) {
        return null;
      }
      return {
        conversationId: readString(row.conversationId) ?? conversationId,
        ...(readString(row.title) ? { title: String(row.title) } : {}),
        ...(row.tenantId === null || typeof row.tenantId === 'string'
          ? { tenantId: row.tenantId as string | null }
          : {}),
        ...(row.isWork === true ? { isWork: true } : {}),
      };
    },
    saveConversation,
    saveMessage: async (message) => {
      const saved = await db.saveMessage(
        context,
        {
          messageId: message.messageId,
          parentMessageId: message.parentMessageId,
          conversationId: message.conversationId,
          text: message.text,
          /** The reply's parts, so the stored row renders the same text and tool
           *  cards the stream showed. A user message never carries them. */
          ...(message.content ? { content: message.content } : {}),
          sender: message.isCreatedByUser ? 'User' : labels.sender,
          isCreatedByUser: message.isCreatedByUser,
          model: labels.model,
          endpoint: labels.model,
          ...(message.unfinished ? { unfinished: true } : {}),
          ...(message.error !== undefined ? { error: message.error } : {}),
        },
        {
          context: message.isCreatedByUser
            ? `Work ${labels.label} user message`
            : `Work ${labels.label} response`,
        },
      );
      if (!saved) {
        throw new Error('Work message could not be saved');
      }
    },
    loadTranscript: async (conversationId) => {
      const rows = await db.getMessages(
        { user: userId, conversationId },
        'messageId text isCreatedByUser createdAt',
        { sort: { createdAt: -1 }, limit: 24 },
      );
      return rows
        .filter(isRecord)
        .map((row) => ({
          text: typeof row.text === 'string' ? row.text : '',
          isCreatedByUser: row.isCreatedByUser === true,
        }))
        .filter((row) => row.text.trim().length > 0)
        .reverse();
    },
  };
}
