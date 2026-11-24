import { Schema } from 'mongoose';
import type { IWorkRun } from '~/types/workRun';

/**
 * One document per active Work engine run. The lease is deliberately not a
 * conversation subdocument: an engine run starts before its conversation row is
 * written, and a run must survive a restart even when that write never landed.
 * `key` embeds the tenant, so no separate tenantId path needs ambient scoping.
 */
const workRunSchema: Schema<IWorkRun> = new Schema(
  {
    key: { type: String, required: true },
    user: { type: String, required: true },
    conversationId: { type: String, required: true },
    token: { type: String, required: true },
    owner: { type: String, required: true },
    cancelRequested: { type: Boolean, required: true, default: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

/** One live lease per Work task; concurrent claims race at this index. */
workRunSchema.index({ key: 1 }, { unique: true });
/** Takeover and reconciliation scan by expiry. */
workRunSchema.index({ expiresAt: 1 });

export default workRunSchema;
