import { Schema } from 'mongoose';
import type { IConversationAuthority } from '~/types/conversationAuthority';

const receiptSchema = new Schema(
  {
    at: { type: String, required: true },
    outcome: {
      type: String,
      enum: [
        'dispatched',
        'settled',
        'failed',
        'indeterminate',
        'migration_started',
        'migration_completed',
      ],
      required: true,
    },
    contractVersion: { type: String, required: true },
    generation: { type: Number, required: true },
    taskId: { type: String },
  },
  { _id: false },
);

const conversationAuthoritySchema: Schema<IConversationAuthority> = new Schema(
  {
    ownerId: { type: String, required: true },
    conversationId: { type: String, required: true },
    mode: { type: String, enum: ['private', 'cloud'], required: true },
    engine: { type: String, enum: ['native', 'workflow-engine'], required: true },
    state: { type: String, enum: ['active', 'migrating'], required: true },
    generation: { type: Number, required: true, default: 0 },
    inFlight: { type: Number, required: true, default: 0 },
    contractVersion: { type: String, required: true },
    receipts: { type: [receiptSchema], default: [] },
  },
  { timestamps: true, collection: 'conversation_authorities' },
);

/** One authority per owner conversation; the unique index is the atomic guard. */
conversationAuthoritySchema.index(
  { ownerId: 1, conversationId: 1 },
  { unique: true, name: 'unique_conversation_authority' },
);

export default conversationAuthoritySchema;
