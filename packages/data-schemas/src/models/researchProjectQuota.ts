import { Model } from 'mongoose';
import type { IResearchProjectQuotaDocument } from '~/types';
import researchProjectQuotaSchema from '~/schema/researchProjectQuota';

export function createResearchProjectQuotaModel(
  mongoose: typeof import('mongoose'),
): Model<IResearchProjectQuotaDocument> {
  return (
    mongoose.models.ResearchProjectQuota ||
    mongoose.model<IResearchProjectQuotaDocument>(
      'ResearchProjectQuota',
      researchProjectQuotaSchema,
      'researchprojectquotas',
    )
  );
}
