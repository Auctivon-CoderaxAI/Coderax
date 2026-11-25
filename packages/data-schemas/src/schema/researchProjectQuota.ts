import { Schema } from 'mongoose';
import type { IResearchProjectQuotaDocument } from '~/types';

/**
 * One durable admission counter per owner. The project count is kept here so a
 * create can reserve a slot with a single conditional write instead of racing a
 * separate `countDocuments` against another request.
 */
const researchProjectQuotaSchema: Schema<IResearchProjectQuotaDocument> =
  new Schema<IResearchProjectQuotaDocument>(
    {
      user: { type: String, required: true, unique: true, index: true },
      count: { type: Number, required: true, min: 0, default: 0 },
    },
    { timestamps: true },
  );

export default researchProjectQuotaSchema;
