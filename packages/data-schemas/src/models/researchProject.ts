import { Model } from 'mongoose';
import type { IResearchProjectDocument } from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import researchProjectSchema from '~/schema/researchProject';

export function createResearchProjectModel(
  mongoose: typeof import('mongoose'),
): Model<IResearchProjectDocument> {
  applyTenantIsolation(researchProjectSchema);
  return (
    mongoose.models.ResearchProject ||
    mongoose.model<IResearchProjectDocument>(
      'ResearchProject',
      researchProjectSchema,
      'researchprojects',
    )
  );
}
