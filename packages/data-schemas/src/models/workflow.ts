import { Model } from 'mongoose';
import type { IWorkflowDocument, IWorkflowRunDocument } from '~/types/workflow';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import { workflowRunSchema, workflowSchema } from '~/schema/workflow';

export function createWorkflowModel(mongoose: typeof import('mongoose')): Model<IWorkflowDocument> {
  applyTenantIsolation(workflowSchema);
  return mongoose.models.Workflow || mongoose.model<IWorkflowDocument>('Workflow', workflowSchema);
}

export function createWorkflowRunModel(
  mongoose: typeof import('mongoose'),
): Model<IWorkflowRunDocument> {
  applyTenantIsolation(workflowRunSchema);
  return (
    mongoose.models.WorkflowRun ||
    mongoose.model<IWorkflowRunDocument>('WorkflowRun', workflowRunSchema)
  );
}
