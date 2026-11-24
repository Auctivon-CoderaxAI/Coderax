import { Schema } from 'mongoose';
import type { Model } from 'mongoose';
import { applyTenantIsolation } from './plugins/tenantIsolation';

interface ToolStandingAuthorizationRecord {
  user: string;
  tenantId?: string;
  label: string;
  tools: string[];
  destinations?: string[];
  projectId?: string;
  expiresAt?: number;
  revokedAt?: number;
  maxCostUsd: number;
}

const schema: Schema<ToolStandingAuthorizationRecord> = new Schema<ToolStandingAuthorizationRecord>(
  {
    user: { type: String, required: true },
    tenantId: { type: String },
    label: { type: String, required: true },
    tools: { type: [String], default: [] },
    destinations: { type: [String] },
    projectId: { type: String },
    expiresAt: { type: Number },
    revokedAt: { type: Number },
    maxCostUsd: { type: Number, default: 0, min: 0, max: 0 },
  },
  { timestamps: true },
);
schema.index({ user: 1, tenantId: 1, revokedAt: 1, expiresAt: 1 });

export function createToolStandingAuthorizationModel(
  mongoose: typeof import('mongoose'),
): Model<ToolStandingAuthorizationRecord> {
  applyTenantIsolation(schema);
  return (
    mongoose.models.ToolStandingAuthorization ?? mongoose.model('ToolStandingAuthorization', schema)
  );
}
