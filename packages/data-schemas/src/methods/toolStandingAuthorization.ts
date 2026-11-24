import {
  STANDING_AUTHORIZATION_MAX_COST_USD,
  validateToolStandingAuthorization,
} from 'coderax-data-provider';
import type {
  ToolStandingAuthorization,
  ToolStandingAuthorizationScope,
  ToolStandingAuthorizationStorage,
} from 'coderax-data-provider';

interface StoredStandingAuthorization {
  _id: unknown;
  label: string;
  tools?: string[];
  destinations?: string[];
  projectId?: string;
  expiresAt?: number;
  revokedAt?: number;
  maxCostUsd?: number;
  createdAt?: Date;
}

function toAuthorization(record: StoredStandingAuthorization): ToolStandingAuthorization {
  return {
    id: String(record._id),
    label: record.label,
    tools: record.tools ?? [],
    ...(record.destinations?.length ? { destinations: record.destinations } : {}),
    ...(record.projectId != null ? { projectId: record.projectId } : {}),
    ...(record.expiresAt != null ? { expiresAt: record.expiresAt } : {}),
    ...(record.revokedAt != null ? { revokedAt: record.revokedAt } : {}),
    maxCostUsd: record.maxCostUsd ?? STANDING_AUTHORIZATION_MAX_COST_USD,
    createdAt: record.createdAt?.getTime() ?? 0,
  };
}

const projection = 'label tools destinations projectId expiresAt revokedAt maxCostUsd createdAt';

export function createToolStandingAuthorizationMethods(
  mongoose: typeof import('mongoose'),
): ToolStandingAuthorizationStorage {
  return {
    async listToolStandingAuthorizations(scope: ToolStandingAuthorizationScope, options) {
      const records = await mongoose.models.ToolStandingAuthorization.find({
        user: scope.userId,
        tenantId: scope.tenantId ?? null,
        ...(options?.includeRevoked === true ? {} : { revokedAt: { $exists: false } }),
      })
        .select(projection)
        .sort({ createdAt: -1 })
        .lean<StoredStandingAuthorization[]>();
      return records.map(toAuthorization);
    },
    async createToolStandingAuthorization(scope: ToolStandingAuthorizationScope, input) {
      const validation = validateToolStandingAuthorization(input);
      if (!validation.ok) return validation;
      const created = await mongoose.models.ToolStandingAuthorization.create({
        user: scope.userId,
        tenantId: scope.tenantId ?? null,
        ...validation.value,
      });
      return {
        ok: true,
        value: toAuthorization(created.toObject() as StoredStandingAuthorization),
      };
    },
    async revokeToolStandingAuthorization(scope: ToolStandingAuthorizationScope, id: string) {
      if (!mongoose.isValidObjectId(id)) return false;
      const result = await mongoose.models.ToolStandingAuthorization.updateOne(
        {
          _id: id,
          user: scope.userId,
          tenantId: scope.tenantId ?? null,
          revokedAt: { $exists: false },
        },
        { $set: { revokedAt: Date.now() } },
      );
      return result.modifiedCount === 1;
    },
  };
}
